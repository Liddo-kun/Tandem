#!/usr/bin/env bun

import { chmod, copyFile, mkdir, rename, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"

// UPSTREAM-DIVERGENCE: development must never elect or replace the daily server.
const root = path.resolve(import.meta.dirname, "..")
const development = path.join(os.homedir(), ".local/share/tandem-v2/development")
const toolchain = path.join(os.homedir(), ".local/share/tandem-v2/toolchain/bun-1.4.2/bin")
const executable = path.join(development, "bin/tandem")
const passwordFile = path.join(development, "server-password")
const environmentFile = path.join(development, "environment.json")
const url = "http://127.0.0.1:4098"
const [command, ...args] = process.argv.slice(2)

if (!command || command === "--help") {
  console.log(`Usage: bun script/tandem-v2.ts <build|serve|cli|source|vite|paths> [arguments]

build   Build and stage the ARM64 development CLI with its embedded UI
serve   Run the isolated, registered server on 0.0.0.0:4098
cli     Run the staged CLI inside the isolated environment
source  Run the source TUI against the explicit development server
vite    Run the source Vite TUI against the explicit development server
paths   Print development paths (never the password)

The stable development password is stored in ${passwordFile}.`)
  process.exit(0)
}
if (!["build", "serve", "cli", "source", "vite", "paths"].includes(command)) {
  throw new Error(`Unknown development command: ${command}`)
}
if (process.versions.bun !== "1.4.2") {
  throw new Error(`Use Bun 1.4.2: ${path.join(toolchain, "bun")} script/tandem-v2.ts ${command}`)
}

const homes = Object.fromEntries(
  ["config", "data", "cache", "state"].map((name) => [name, path.join(development, name)]),
)
await Promise.all(
  [development, path.dirname(executable), "/tmp/tandem/v2", ...Object.values(homes).map((dir) => path.join(dir, "tandem"))].map(
    (directory) => mkdir(directory, { recursive: true, mode: 0o700 }),
  ),
)
if (!(await Bun.file(passwordFile).exists())) {
  await writeFile(passwordFile, crypto.randomUUID() + crypto.randomUUID(), { flag: "wx", mode: 0o600 })
}
const password = (await Bun.file(passwordFile).text()).trim()
if (!password) throw new Error(`Empty development password file: ${passwordFile}`)
if (!(await Bun.file(environmentFile).exists())) {
  // The daily launcher supplies legacy model/variant overrides to this harness.
  // Development settings are explicit and never rewrite the daily environment.
  await writeFile(environmentFile, JSON.stringify({
    TANDEM_PROMPT_CORRECTOR_MODEL: "",
    TANDEM_PROMPT_CORRECTOR_VARIANT: "",
  }, null, 2) + "\n", { flag: "wx", mode: 0o600 })
}
const settings: unknown = await Bun.file(environmentFile).json()
if (!settings || typeof settings !== "object" || Array.isArray(settings) ||
    Object.entries(settings).some(([key, value]) => !key.startsWith("TANDEM_") || typeof value !== "string")) {
  throw new Error(`Expected a JSON object of TANDEM_* string settings: ${environmentFile}`)
}
const serviceConfig = path.join(homes.config, "tandem/service.json")
if (!(await Bun.file(serviceConfig).exists())) {
  await writeFile(serviceConfig, JSON.stringify({ hostname: "0.0.0.0", port: 4098, password }) + "\n", {
    flag: "wx",
    mode: 0o600,
  })
}

const env = {
  ...process.env,
  ...settings,
  // Do not inherit the daily Claude plugin's subprocess shims into every v2 model.
  PATH: [path.dirname(executable), toolchain, ...(process.env.PATH ?? "").split(path.delimiter)
    .filter((directory) => directory !== path.join(os.homedir(), ".cache/tandem/bin/shims"))]
    .filter(Boolean).join(path.delimiter),
  XDG_CONFIG_HOME: homes.config,
  XDG_DATA_HOME: homes.data,
  XDG_CACHE_HOME: homes.cache,
  XDG_STATE_HOME: homes.state,
  TMPDIR: "/tmp/tandem/v2",
  OPENCODE_CONFIG_DIR: path.join(homes.config, "tandem"),
  OPENCODE_CONFIG: undefined,
  OPENCODE_CONFIG_CONTENT: undefined,
  OPENCODE_DB: path.join(homes.data, "tandem/opencode.db"),
  OPENCODE_PASSWORD: password,
  OPENCODE_SERVER_PASSWORD: password,
  OPENCODE_DISABLE_AUTOUPDATE: "1",
  OPENCODE_TUI_CHANNEL: "dev",
  OPENCODE_CHANNEL: "dev",
  OPENCODE_VERSION: "2.0.22-tandem-v2.0",
  HUSKY: "0",
}

if (command === "paths") {
  console.log(JSON.stringify({ root, development, toolchain, executable, passwordFile, environmentFile, homes, url }, null, 2))
  process.exit(0)
}

if (command === "build") {
  const code = await run([path.join(toolchain, "bun"), "run", "--cwd", "packages/cli", "build", "--single", ...args])
  if (code !== 0) process.exit(code)
  const artifact = path.join(root, "packages/cli/dist/cli-linux-arm64/bin/opencode")
  await copyFile(artifact, executable + ".new")
  await chmod(executable + ".new", 0o755)
  await rename(executable + ".new", executable)
  console.log(`Staged development CLI: ${executable}`)
  process.exit(0)
}

if (command === "source" || command === "vite") {
  process.exit(
    await run([
      path.join(toolchain, "bun"),
      "run",
      "--cwd",
      "packages/cli",
      ...(command === "vite" ? ["--conditions=browser", "dev/vite.ts"] : ["src/index.ts"]),
      ...args,
      "--server",
      url,
    ]),
  )
}
if (!(await Bun.file(executable).exists())) throw new Error("Build the development CLI first: tandem:v2 build")
process.exit(
  await run(
    command === "serve"
      ? [executable, "serve", "--service", "--hostname", "0.0.0.0", "--port", "4098", ...args]
      : [executable, ...args],
  ),
)

function run(cmd: string[]) {
  return Bun.spawn(cmd, { cwd: root, env, stdin: "inherit", stdout: "inherit", stderr: "inherit" }).exited
}
