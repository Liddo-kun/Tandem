import { createWriteStream } from "node:fs"
import { copyFile, mkdir, rm } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

type Target = "aarch64" | "armv7" | "i686" | "x86_64"

type Options = {
  name: string
  device?: string
  target: Target
  deviceRetrySeconds: number
  deviceRetryDelaySeconds: number
  noOutputTimeoutSeconds: number
  progressIntervalSeconds: number
}

const DEFAULT_DEVICE = "192.168.1.85:5555"
const TARGETS = new Set<Target>(["aarch64", "armv7", "i686", "x86_64"])
const decoder = new TextDecoder()
const scriptDir = import.meta.dir
const buildGradle = path.join(scriptDir, "src-tauri", "gen", "android", "app", "build.gradle.kts")
const stringsXml = path.join(scriptDir, "src-tauri", "gen", "android", "app", "src", "main", "res", "values", "strings.xml")
const apkDir = path.join(scriptDir, "src-tauri", "gen", "android", "app", "build", "outputs", "apk", "universal", "debug")
const sourceApk = path.join(apkDir, "app-universal-debug.apk")

const options = parseArgs(process.argv.slice(2))
const variantName = options.name.trim()
if (!variantName) throw new Error("-Name must not be empty.")

const packageSegments = variantName
  .toLowerCase()
  .split(/[^a-z0-9]+/)
  .filter((segment) => segment.length > 0)
  .map((segment) => (/^[a-z]/.test(segment) ? segment : `v${segment}`))

if (packageSegments.length === 0) throw new Error("-Name must contain at least one ASCII letter or digit.")

const appName = `OpenCode ${variantName}`
const packageId = `ai.opencode.android.${packageSegments.join(".")}`
const renamedApk = path.join(apkDir, `opencode-${packageSegments.join("-")}-y700-debug.apk`)
const workDir = path.join(os.tmpdir(), `opencode-y700-${crypto.randomUUID().replaceAll("-", "")}`)
const buildLog = path.join(workDir, "android-build.log")
const restoreLog = path.join(workDir, "android-restore.log")
const backupBuildGradle = path.join(workDir, "build.gradle.kts")
const backupStringsXml = path.join(workDir, "strings.xml")

try {
  await main()
  console.log(`Installed ${appName} as ${packageId}`)
  console.log(`Build log: ${buildLog}`)
} catch (error) {
  console.error(`Y700 variant install failed: ${error instanceof Error ? error.message : String(error)}`)
  console.error(`Build log: ${buildLog}`)
  process.exit(1)
}

async function main() {
  requireCommands(["adb", "bun", "cargo", "python"])
  await mkdir(workDir, { recursive: true })
  const resolvedDevice = await resolveDevice(options)

  await requireAndroidProject()
  await copyFile(buildGradle, backupBuildGradle)
  await copyFile(stringsXml, backupStringsXml)

  try {
    await setVariantMetadata()

    console.log(`Building ${appName} (${packageId}); log: ${buildLog}`)
    await runLoggedCommand(buildLog, "bun", ["run", "tauri", "android", "build", "--apk", "--debug", "--target", options.target], {
      cwd: scriptDir,
      env: { OPENCODE_ANDROID_VARIANT: "1" },
    })

    if (!(await Bun.file(sourceApk).exists())) throw new Error(`Build finished but APK was not found: ${sourceApk}`)

    await copyFile(sourceApk, renamedApk)
    console.log(`Created APK: ${renamedApk}`)

    console.log(`Installing on ${resolvedDevice}`)
    const install = runCommand("adb", ["-s", resolvedDevice, "install", "-r", renamedApk])
    writeCommandOutput(install)
    if (install.exitCode !== 0) throw new Error(`adb install failed with exit code ${install.exitCode}`)

    const verify = runCommand("adb", ["-s", resolvedDevice, "shell", "pm", "path", packageId])
    writeCommandOutput(verify)
    if (verify.exitCode !== 0) throw new Error(`Installed package verification failed for ${packageId}`)
  } finally {
    if ((await Bun.file(backupBuildGradle).exists()) && (await Bun.file(backupStringsXml).exists())) {
      await copyFile(backupBuildGradle, buildGradle)
      await copyFile(backupStringsXml, stringsXml)

      try {
        await runLoggedCommand(restoreLog, "bun", ["run", "patch-android-generated.ts"], { cwd: scriptDir })
      } catch (error) {
        console.error(
          `Warning: restored generated Android metadata backups, but post-restore patching failed: ${error instanceof Error ? error.message : String(error)}`,
        )
        console.error(`Restore log: ${restoreLog}`)
      }

      console.log("Restored generated Android metadata files.")
    }
  }
}

function parseArgs(args: string[]): Options {
  const result: Options = {
    name: "",
    target: "aarch64",
    deviceRetrySeconds: 45,
    deviceRetryDelaySeconds: 3,
    noOutputTimeoutSeconds: 600,
    progressIntervalSeconds: 20,
  }

  for (let index = 0; index < args.length; index++) {
    const arg = args[index]!
    if (!arg.startsWith("-")) throw new Error(`Unexpected positional argument: ${arg}`)

    const [rawKey, inlineValue] = arg.replace(/^-+/, "").split("=", 2)
    const key = normalizeKey(rawKey ?? "")
    const value = inlineValue ?? args[++index]
    if (!value) throw new Error(`Missing value for ${arg}`)

    if (key === "name") result.name = value
    else if (key === "device") result.device = value
    else if (key === "target") result.target = parseTarget(value)
    else if (key === "deviceretryseconds") result.deviceRetrySeconds = parseRange(arg, value, 0, 600)
    else if (key === "deviceretrydelayseconds") result.deviceRetryDelaySeconds = parseRange(arg, value, 1, 60)
    else if (key === "nooutputtimeoutseconds") result.noOutputTimeoutSeconds = parseRange(arg, value, 0, 7200)
    else if (key === "progressintervalseconds") result.progressIntervalSeconds = parseRange(arg, value, 5, 300)
    else throw new Error(`Unknown argument: ${arg}`)
  }

  if (!result.name) throw new Error("Missing required -Name <name> argument.")
  return result
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function parseTarget(value: string): Target {
  if (TARGETS.has(value as Target)) return value as Target
  throw new Error(`-Target must be one of: ${[...TARGETS].join(", ")}`)
}

function parseRange(label: string, value: string, min: number, max: number) {
  const number = Number.parseInt(value, 10)
  if (Number.isInteger(number) && number >= min && number <= max) return number
  throw new Error(`${label} must be an integer from ${min} to ${max}.`)
}

async function resolveDevice({ device, deviceRetryDelaySeconds, deviceRetrySeconds }: Options) {
  const requested = device ?? DEFAULT_DEVICE
  const strict = device !== undefined
  const deadline = Date.now() + deviceRetrySeconds * 1000
  let attempt = 0

  while (true) {
    attempt++
    runCommand("adb", ["start-server"], { silent: true })

    if (requested) {
      if (requested.includes(":")) runCommand("adb", ["connect", requested], { silent: true })

      const state = runCommand("adb", ["-s", requested, "get-state"], { silent: true })
      if (state.exitCode === 0 && state.stdout.trim() === "device") return requested

      if (strict && Date.now() >= deadline) {
        throw new Error(`Device '${requested}' is not connected after ${deviceRetrySeconds} seconds. Run 'adb devices' and pass -Device <serial>.`)
      }
    }

    const devices = getConnectedDevices()
    if (devices.length === 1 && !strict) {
      if (requested && requested !== devices[0]) console.log(`Configured device '${requested}' is unavailable. Using connected device '${devices[0]}'.`)
      return devices[0]!
    }

    if (devices.length > 1) throw new Error(`Multiple Android devices found: ${devices.join(", ")}. Pass -Device <serial>.`)

    if (Date.now() >= deadline) {
      if (strict) throw new Error(`Device '${requested}' is not connected after ${deviceRetrySeconds} seconds. Run 'adb devices' and pass -Device <serial>.`)
      throw new Error(`No connected Android devices found after ${deviceRetrySeconds} seconds. Connect the Y700 or pass -Device <serial>.`)
    }

    console.log(`Waiting for Android device (${attempt}). Retrying in ${deviceRetryDelaySeconds} seconds...`)
    await Bun.sleep(deviceRetryDelaySeconds * 1000)
  }
}

function requireCommands(commands: string[]) {
  const missing = commands.filter((command) => !Bun.which(command))
  if (missing.length > 0) throw new Error(`Missing required command(s): ${missing.join(", ")}`)
}

function getConnectedDevices() {
  const result = runCommand("adb", ["devices"], { silent: true })
  if (result.exitCode !== 0) return []

  return result.stdout
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter(([serial, state]) => serial && state === "device")
    .map(([serial]) => serial!)
}

async function requireAndroidProject() {
  if ((await Bun.file(buildGradle).exists()) && (await Bun.file(stringsXml).exists())) return

  const initLog = path.join(workDir, "android-init.log")
  console.log(`Generated Android project missing. Running tauri android init; log: ${initLog}`)
  await runLoggedCommand(initLog, "bun", ["run", "tauri", "android", "init", "--ci"], { cwd: scriptDir })

  if (!(await Bun.file(buildGradle).exists())) throw new Error(`Missing generated file after init: ${buildGradle}`)
  if (!(await Bun.file(stringsXml).exists())) throw new Error(`Missing generated file after init: ${stringsXml}`)
}

async function setVariantMetadata() {
  const applicationIdRegex = /applicationId\s*=\s*"[^"]+"/
  const buildGradleText = await Bun.file(buildGradle).text()
  if (!applicationIdRegex.test(buildGradleText)) throw new Error(`Could not find applicationId in ${buildGradle}`)

  await Bun.write(buildGradle, buildGradleText.replace(applicationIdRegex, `applicationId = "${packageId}"`))

  const stringsText = await Bun.file(stringsXml).text()
  const appNameRegex = /<string name="app_name">[^<]*<\/string>/
  const activityTitleRegex = /<string name="main_activity_title">[^<]*<\/string>/
  if (!appNameRegex.test(stringsText)) throw new Error(`Could not find app_name in ${stringsXml}`)
  if (!activityTitleRegex.test(stringsText)) throw new Error(`Could not find main_activity_title in ${stringsXml}`)

  await Bun.write(
    stringsXml,
    stringsText
      .replace(appNameRegex, `<string name="app_name">${escapeXml(appName)}</string>`)
      .replace(activityTitleRegex, `<string name="main_activity_title">${escapeXml(appName)}</string>`),
  )
}

async function runLoggedCommand(
  logPath: string,
  filePath: string,
  args: string[],
  commandOptions: { cwd?: string; env?: Record<string, string> } = {},
) {
  const started = Date.now()
  const commandDisplay = formatCommand(filePath, args)
  console.log(`Running: ${commandDisplay}`)
  console.log(`Writing full output to: ${logPath}`)

  await mkdir(path.dirname(logPath), { recursive: true })
  await rm(logPath, { force: true })

  const log = createWriteStream(logPath, { flags: "a" })
  const progressPattern = /(^\s*(\$|error|failed|exception|warning|building|built|compiling|finished|installing|success|created apk|restored|generated|info using|\[incubating\]|deprecated gradle|problems report)|apk|assemble)/i
  let lastOutput = Date.now()
  let lastNotice = Date.now()
  let timeoutError: Error | undefined

  const child = Bun.spawn([filePath, ...args], {
    cwd: commandOptions.cwd,
    env: { ...process.env, ...commandOptions.env },
    stdout: "pipe",
    stderr: "pipe",
  })

  const monitor = setInterval(() => {
    if (options.noOutputTimeoutSeconds !== 0) {
      const idleSeconds = (Date.now() - lastOutput) / 1000
      if (idleSeconds >= options.noOutputTimeoutSeconds) {
        timeoutError = new Error(`Command produced no output for ${options.noOutputTimeoutSeconds} seconds and was stopped. See log: ${logPath}`)
        child.kill()
        return
      }
    }

    const noticeSeconds = (Date.now() - lastNotice) / 1000
    if (noticeSeconds >= options.progressIntervalSeconds) {
      console.log(`Still running after ${Math.round((Date.now() - started) / 1000)}s. Full log: ${logPath}`)
      lastNotice = Date.now()
    }
  }, 1000)

  try {
    const pipe = (stream: ReadableStream<Uint8Array> | null) =>
      stream ? pipeProgress(stream, log, progressPattern, () => (lastOutput = Date.now())) : Promise.resolve()

    const [exitCode] = await Promise.all([child.exited, pipe(child.stdout), pipe(child.stderr)])
    if (timeoutError) throw timeoutError

    if (exitCode !== 0) {
      const tail = await tailLines(logPath, 40)
      if (tail) console.error(`Last 40 log lines:\n${tail}`)
      throw new Error(`Command failed with exit code ${exitCode}. See log: ${logPath}`)
    }

    console.log(`Command finished in ${Math.round((Date.now() - started) / 100) / 10}s. Full log: ${logPath}`)
  } finally {
    clearInterval(monitor)
    log.end()
  }
}

async function pipeProgress(stream: ReadableStream<Uint8Array>, log: NodeJS.WritableStream, progressPattern: RegExp, markOutput: () => void) {
  const reader = stream.getReader()
  const streamDecoder = new TextDecoder()
  let pending = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    const text = streamDecoder.decode(value, { stream: true })
    log.write(text)
    markOutput()
    pending += text

    const lines = pending.split(/\r?\n/)
    pending = lines.pop() ?? ""
    for (const line of lines) {
      if (progressPattern.test(line)) console.log(line)
    }
  }

  const rest = streamDecoder.decode()
  if (rest) {
    log.write(rest)
    pending += rest
  }

  if (pending && progressPattern.test(pending)) console.log(pending)
}

function runCommand(filePath: string, args: string[], options: { silent?: boolean } = {}) {
  try {
    const result = Bun.spawnSync([filePath, ...args], { stdout: "pipe", stderr: "pipe" })
    return {
      exitCode: result.exitCode,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    }
  } catch (error) {
    if (!options.silent) console.error(error instanceof Error ? error.message : String(error))
    return { exitCode: 127, stdout: "", stderr: error instanceof Error ? error.message : String(error) }
  }
}

function writeCommandOutput(result: { stdout: string; stderr: string }) {
  if (result.stdout.trim()) console.log(result.stdout.trimEnd())
  if (result.stderr.trim()) console.error(result.stderr.trimEnd())
}

function formatCommand(filePath: string, args: string[]) {
  return [filePath, ...args].map((part) => (/\s|"/.test(part) ? `"${part.replaceAll('"', '\\"')}"` : part)).join(" ")
}

async function tailLines(filePath: string, count: number) {
  if (!(await Bun.file(filePath).exists())) return ""
  return (await Bun.file(filePath).text()).split(/\r?\n/).slice(-count).join("\n")
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
