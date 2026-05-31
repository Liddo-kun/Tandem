#!/usr/bin/env bun

import { createWriteStream } from "fs"
import fs from "fs/promises"
import os from "os"
import path from "path"
import { fileURLToPath } from "url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
const bun = process.execPath
const args = process.argv.slice(2)

type RunStep = {
  name: string
  command: string[]
  log: string
  filter?: RegExp
}

const cliFilter = /error|fail|exception|warning|building|smoke test|passed|finished/i
const androidFilter = /error|fail|exception|warning|building|built|assemble|apk|passed|finished/i

let singleCli = false
let packageOnly = false
let skipCli = false
let skipAndroid = false
let skipIos = false
let allowPartial = false
let debugAndroid = false
let allowDevVersion = false
let releaseVersion = process.env["OPENCODE_VERSION"]
let logDir = defaultLogDir()
const packageArgs: string[] = []

for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  switch (arg) {
    case "--help":
    case "-h":
      printHelp()
      process.exit(0)
    case "--single-cli":
      singleCli = true
      break
    case "--package-only":
      packageOnly = true
      break
    case "--skip-cli":
      skipCli = true
      break
    case "--skip-android":
      skipAndroid = true
      break
    case "--skip-ios":
      skipIos = true
      break
    case "--allow-partial":
      allowPartial = true
      break
    case "--debug-android":
      debugAndroid = true
      packageArgs.push("--include-debug-android")
      break
    case "--allow-dev-version":
      allowDevVersion = true
      break
    case "--log-dir":
      logDir = requireValue(arg, args[++i])
      break
    case "--version":
      releaseVersion = requireValue(arg, args[++i])
      break
    case "--out":
    case "--ios-ipa":
    case "--upload":
    case "--repo":
      packageArgs.push(arg, requireValue(arg, args[++i]))
      break
    case "--strict":
    case "--install-windows":
    case "--no-clean":
    case "--required-common":
    case "--include-debug-android":
      packageArgs.push(arg)
      break
    default:
      throw new Error(`Unknown option: ${arg}. Run bun run tandem:release -- --help`)
  }
}

await fs.mkdir(logDir, { recursive: true })
if (releaseVersion) process.env["OPENCODE_VERSION"] = releaseVersion
if (!releaseVersion && !allowDevVersion) {
  throw new Error("Tandem release builds require --version <version> or OPENCODE_VERSION. Use --allow-dev-version only for local test builds.")
}
if (!allowPartial && !packageArgs.includes("--required-common")) packageArgs.push("--required-common")
if (!allowPartial && !packageArgs.includes("--strict")) packageArgs.push("--strict")
if (!packageOnly && !skipAndroid && !debugAndroid) await preflightAndroidSigning()
if (!packageOnly && !allowPartial) await preflightReleaseInputs()

const steps: RunStep[] = []
if (!packageOnly && !skipCli) {
  steps.push({
    name: singleCli ? "CLI current platform" : "CLI all platforms",
    command: [bun, "run", "--cwd", "packages/opencode", "build", ...(singleCli ? ["--single"] : [])],
    log: path.join(logDir, "opencode-build.log"),
    filter: cliFilter,
  })
}
if (!packageOnly && !skipAndroid) {
  steps.push({
    name: debugAndroid ? "Android debug APK" : "Android release APK/AAB",
    command: debugAndroid
      ? [bun, "run", "--cwd", "packages/android", "tauri", "android", "build", "--apk", "--debug", "--target", "aarch64"]
      : [bun, "run", "--cwd", "packages/android", "tauri", "android", "build", "--apk", "--aab", "--target", "aarch64", "--ci"],
    log: path.join(logDir, "android-build.log"),
    filter: androidFilter,
  })
}
if (!packageOnly && !skipIos) {
  steps.push({
    name: "iOS web assets",
    command: [bun, "run", "--cwd", "packages/ios", "build"],
    log: path.join(logDir, "ios-build.log"),
    filter: /error|fail|exception|warning|building|built|passed|finished/i,
  })
}
steps.push({
  name: "Tandem packaging",
  command: [bun, "run", "script/package-tandem-release.ts", ...packageArgs],
  log: path.join(logDir, "tandem-package.log"),
})

console.log(`Tandem release build logs: ${logDir}`)
for (const step of steps) await run(step)

function printHelp() {
  console.log(`Usage: bun run tandem:release [options]

Builds Tandem release artifacts with filtered console output, then stages Tandem-named assets.

Default steps:
  1. Full CLI build through packages/opencode/script/build.ts
     This covers macOS arm64/x64, Windows x64/arm64, Linux x64/arm64,
     plus the OpenCode baseline and musl variants when that build script emits them.
  2. Android aarch64 release APK/AAB build through Tauri
  3. iOS web asset build
  4. Tandem release packaging into dist/tandem-release

Default packaging is strict and requires macOS arm64/x64, Windows x64/arm64,
Linux x64/arm64, Android APK/AAB, and iOS IPA. The repo currently has iOS web
source but no checked-in Xcode project, so put a signed .ipa under packages/ios/build
or pass --ios-ipa <path> before a full strict release.

Options:
  --version <version>   Version to embed in CLI builds. Can also use OPENCODE_VERSION
  --single-cli          Build only the current-platform CLI instead of all CLI targets
  --package-only        Skip builds and package existing outputs
  --skip-cli            Skip the CLI build
  --skip-android        Skip the Android build
  --skip-ios            Skip the iOS web asset build
  --allow-partial       Do not require the full common release set
  --allow-dev-version   Permit 0.0.0-dev timestamp versions for local test builds
  --debug-android       Build/package a debug APK. Do not use for releases
  --log-dir <dir>       Full build log directory. Default: ${defaultLogDir()}
  --out <dir>           Forwarded to tandem:package
  --ios-ipa <path>      Forwarded to tandem:package; include an exported iOS .ipa
  --strict              Forwarded to tandem:package; require CLI, Android, and iOS artifacts
  --required-common     Forwarded to tandem:package; require the common full release set
  --install-windows     Forwarded to tandem:package; install C:\\Program_Files\\tandem.exe
  --upload <tag>        Forwarded to tandem:package; upload to existing GitHub release
  --repo <owner/name>   Forwarded to tandem:package; repo for --upload
  --no-clean            Forwarded to tandem:package

Examples:
  bun run tandem:release -- --version 1.2.3
  bun run tandem:release -- --version 1.2.3 --ios-ipa packages/ios/build/Tandem.ipa
  bun run tandem:release -- --single-cli --allow-partial --allow-dev-version --debug-android --install-windows
`)
}

async function preflightReleaseInputs() {
  const missing: string[] = []
  if (!hasForwarded("--ios-ipa") && !(await hasStandardIosIpa())) {
    missing.push("signed iOS .ipa under packages/ios/build, packages/ios/dist, packages/ios/export, or --ios-ipa <path>")
  }
  if (missing.length > 0) {
    throw new Error(`Missing release input(s):\n- ${missing.join("\n- ")}\nUse --allow-partial only for local/test builds.`)
  }
}

async function preflightAndroidSigning() {
  const missing = []
  if (!(await exists(path.join(root, "packages/android/release.keystore")))) missing.push("packages/android/release.keystore")
  if (!(await exists(path.join(root, "packages/android/keystore.properties")))) missing.push("packages/android/keystore.properties")
  if (missing.length > 0) {
    throw new Error(`Missing Android release signing input(s):\n- ${missing.join("\n- ")}\nUse --debug-android only for local debug APKs.`)
  }
}

async function run(step: RunStep) {
  console.log(`\n=== ${step.name} ===`)
  console.log(`Full log: ${step.log}`)

  await fs.mkdir(path.dirname(step.log), { recursive: true })
  const log = createWriteStream(step.log, { flags: "w" })
  log.write(`$ ${quoteCommand(step.command)}\n\n`)

  const proc = Bun.spawn(step.command, {
    cwd: root,
    stdin: "inherit",
    stdout: "pipe",
    stderr: "pipe",
  })

  const [code] = await Promise.all([proc.exited, pipe(proc.stdout, log, step.filter), pipe(proc.stderr, log, step.filter)])
  await new Promise<void>((resolve, reject) => {
    log.end((error: Error | null | undefined) => (error ? reject(error) : resolve()))
  })

  if (code !== 0) throw new Error(`${step.name} failed with exit code ${code}. See ${step.log}`)
}

async function pipe(stream: ReadableStream<Uint8Array> | null, log: NodeJS.WritableStream, filter: RegExp | undefined) {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ""

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const text = decoder.decode(value, { stream: true })
    log.write(text)
    buffer = printCompleteLines(buffer + text, filter)
  }

  const tail = decoder.decode()
  if (tail) {
    log.write(tail)
    buffer = printCompleteLines(buffer + tail, filter)
  }
  if (buffer) printLine(buffer, filter)
}

function printCompleteLines(text: string, filter: RegExp | undefined) {
  const lines = text.split(/\r?\n/)
  const rest = lines.pop() ?? ""
  for (const line of lines) printLine(line, filter)
  return rest
}

function printLine(line: string, filter: RegExp | undefined) {
  if (!filter || filter.test(stripAnsi(line))) console.log(line)
}

function stripAnsi(value: string) {
  return value.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "")
}

function defaultLogDir() {
  return process.platform === "win32" ? "C:\\Temp\\opencode" : path.join(os.tmpdir(), "opencode")
}

async function hasStandardIosIpa() {
  for (const dir of ["build", "dist", "export"].map((item) => path.join(root, "packages/ios", item))) {
    if ((await globFiles(dir, ["**/*.ipa"])).length > 0) return true
  }
  return false
}

async function globFiles(cwd: string, patterns: string[]) {
  if (!(await isDirectory(cwd))) return []
  const files = new Set<string>()
  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for await (const item of glob.scan({ cwd })) files.add(path.join(cwd, item))
  }
  return [...files]
}

async function exists(file: string) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

async function isDirectory(file: string) {
  try {
    return (await fs.stat(file)).isDirectory()
  } catch {
    return false
  }
}

function hasForwarded(name: string) {
  return packageArgs.includes(name)
}

function requireValue(name: string, value: string | undefined) {
  if (!value) throw new Error(`${name} requires a value.`)
  return value
}

function quoteCommand(command: string[]) {
  return command.map((part) => (/[\s"]/g.test(part) ? JSON.stringify(part) : part)).join(" ")
}
