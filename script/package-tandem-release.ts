#!/usr/bin/env bun

import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { parseArgs } from "node:util"

const root = path.resolve(import.meta.dirname, "..")
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    help: { type: "boolean", short: "h" },
    out: { type: "string" },
    "cli-dist": { type: "string" },
    "android-outputs": { type: "string" },
    "android-variant": { type: "string", default: "production" },
    "skip-cli": { type: "boolean" },
    "skip-android": { type: "boolean" },
    "include-debug-android": { type: "boolean" },
    strict: { type: "boolean" },
    "required-common": { type: "boolean" },
    upload: { type: "string" },
    repo: { type: "string", default: "Liddo-kun/Tandem" },
  },
})

if (values.help) {
  console.log(`Usage: bun script/package-tandem-release.ts [options]

Stage existing CLI and signed Android outputs as Tandem assets, manifest.json and SHA256SUMS.
Does not build or install. iOS is not part of this release workflow.

  --out <dir>                 Empty/new output directory (default dist/tandem-release)
  --cli-dist <dir>            CLI build tree (default packages/cli/dist)
  --android-outputs <dir>     Gradle app/build/outputs tree
  --android-variant <name>    production (default) or v2; verify actual app identity
  --skip-cli                 Do not collect CLI outputs
  --skip-android             Do not collect Android outputs
  --include-debug-android    Include signed debug APKs, never unsigned artifacts
  --strict                   Require CLI and signed release Android APK + AAB
  --required-common          Also require six common CLI OS/architecture targets
  --upload <tag>             Explicitly upload this staging set to an existing release
  --repo <owner/name>         Upload repo (default Liddo-kun/Tandem)

Android verification uses AAPT2, APKSIGNER and BUNDLETOOL_JAR (for AAB), plus jarsigner.
See notes/tandem-release.md for tool paths and separate installation commands.`)
  process.exit(0)
}

if (!["production", "v2"].includes(values["android-variant"]))
  throw new Error("--android-variant must be production or v2")
if (values["skip-cli"] && values["skip-android"]) throw new Error("Cannot skip every artifact kind")
if (
  (values.strict || values["required-common"]) &&
  (values["skip-cli"] || values["skip-android"] || values["include-debug-android"])
) {
  throw new Error("Strict/common packaging requires release CLI and Android inputs without skip/debug flags")
}
if (values.upload && (values["android-variant"] !== "production" || values["include-debug-android"])) {
  throw new Error("Development/debug artifacts are local staging only")
}

const out = path.resolve(root, values.out ?? "dist/tandem-release")
const cliDist = path.resolve(root, values["cli-dist"] ?? "packages/cli/dist")
const androidOutputs = path.resolve(
  root,
  values["android-outputs"] ?? "packages/android/src-tauri/gen/android/app/build/outputs",
)
const applicationId = values["android-variant"] === "v2" ? "app.liddokun.tandem.v2" : "app.liddokun.tandem"
type Input = {
  kind: "cli" | "android"
  source: string
  name: string
  applicationId?: string
  debug?: boolean
  version?: string
}
const inputs: Input[] = []
const missing: string[] = []

// Validate all inputs before writing any staging output. Never recursively delete a caller's --out.
if (
  (
    await fs.readdir(out).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
  ).length
)
  throw new Error(`Output directory is not empty: ${out}. Use a fresh --out directory.`)

if (!values["skip-cli"]) {
  for (const entry of await fs.readdir(cliDist, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return []
    throw error
  })) {
    if (!entry.isDirectory() || !entry.name.startsWith("cli-")) continue
    // Bun has no distinct macOS non-AVX2 runtime; Linux/Windows baselines are distinct.
    if (entry.name === "cli-darwin-x64-baseline") continue
    const executable = entry.name.includes("windows") ? "opencode.exe" : "opencode"
    const candidates = [
      path.join(cliDist, entry.name, "bin", executable),
      path.join(cliDist, entry.name, "bin", "opencode"),
    ]
    const source = (
      await Promise.all(candidates.map(async (file) => ((await Bun.file(file).exists()) ? file : undefined)))
    ).find(Boolean)
    if (!source) continue
    const metadata = await Bun.file(path.join(cliDist, entry.name, "package.json")).json()
    if (typeof metadata.version !== "string") throw new Error(`Missing CLI version metadata: ${entry.name}`)
    inputs.push({
      kind: "cli",
      source,
      name: entry.name.replace(/^cli-/, "tandem-") + (executable.endsWith(".exe") ? ".exe" : ""),
      version: metadata.version,
    })
  }
  if (!inputs.length) missing.push("CLI: no cli-*/bin/opencode outputs; build packages/cli first")
  if (new Set(inputs.map((input) => input.version)).size > 1)
    throw new Error("CLI outputs contain mixed versions; rebuild a consistent release set")
}

if (!values["skip-android"]) {
  const files = await fs
    .stat(androidOutputs)
    .then(() => Array.fromAsync(new Bun.Glob("**/*.{apk,aab}").scan({ cwd: androidOutputs, absolute: true })))
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return []
      throw error
    })
  for (const source of files.sort()) {
    const debug = /debug/i.test(source)
    if (/unsigned/i.test(path.basename(source)) || (debug && !values["include-debug-android"])) continue
    const id = await verifyAndroid(source)
    if (id !== applicationId)
      throw new Error(
        `Android identity mismatch: ${source} contains ${id}, expected ${applicationId}. Clean/rebuild the selected variant.`,
      )
    const stem = path
      .parse(source)
      .name.replace(/^app[-_]?/i, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .toLowerCase()
    inputs.push({
      kind: "android",
      source,
      name: `tandem-android${values["android-variant"] === "v2" ? "-v2" : ""}-${stem}${path.extname(source)}`,
      applicationId: id,
      debug,
    })
  }
  if (!inputs.some((input) => input.kind === "android"))
    missing.push("Android: no signed APK/AAB outputs for the selected variant")
}

if (!inputs.length) throw new Error(`No release artifacts found.\n${missing.join("\n")}`)
if (new Set(inputs.map((input) => input.name)).size !== inputs.length)
  throw new Error("Duplicate artifact filenames; select one build output tree")
if (values.strict || values["required-common"]) {
  const required = values["required-common"]
    ? ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64", "windows-arm64.exe", "windows-x64.exe"].filter(
        (target) => !inputs.some((input) => input.name === `tandem-${target}`),
      )
    : inputs.some((input) => input.kind === "cli")
      ? []
      : ["CLI"]
  for (const extension of [".apk", ".aab"]) {
    if (!inputs.some((input) => input.kind === "android" && !input.debug && input.name.endsWith(extension)))
      required.push(`signed release Android ${extension}`)
  }
  if (required.length) throw new Error(`Missing required release artifacts: ${required.join(", ")}`)
}

await fs.mkdir(out, { recursive: true })
const artifacts = []
for (const input of inputs.sort((a, b) => a.name.localeCompare(b.name))) {
  const output = path.join(out, input.name)
  await fs.copyFile(input.source, output)
  if (input.kind === "cli" && !input.name.endsWith(".exe")) await fs.chmod(output, 0o755)
  artifacts.push({
    kind: input.kind,
    source: relative(input.source),
    output: relative(output),
    bytes: (await fs.stat(output)).size,
    sha256: await sha256File(output),
    ...(input.version ? { version: input.version } : {}),
    ...(input.applicationId ? { applicationId: input.applicationId, debug: input.debug } : {}),
  })
}
const manifest = path.join(out, "manifest.json")
await Bun.write(
  manifest,
  JSON.stringify({ brand: "Tandem", generatedAt: new Date().toISOString(), artifacts, missing }, null, 2) + "\n",
)
await Bun.write(
  path.join(out, "SHA256SUMS"),
  [
    ...artifacts.map((artifact) => `${artifact.sha256}  ${path.basename(artifact.output)}`),
    `${await sha256File(manifest)}  manifest.json`,
  ]
    .sort()
    .join("\n") + "\n",
)
console.log(`Staged ${artifacts.length} Tandem artifacts in ${out}`)
for (const artifact of artifacts) console.log(`- ${path.basename(artifact.output)}`)
for (const item of missing) console.log(`Not packaged: ${item}`)
if (values.upload) {
  await capture([
    "gh",
    "release",
    "upload",
    values.upload,
    ...artifacts.map((artifact) => path.resolve(root, artifact.output)),
    manifest,
    path.join(out, "SHA256SUMS"),
    "--clobber",
    "--repo",
    values.repo,
  ])
}

async function verifyAndroid(file: string) {
  if (file.endsWith(".apk")) {
    await capture([process.env.APKSIGNER ?? "apksigner", "verify", file])
    const metadata = await capture([process.env.AAPT2 ?? "aapt2", "dump", "badging", file])
    const id = metadata.match(/^package: name='([^']+)'/m)?.[1]
    if (!id) throw new Error(`Cannot read APK application ID: ${file}`)
    return id
  }
  if (!process.env.BUNDLETOOL_JAR)
    throw new Error("Set BUNDLETOOL_JAR to an existing bundletool JAR to verify AAB identity")
  // jarsigner exits zero for unsigned archives; require its affirmative verification result too.
  const signature = await capture(["jarsigner", "-J-Duser.language=en", "-verify", file])
  if (!/jar verified\./.test(signature)) throw new Error(`AAB signature was not verified: ${file}`)
  return (
    await capture([
      "java",
      "-jar",
      process.env.BUNDLETOOL_JAR,
      "dump",
      "manifest",
      `--bundle=${file}`,
      "--xpath=/manifest/@package",
    ])
  ).trim()
}

async function capture(command: string[]) {
  const proc = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(`${command[0]} failed (${code}):\n${stdout}${stderr}`)
  return stdout
}

async function sha256File(file: string) {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(file)) hash.update(chunk)
  return hash.digest("hex")
}

function relative(file: string) {
  return path.relative(root, file).replaceAll("\\", "/")
}
