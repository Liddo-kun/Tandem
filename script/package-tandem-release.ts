#!/usr/bin/env bun

import { createHash } from "crypto"
import fs from "fs/promises"
import path from "path"
import { fileURLToPath } from "url"

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)))
process.chdir(root)

const args = process.argv.slice(2)
const outDir = path.resolve(root, value("--out") ?? "dist/tandem-release")
const clean = !has("--no-clean")
const strict = has("--strict")
const requiredCommon = has("--required-common")
const includeDebugAndroid = has("--include-debug-android")
const uploadTag = value("--upload")
const uploadRepo = value("--repo") ?? process.env["GH_REPO"]
const installWindows = has("--install-windows")
const explicitIosIpas = values("--ios-ipa").map((item) => path.resolve(root, item))

type ArtifactKind = "cli" | "android" | "ios"
type Artifact = {
  kind: ArtifactKind
  source: string
  output: string
  bytes: number
  sha256: string
}

const artifacts: Artifact[] = []
const missing: string[] = []
const usedNames = new Set<string>()

if (has("--help") || has("-h")) {
  console.log(`Usage: bun run tandem:package [options]

Stages Tandem-named release assets from existing build outputs.

Options:
  --out <dir>           Output directory. Default: dist/tandem-release
  --no-clean            Do not clear the output directory first
  --strict              Fail if CLI, Android, or iOS artifacts are missing
  --required-common     Require macOS arm64/x64, Windows x64/arm64, Linux x64/arm64, Android, and iOS
  --include-debug-android
                        Include debug Android APKs. Release packaging excludes them by default
  --ios-ipa <path>      Include an exported iOS .ipa outside packages/ios; can repeat
  --install-windows     Copy tandem-windows-x64.exe to C:\\Program_Files\\tandem.exe
  --upload <tag>        Upload staged files to an existing GitHub release tag
  --repo <owner/name>   GitHub repo for --upload. Defaults to GH_REPO
`)
  process.exit(0)
}

if (clean) await fs.rm(outDir, { recursive: true, force: true })
await fs.mkdir(outDir, { recursive: true })

await stageCliArtifacts()
await stageAndroidArtifacts()
await stageIosArtifacts()

if (artifacts.length === 0) {
  throw new Error(`No Tandem release artifacts were found. Build at least one target first.\n${missing.join("\n")}`)
}

if (strict) {
  const kinds = new Set(artifacts.map((artifact) => artifact.kind))
  for (const kind of ["cli", "android", "ios"] as const) {
    if (!kinds.has(kind)) throw new Error(`Missing ${kind} artifact.\n${missing.join("\n")}`)
  }
}

if (requiredCommon) assertRequiredCommonArtifacts()

const manifestPath = path.join(outDir, "manifest.json")
await Bun.write(
  manifestPath,
  JSON.stringify(
    {
      brand: "Tandem",
      generatedAt: new Date().toISOString(),
      artifacts,
      missing,
    },
    null,
    2,
  ),
)

const checksumEntries = [
  ...artifacts.map((artifact) => ({ name: path.basename(artifact.output), sha256: artifact.sha256 })),
  { name: path.basename(manifestPath), sha256: await sha256File(manifestPath) },
].sort((a, b) => a.name.localeCompare(b.name))
await Bun.write(path.join(outDir, "SHA256SUMS"), checksumEntries.map((entry) => `${entry.sha256}  ${entry.name}`).join("\n") + "\n")

if (installWindows) await installWindowsBinary()
if (uploadTag) await uploadReleaseFiles(uploadTag, uploadRepo)

console.log(`\nStaged ${artifacts.length} Tandem release artifact${artifacts.length === 1 ? "" : "s"} in ${outDir}`)
for (const artifact of artifacts) console.log(`- ${artifact.kind}: ${path.basename(artifact.output)}`)
if (missing.length > 0) {
  console.log("\nMissing targets:")
  for (const item of missing) console.log(`- ${item}`)
}

async function stageCliArtifacts() {
  const dist = path.join(root, "packages/opencode/dist")
  if (!(await isDirectory(dist))) {
    missing.push("CLI: build first with `bun run --cwd packages/opencode build` or `bun run --cwd packages/opencode build --single`.")
    return
  }

  let found = 0
  for (const entry of await fs.readdir(dist, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith("opencode-")) continue
    const source = await firstExisting([
      path.join(dist, entry.name, "bin", "opencode.exe"),
      path.join(dist, entry.name, "bin", "opencode"),
    ])
    if (!source) continue

    const extension = entry.name.includes("windows") ? ".exe" : ""
    await stageFile("cli", source, `${entry.name.replace(/^opencode-/, "tandem-")}${extension}`)
    found++
  }

  if (found === 0) {
    missing.push("CLI: no packages/opencode/dist/opencode-*/bin/opencode build output was found.")
  }
}

async function stageAndroidArtifacts() {
  const outputs = path.join(root, "packages/android/src-tauri/gen/android/app/build/outputs")
  if (!(await isDirectory(outputs))) {
    missing.push("Android: build first with the filtered Android APK command from context.md.")
    return
  }

  const files = (await globFiles(outputs, ["**/*.apk", "**/*.aab"])).filter((file) => includeDebugAndroid || !isDebugAndroidArtifact(file))
  if (files.length === 0) {
    missing.push(
      includeDebugAndroid
        ? "Android: no APK or AAB files were found under packages/android/src-tauri/gen/android/app/build/outputs."
        : "Android: no release APK or AAB files were found under packages/android/src-tauri/gen/android/app/build/outputs. Use --include-debug-android only for local debug packaging.",
    )
    return
  }

  for (const file of files) await stageFile("android", file, mobileName("tandem-android", file))
}

async function stageIosArtifacts() {
  const candidates = new Set<string>()

  for (const file of explicitIosIpas) {
    if (await exists(file)) candidates.add(file)
    else missing.push(`iOS: explicit IPA was not found: ${relative(file)}`)
  }

  const iosDir = path.join(root, "packages/ios")
  for (const file of await globFiles(iosDir, ["*.ipa"])) candidates.add(file)
  for (const dir of ["build", "dist", "export", "exports"].map((item) => path.join(iosDir, item))) {
    for (const file of await globFiles(dir, ["**/*.ipa"])) candidates.add(file)
  }

  if (candidates.size === 0) {
    missing.push("iOS: export a signed .ipa into packages/ios/build, packages/ios/dist, packages/ios/export, or pass --ios-ipa <path>.")
    return
  }

  for (const file of [...candidates].sort()) await stageFile("ios", file, mobileName("tandem-ios", file))
}

async function stageFile(kind: ArtifactKind, source: string, requestedName: string) {
  const output = path.join(outDir, uniqueName(requestedName))
  await fs.copyFile(source, output)
  const stat = await fs.stat(output)
  artifacts.push({
    kind,
    source: relative(source),
    output: relative(output),
    bytes: stat.size,
    sha256: await sha256File(output),
  })
}

async function installWindowsBinary() {
  if (process.platform !== "win32") throw new Error("--install-windows can only run on Windows.")
  const source = path.join(outDir, "tandem-windows-x64.exe")
  if (!(await exists(source))) throw new Error("--install-windows requires tandem-windows-x64.exe. Build the Windows x64 CLI first.")
  const target = "C:\\Program_Files\\tandem.exe"
  if (!(await isDirectory(path.dirname(target)))) throw new Error(`Install parent does not exist: ${path.dirname(target)}`)
  await fs.copyFile(source, target)
  console.log(`Installed ${target}`)
}

async function uploadReleaseFiles(tag: string, repo: string | undefined) {
  if (!repo) throw new Error("--upload requires --repo <owner/name> or GH_REPO.")
  const releaseFiles: string[] = []
  for (const file of (await fs.readdir(outDir)).map((item) => path.join(outDir, item))) {
    if ((await fs.stat(file)).isFile()) releaseFiles.push(file)
  }
  const command = ["gh", "release", "upload", tag, ...releaseFiles, "--clobber", "--repo", repo]
  const proc = Bun.spawn(command, { stdin: "inherit", stdout: "inherit", stderr: "inherit" })
  const code = await proc.exited
  if (code !== 0) throw new Error(`gh release upload failed with exit code ${code}.`)
}

function mobileName(prefix: string, file: string) {
  const parsed = path.parse(file)
  let stem = parsed.name.replace(/^app[-_]?/i, "").replace(/^opencode[-_]?/i, "").replace(/^tandem[-_]?/i, "")
  stem = sanitize(stem)
  return stem ? `${prefix}-${stem}${parsed.ext.toLowerCase()}` : `${prefix}${parsed.ext.toLowerCase()}`
}

function isDebugAndroidArtifact(file: string) {
  return file.replaceAll("\\", "/").toLowerCase().includes("/debug/") || path.basename(file).toLowerCase().includes("debug")
}

function assertRequiredCommonArtifacts() {
  const names = new Set(artifacts.map((artifact) => path.basename(artifact.output)))
  const requiredCli = [
    "tandem-darwin-arm64",
    "tandem-darwin-x64",
    "tandem-linux-arm64",
    "tandem-linux-x64",
    "tandem-windows-arm64.exe",
    "tandem-windows-x64.exe",
  ]
  const missingRequired = requiredCli.filter((name) => !names.has(name))
  if (!artifacts.some((artifact) => artifact.kind === "android" && /\.(apk|aab)$/.test(artifact.output))) {
    missingRequired.push("Android APK or AAB")
  }
  if (!artifacts.some((artifact) => artifact.kind === "ios" && artifact.output.endsWith(".ipa"))) {
    missingRequired.push("iOS IPA")
  }
  if (missingRequired.length > 0) {
    throw new Error(`Missing common Tandem release artifact(s): ${missingRequired.join(", ")}.\n${missing.join("\n")}`)
  }
}

function uniqueName(name: string) {
  const parsed = path.parse(name)
  let candidate = name
  let suffix = 2
  while (usedNames.has(candidate)) {
    candidate = `${parsed.name}-${suffix}${parsed.ext}`
    suffix++
  }
  usedNames.add(candidate)
  return candidate
}

function sanitize(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
}

async function globFiles(cwd: string, patterns: string[]) {
  if (!(await isDirectory(cwd))) return []
  const files = new Set<string>()
  for (const pattern of patterns) {
    const glob = new Bun.Glob(pattern)
    for await (const item of glob.scan({ cwd })) {
      const file = path.join(cwd, item)
      if ((await fs.stat(file)).isFile()) files.add(file)
    }
  }
  return [...files].sort()
}

async function firstExisting(files: string[]) {
  for (const file of files) if (await exists(file)) return file
  return undefined
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

async function sha256File(file: string) {
  return createHash("sha256").update(await fs.readFile(file)).digest("hex")
}

function has(name: string) {
  return args.includes(name)
}

function value(name: string) {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function values(name: string) {
  return args.flatMap((arg, index) => (arg === name && args[index + 1] ? [args[index + 1]] : []))
}

function relative(file: string) {
  return path.relative(root, file).replaceAll("\\", "/")
}
