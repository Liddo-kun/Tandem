#!/usr/bin/env bun
// Tandem-owned (not in upstream): build (and optionally install) the Tandem Android app natively
// on the tablet. Builds the daily app by default, or the side-by-side Tandem V2 test app with --dev.
// See notes/tandem-setup.md for signing and the toolchain.

import { createWriteStream } from "fs"
import { existsSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { findAndroidAapt2, loadAndroidToolchainEnv } from "./android-toolchain-env.ts"
import { ensureAndroidSigning } from "./android-signing.ts"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const args = process.argv.slice(2)

// Rerun under the pinned Bun so `bun run tandem:tablet` works from any shell.
if (Bun.version !== "1.4.2") {
  const pinned = path.join(os.homedir(), ".local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun")
  if (!existsSync(pinned)) throw new Error(`Tandem builds need Bun 1.4.2: ${pinned}`)
  const proc = Bun.spawn([pinned, fileURLToPath(import.meta.url), ...args], { stdio: ["inherit", "inherit", "inherit"] })
  process.exit(await proc.exited)
}
const bun = process.execPath

let doSetup = false
let doInstall = false
let overwrite = false
let release = true
let dev = false
let device = process.env["ANDROID_SERIAL"] ?? ""

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  switch (arg) {
    case "--help":
    case "-h":
      printHelp()
      process.exit(0)
    case "--setup":
      doSetup = true
      break
    case "--install":
      doInstall = true
      break
    case "--overwrite":
      doInstall = true
      overwrite = true
      break
    case "--debug":
      release = false
      break
    case "--dev":
      dev = true
      break
    case "--device":
      device = requireValue(arg, args[++i])
      break
    default:
      throw new Error(`Unknown option: ${arg}. Run bun script/build-tablet-android.ts --help`)
  }
}

if (process.platform !== "linux" || process.arch !== "arm64") {
  throw new Error("This tablet build requires aarch64 Linux.")
}

const config = dev ? path.join(root, "packages/android/src-tauri/tauri.v2.conf.json") : undefined
const logDir = "/tmp/tandem/v2"
await fs.mkdir(logDir, { recursive: true })
process.env["TMPDIR"] = path.join(logDir, "tmp")
await fs.mkdir(process.env["TMPDIR"], { recursive: true })
process.env["GRADLE_USER_HOME"] = path.join(logDir, "gradle")
process.env["XDG_CACHE_HOME"] = path.join(logDir, "cache")
process.env["BUN_INSTALL_CACHE_DIR"] = path.join(logDir, "bun-install-cache")
process.env["OPENCODE_ANDROID_VARIANT"] = dev ? "v2" : "production"
process.env["PATH"] = [path.dirname(bun), process.env["PATH"]].filter(Boolean).join(path.delimiter)
const expectedId = dev ? "app.liddokun.tandem.v2" : "app.liddokun.tandem"
const applicationId = await resolveApplicationId()
if (applicationId !== expectedId) {
  throw new Error(`Expected ${expectedId}; build config resolves to ${applicationId}.`)
}

if (doSetup) await runSetup()
loadAndroidToolchainEnv()
await preflight()
if (release) process.env["TANDEM_ANDROID_KEYSTORE_PROPERTIES"] = await ensureAndroidSigning(root, applicationId)
await ensureAndroidProject()

const variant = release ? "release" : "debug"
await runStep(
  `Android ${variant} APK`,
  [
    bun,
    "run",
    "--cwd",
    "packages/android",
    "tauri",
    "android",
    "build",
    "--apk",
    ...(release ? [] : ["--debug"]),
    "--target",
    "aarch64",
    ...(config ? ["--config", config] : []),
  ],
  path.join(logDir, "android-build.log"),
  /error|fail|exception|warning|building|built|assemble|apk|finished/i,
)

const apk = path.join(
  root,
  `packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/${variant}/app-universal-${variant}.apk`,
)
if (!existsSync(apk)) throw new Error(`Build reported success but APK is missing: ${apk}`)
console.log(`\nAPK: ${apk}`)
const metadata = await capture([findAndroidAapt2(process.env["ANDROID_HOME"]!)!, "dump", "badging", apk])
const apkApplicationId = metadata.stdout.match(/^package: name='([^']+)'/m)?.[1]
if (metadata.code !== 0 || apkApplicationId !== applicationId) {
  throw new Error(`APK application ID ${apkApplicationId ?? "unreadable"} differs from build config ${applicationId}.`)
}
console.log(`Application ID: ${apkApplicationId}`)

if (doInstall) await install(apk)

// --- helpers ---------------------------------------------------------------

async function resolveApplicationId() {
  const base = path.join(root, "packages/android/src-tauri")
  let identifier: unknown
  for (const file of [path.join(base, "tauri.conf.json"), path.join(base, "tauri.android.conf.json"), config]) {
    if (!file) continue
    if (!(await Bun.file(file).exists())) {
      if (file === path.join(base, "tauri.android.conf.json")) continue
      throw new Error(`Missing Android build config: ${file}`)
    }
    const value = await Bun.file(file).json()
    if (value.identifier !== undefined) identifier = value.identifier
  }
  if (process.env["TAURI_CONFIG"]) {
    throw new Error("Use --config <JSON file> instead of TAURI_CONFIG so the build identity is explicit.")
  }
  if (typeof identifier !== "string" || !/^[a-zA-Z][\w]*(\.[a-zA-Z][\w]*)+$/.test(identifier)) {
    throw new Error("Android Tauri JSON configuration must define a valid identifier.")
  }
  return identifier
}

// Both apps share Tauri's single generated project, so regenerate it when it belongs to the other app.
async function ensureAndroidProject() {
  const project = path.join(root, "packages/android/src-tauri/gen/android")
  const gradle = Bun.file(path.join(project, "app/build.gradle.kts"))
  if ((await gradle.exists()) && (await gradle.text()).includes(`namespace = "${applicationId}"`)) return
  await fs.rm(project, { recursive: true, force: true })
  await runStep(
    `Android project for ${applicationId}`,
    [
      bun,
      "run",
      "--cwd",
      "packages/android",
      "tauri",
      "android",
      "init",
      "--ci",
      "--skip-targets-install",
      ...(config ? ["--config", config] : []),
    ],
    path.join(logDir, "android-init.log"),
    /error|fail|warning/i,
  )
}

async function preflight() {
  const sdk = process.env["ANDROID_HOME"] ?? path.join(os.homedir(), "Android/Sdk")
  const problems: string[] = []
  if (!existsSync(path.join(os.homedir(), ".cargo/bin/cargo")) && !which("cargo")) problems.push("rust/cargo")
  if (!which("java")) problems.push("java (JDK 17)")
  if (release && !which("keytool")) problems.push("keytool (JDK 17)")
  if (!process.env["NDK_HOME"] || !existsSync(process.env["NDK_HOME"]))
    problems.push("Android NDK under ~/Android/Sdk/ndk")
  const aapt2 = findAndroidAapt2(sdk)
  if (!aapt2) problems.push("arm64 build-tools (aapt2)")
  if (aapt2) {
    const version = await capture([aapt2, "version"])
    if (version.code !== 0) problems.push(`runnable arm64 aapt2: ${aapt2}`)
    // Gradle's project system properties override the Maven-host aapt2 choice.
    process.env["GRADLE_OPTS"] = [
      process.env["GRADLE_OPTS"],
      `-Dorg.gradle.project.android.aapt2FromMavenOverride=${aapt2}`,
      "-Dorg.gradle.daemon=false",
    ].filter(Boolean).join(" ")
  }

  if (problems.length > 0) {
    throw new Error(
      `Android toolchain is not set up:\n- ${problems.join("\n- ")}\n` +
        `Explicit toolchain setup: bash script/setup-tablet-android.sh. See notes/tandem-setup.md`,
    )
  }
}

async function runSetup() {
  const script = path.join(root, "script/setup-tablet-android.sh")
  await runStep("Toolchain setup", ["bash", script], path.join(logDir, "android-setup.log"), undefined)
}

async function install(apk: string) {
  const adb = existsSync("/usr/bin/adb") ? "/usr/bin/adb" : "adb"
  const serial = await resolveDevice(adb)
  if (!serial) {
    throw new Error(
      "No ADB device. Connect the tablet (e.g. `adb connect 127.0.0.1:5555`) or run `adb-reconnect`, then retry. " +
        "Pass --device <serial> to target a specific one.",
    )
  }
  console.log(`\nInstalling to ${serial}...`)
  let res = await capture([adb, "-s", serial, "install", "-r", apk])
  if (res.code !== 0 && /signatures do not match|INSTALL_FAILED_UPDATE_INCOMPATIBLE/i.test(res.stdout + res.stderr)) {
    if (!dev) throw new Error(`Signature mismatch with the installed daily ${applicationId}; it is never uninstalled.`)
    if (!overwrite) {
      throw new Error(
        `Signature mismatch with installed ${applicationId}. ` +
          "Re-run with --overwrite to uninstall it first (this erases that app's data).",
      )
    }
    console.log(`Signature mismatch; uninstalling ${apkApplicationId} then reinstalling...`)
    const removed = await capture([adb, "-s", serial, "uninstall", apkApplicationId!])
    if (removed.code !== 0) throw new Error(`adb uninstall failed: ${removed.stdout}${removed.stderr}`)
    res = await capture([adb, "-s", serial, "install", apk])
  }
  console.log((res.stdout + res.stderr).trim())
  if (res.code !== 0) throw new Error("adb install failed.")
  console.log("Installed.")
}

async function resolveDevice(adb: string) {
  if (device) {
    await capture([adb, "connect", device])
    return device
  }
  const connected = () =>
    capture([adb, "devices"]).then(({ stdout }) =>
      stdout
        .split(/\r?\n/)
        .slice(1)
        .map((l) => l.trim().split(/\s+/))
        .filter(([s, state]) => s && state === "device")
        .map(([s]) => s!),
    )
  let devices = await connected()
  if (devices.length === 0) {
    await capture([adb, "connect", "127.0.0.1:5555"])
    devices = await connected()
  }
  // Prefer loopback when the same device shows up on several transports.
  return devices.find((d) => d.startsWith("127.0.0.1")) ?? devices[0]
}

async function runStep(name: string, command: string[], log: string, filter: RegExp | undefined) {
  console.log(`\n=== ${name} ===`)
  console.log(`Full log: ${log}`)
  const out = createWriteStream(log, { flags: "w" })
  out.write(`$ ${command.join(" ")}\n\n`)
  const proc = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env },
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code] = await Promise.all([proc.exited, pipe(proc.stdout, out, filter), pipe(proc.stderr, out, filter)])
  await new Promise<void>((resolve, reject) => out.end((e: Error | null | undefined) => (e ? reject(e) : resolve())))
  if (code !== 0) {
    const hint = (await Bun.file(log).text()).includes("file watch limit")
      ? "\nThe tablet ran out of inotify watches; see notes/tandem-setup.md (inotify)."
      : ""
    throw new Error(`${name} failed with exit code ${code}. See ${log}${hint}`)
  }
}

async function pipe(stream: ReadableStream<Uint8Array> | null, out: NodeJS.WritableStream, filter: RegExp | undefined) {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    out.write(text)
    const lines = (buffer + text).split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines) if (!filter || filter.test(stripAnsi(line))) console.log(line)
  }
  if (buffer && (!filter || filter.test(stripAnsi(buffer)))) console.log(buffer)
}

async function capture(command: string[]) {
  const proc = Bun.spawn(command, { cwd: root, env: { ...process.env }, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, stdout, stderr }
}

function which(cmd: string) {
  for (const dir of (process.env["PATH"] ?? "").split(path.delimiter)) {
    if (dir && existsSync(path.join(dir, cmd))) return true
  }
  return false
}

function stripAnsi(value: string) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

function requireValue(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} requires a value.`)
  return value
}

function printHelp() {
  console.log(`Usage: bun run tandem:tablet -- [options]

Builds the Tandem release APK (app.liddokun.tandem, production key) natively on aarch64 Linux,
or the side-by-side Tandem V2 test app (app.liddokun.tandem.v2) with --dev. Reruns itself under
the pinned Bun 1.4.2 and regenerates the shared Android project when it belongs to the other app.

Options:
  --install      adb install -r the APK after building
  --dev          Build the Tandem V2 test app instead of the daily app
  --overwrite    With --dev: like --install, but uninstall a signature-mismatched test app first
                 (erases its data). The daily app is never uninstalled.
  --debug        Build a debug APK instead of release
  --setup        Run the one-time toolchain setup (script/setup-tablet-android.sh) first
  --device <s>   Target ADB serial (else auto: connects loopback, prefers loopback)
  -h, --help     Show this help

Examples:
  bun run tandem:tablet -- --install
  bun run tandem:tablet -- --dev --install`)
}
