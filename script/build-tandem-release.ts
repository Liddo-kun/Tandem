#!/usr/bin/env bun
// Tandem-owned (not in upstream): sequential CLI/Android release build orchestration.

import { createWriteStream } from "node:fs"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { parseArgs } from "node:util"

const root = path.resolve(import.meta.dirname, "..")
const bun = process.execPath
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    version: { type: "string" },
    "allow-dev-version": { type: "boolean" },
    "single-cli": { type: "boolean" },
    "skip-cli": { type: "boolean" },
    "skip-android": { type: "boolean" },
    "package-only": { type: "boolean" },
    "debug-android": { type: "boolean" },
    "android-variant": { type: "string", default: "production" },
    "log-dir": { type: "string" },
    out: { type: "string" },
    "cli-dist": { type: "string" },
    "android-outputs": { type: "string" },
    strict: { type: "boolean" },
    "required-common": { type: "boolean" },
  },
})

if (values.help) {
  console.log(`Usage: bun script/build-tandem-release.ts [options]

Sequentially build all CLI targets from packages/cli, signed Android aarch64 APK/AAB,
then stage Tandem artifacts. No iOS, publication, installation or service restart.

  --version <version>         CLI version (or OPENCODE_VERSION; otherwise packages/cli version)
  --allow-dev-version         Use isolated local channel/timestamp CLI version when unset
  --single-cli                Build only the current CLI platform
  --skip-cli                  Skip CLI build AND collection
  --skip-android              Skip Android build AND collection
  --package-only              Package existing outputs without building
  --android-variant <name>    production (default) or side-by-side v2
  --debug-android             Build/package debug APK, not a release
  --log-dir <dir>             Full logs (Linux default /tmp/tandem/v2/release)
  --out <dir>                 Empty/new staging directory
  --cli-dist <dir>            Existing CLI outputs; requires --package-only
  --android-outputs <dir>     Existing Android outputs; requires --package-only
  --strict                   Require CLI + signed release APK/AAB
  --required-common          Require six common CLI targets + signed release APK/AAB

Generated Android project must already be initialized for the selected variant.
Signing uses existing production credentials or the isolated V2 signing helper.
See notes/tandem-release.md; master schedules builds on this shared tablet.`)
  process.exit(0)
}

if (Bun.version !== "1.4.2") throw new Error("Use the pinned Bun 1.4.2 toolchain")
if (!["production", "v2"].includes(values["android-variant"]))
  throw new Error("--android-variant must be production or v2")
if (values["skip-cli"] && values["skip-android"]) throw new Error("Cannot skip every artifact kind")
if (!values["package-only"] && (values["cli-dist"] || values["android-outputs"]))
  throw new Error("Source directory overrides require --package-only")
if (
  (values.strict || values["required-common"]) &&
  (values["skip-cli"] || values["skip-android"] || values["debug-android"])
)
  throw new Error("Strict/common releases cannot skip targets or include debug artifacts")
if (values["required-common"] && values["single-cli"] && !values["package-only"])
  throw new Error("--required-common needs the full CLI build, not --single-cli")

const output = path.resolve(root, values.out ?? "dist/tandem-release")
if (
  (
    await fs.readdir(output).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
  ).length
)
  throw new Error(`Output directory is not empty: ${output}. Use a fresh --out directory.`)

process.env.PATH = [path.dirname(bun), process.env.PATH].filter(Boolean).join(path.delimiter)
const logDir = path.resolve(
  values["log-dir"] ??
    (process.platform === "win32" ? path.join(os.tmpdir(), "tandem-v2/release") : "/tmp/tandem/v2/release"),
)
const version =
  values.version ??
  process.env.OPENCODE_VERSION ??
  (values["allow-dev-version"]
    ? `0.0.0-local-${new Date().toISOString().replace(/[-:TZ.]/g, "")}`
    : (await Bun.file(path.join(root, "packages/cli/package.json")).json()).version)
if (typeof version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version))
  throw new Error("Pass a valid --version")
process.env.OPENCODE_VERSION = version
if (values["allow-dev-version"] && !process.env.OPENCODE_CHANNEL) process.env.OPENCODE_CHANNEL = "local"

if (!values["package-only"] && !values["skip-android"]) {
  if (process.env.TAURI_CONFIG)
    throw new Error("Unset TAURI_CONFIG; use --android-variant to select the release identity")
  if (
    !values["debug-android"] &&
    !(process.env.BUNDLETOOL_JAR && (await Bun.file(process.env.BUNDLETOOL_JAR).exists()))
  )
    throw new Error("Set BUNDLETOOL_JAR to an existing JAR before building; packaging verifies AAB identity")
  const { findAndroidAapt2, loadAndroidToolchainEnv } = await import("./android-toolchain-env.ts")
  const { ensureAndroidSigning } = await import("./android-signing.ts")
  loadAndroidToolchainEnv()
  const android = path.join(root, "packages/android/src-tauri")
  const config = await Bun.file(
    path.join(android, values["android-variant"] === "v2" ? "tauri.v2.conf.json" : "tauri.conf.json"),
  ).json()
  const id = values["android-variant"] === "v2" ? "app.liddokun.tandem.v2" : "app.liddokun.tandem"
  if (config.identifier !== id) throw new Error(`Android config must identify ${id}`)
  if (!(await Bun.file(path.join(android, "gen/android/app/build.gradle.kts")).exists()))
    throw new Error("Initialize the Android generated project first; see notes/tandem-release.md")
  process.env.OPENCODE_ANDROID_VARIANT = values["android-variant"] === "v2" ? "v2" : "production"
  if (!values["debug-android"]) process.env.TANDEM_ANDROID_KEYSTORE_PROPERTIES = await ensureAndroidSigning(root, id)
  if (process.platform === "linux" && process.arch === "arm64") {
    // Same native SDK override as the tablet helper; do not let AGP download x86 aapt2.
    const aapt2 = findAndroidAapt2(process.env.ANDROID_HOME ?? "", { order: "numeric-descending", missing: "throw" })
    if (!aapt2) throw new Error("No runnable tablet aapt2; see script/tablet-android.md")
    process.env.AAPT2 ??= aapt2
    process.env.APKSIGNER ??= path.join(path.dirname(aapt2), "apksigner")
    process.env.GRADLE_OPTS = [
      process.env.GRADLE_OPTS,
      `-Dorg.gradle.project.android.aapt2FromMavenOverride=${aapt2}`,
      "-Dorg.gradle.daemon=false",
    ]
      .filter(Boolean)
      .join(" ")
    process.env.TMPDIR = "/tmp/tandem/v2/tmp"
    process.env.GRADLE_USER_HOME = "/tmp/tandem/v2/gradle"
    process.env.XDG_CACHE_HOME = "/tmp/tandem/v2/cache"
    process.env.BUN_INSTALL_CACHE_DIR = "/tmp/tandem/v2/bun-install-cache"
    await fs.mkdir(process.env.TMPDIR, { recursive: true })
  }
}

await fs.mkdir(logDir, { recursive: true })
if (!values["package-only"] && !values["skip-cli"])
  await run("cli-build", [bun, "run", "--cwd", "packages/cli", "build", ...(values["single-cli"] ? ["--single"] : [])])
if (!values["package-only"] && !values["skip-android"])
  await run("android-build", [
    bun,
    "run",
    "--cwd",
    "packages/android",
    "tauri",
    "android",
    "build",
    "--apk",
    ...(values["debug-android"] ? ["--debug"] : ["--aab", "--ci"]),
    "--target",
    "aarch64",
    ...(values["android-variant"] === "v2"
      ? ["--config", path.join(root, "packages/android/src-tauri/tauri.v2.conf.json")]
      : []),
  ])
const packageArgs = ["--android-variant", values["android-variant"]]
for (const key of ["out", "cli-dist", "android-outputs"] as const)
  if (values[key]) packageArgs.push(`--${key}`, values[key])
for (const key of ["skip-cli", "skip-android", "strict", "required-common"] as const)
  if (values[key]) packageArgs.push(`--${key}`)
if (values["debug-android"]) packageArgs.push("--include-debug-android")
await run("tandem-package", [bun, "run", "script/package-tandem-release.ts", ...packageArgs])

async function run(name: string, command: string[]) {
  const file = path.join(logDir, `${name}.log`)
  console.log(`${name}: full log ${file}`)
  const log = createWriteStream(file)
  const proc = Bun.spawn(command, { cwd: root, env: process.env, stdin: "inherit", stdout: "pipe", stderr: "pipe" })
  const [code] = await Promise.all([proc.exited, pipe(proc.stdout, log), pipe(proc.stderr, log)])
  await new Promise<void>((resolve, reject) =>
    log.end((error: Error | null | undefined) => (error ? reject(error) : resolve())),
  )
  if (code !== 0) throw new Error(`${name} failed (${code}); see ${file}`)
}

async function pipe(stream: ReadableStream<Uint8Array>, log: NodeJS.WritableStream) {
  let buffer = ""
  const decoder = new TextDecoder()
  for await (const chunk of stream) {
    const text = decoder.decode(chunk, { stream: true })
    log.write(text)
    const lines = (buffer + text).split(/\r?\n/)
    buffer = lines.pop() ?? ""
    for (const line of lines)
      if (/error|fail|exception|warning|building|built|passed|finished|staged|not packaged/i.test(line))
        console.log(line)
  }
  const tail = decoder.decode()
  log.write(tail)
  if (buffer + tail) console.log(buffer + tail)
}
