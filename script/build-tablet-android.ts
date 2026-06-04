#!/usr/bin/env bun
// Build (and optionally install) the Tandem Android debug APK natively on the tablet,
// inside the aarch64 chroot. The tablet counterpart to `tandem:release`.
//
//   bun run tandem:tablet                 build the debug APK
//   bun run tandem:tablet -- --install    build + adb install to the connected device
//   bun run tandem:tablet -- --setup      run the one-time toolchain setup first
//
// Toolchain details and rationale: packages/android/apkbuildontablet.md

import { createWriteStream } from "fs"
import { existsSync, readdirSync } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"
import { loadAndroidToolchainEnv } from "./android-toolchain-env.ts"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const bun = process.execPath
const args = process.argv.slice(2)

let doSetup = false
let doInstall = false
let overwrite = false
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
    case "--device":
      device = requireValue(arg, args[++i])
      break
    default:
      throw new Error(`Unknown option: ${arg}. Run bun run tandem:tablet -- --help`)
  }
}

if (process.platform !== "linux" || process.arch !== "arm64") {
  throw new Error("tandem:tablet is for the aarch64 Linux chroot. Use tandem:release on the Windows box.")
}

const logDir = path.join(os.tmpdir(), "opencode")
await fs.mkdir(logDir, { recursive: true })

if (doSetup) await runSetup()
loadAndroidToolchainEnv()
await preflight()

await runStep(
  "Android debug APK",
  [bun, "run", "--cwd", "packages/android", "tauri", "android", "build", "--apk", "--debug", "--target", "aarch64"],
  path.join(logDir, "android-build.log"),
  /error|fail|exception|warning|building|built|assemble|apk|finished/i,
)

const apk = path.join(
  root,
  "packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk",
)
if (!existsSync(apk)) throw new Error(`Build reported success but APK is missing: ${apk}`)
console.log(`\nAPK: ${apk}`)

if (doInstall) await install(apk)

// --- helpers ---------------------------------------------------------------

async function preflight() {
  const sdk = process.env["ANDROID_HOME"]!
  const problems: string[] = []
  if (!existsSync(path.join(os.homedir(), ".cargo/bin/cargo")) && !which("cargo")) problems.push("rust/cargo")
  if (!which("java")) problems.push("java (JDK 17)")
  if (!process.env["NDK_HOME"] || !existsSync(process.env["NDK_HOME"])) problems.push("Android NDK under ~/Android/Sdk/ndk")
  const aapt2 = firstAapt2(sdk)
  if (!aapt2) problems.push("arm64 build-tools (aapt2)")

  if (problems.length > 0) {
    throw new Error(
      `Android toolchain is not set up:\n- ${problems.join("\n- ")}\n` +
        `Run it once with:  bun run tandem:tablet -- --setup\n` +
        `(or: bash script/setup-tablet-android.sh). See packages/android/apkbuildontablet.md`,
    )
  }
}

function firstAapt2(sdk: string) {
  const dir = path.join(sdk, "build-tools")
  if (!existsSync(dir)) return undefined
  return readdirSync(dir)
    .sort()
    .reverse()
    .map((v) => path.join(dir, v, "aapt2"))
    .find(existsSync)
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
    if (!overwrite) {
      throw new Error(
        "Signature mismatch with the installed app (likely a release-signed Tandem). " +
          "Re-run with --overwrite to uninstall it first (this erases that app's data).",
      )
    }
    console.log("Signature mismatch; uninstalling existing app.liddokun.tandem then reinstalling...")
    await capture([adb, "-s", serial, "uninstall", "app.liddokun.tandem"])
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
    for (const target of ["127.0.0.1:5555", "192.168.1.85:5555"]) await capture([adb, "connect", target])
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
  const proc = Bun.spawn(command, { cwd: root, env: { ...process.env }, stdin: "inherit", stdout: "pipe", stderr: "pipe" })
  const [code] = await Promise.all([proc.exited, pipe(proc.stdout, out, filter), pipe(proc.stderr, out, filter)])
  await new Promise<void>((resolve, reject) => out.end((e: Error | null | undefined) => (e ? reject(e) : resolve())))
  if (code !== 0) throw new Error(`${name} failed with exit code ${code}. See ${log}`)
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
  const [code, stdout, stderr] = await Promise.all([proc.exited, new Response(proc.stdout).text(), new Response(proc.stderr).text()])
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
  console.log(`Usage: bun run tandem:tablet [options]

Builds the Tandem Android debug APK natively in the aarch64 chroot, and optionally
installs it on the connected device. The on-tablet counterpart to tandem:release.

Options:
  --setup        Run the one-time toolchain setup (script/setup-tablet-android.sh) first
  --install      adb install -r the APK after building
  --overwrite    Like --install, but uninstall a signature-mismatched app first (erases its data)
  --device <s>   Target ADB serial (else auto: connects 127.0.0.1:5555 / LAN, prefers loopback)
  -h, --help     Show this help

Examples:
  bun run tandem:tablet -- --setup --install
  bun run tandem:tablet -- --install
  bun run tandem:tablet -- --overwrite`)
}
