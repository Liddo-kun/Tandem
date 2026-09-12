import { install } from "../src/install"
import { createHash, randomUUID } from "node:crypto"
import { chmod, cp, lstat, mkdir, readFile, realpath, statfs, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { parseArgs } from "node:util"
import { EXTENSION_ID, EXTENSION_ORIGIN, HOST_NAME, privateDirectory } from "../src/client"

// Preparation is deliberately separate from smoke: it never launches a browser.
const { values } = parseArgs({
  args: process.argv.slice(2).filter((arg) => arg !== "--"),
  options: {
    "run-dir": { type: "string" },
    "installation-root": { type: "string" },
    extension: { type: "string" },
    browser: { type: "string", default: "/usr/lib/chromium/chromium" },
    "production-manifest": { type: "string" },
    display: { type: "string", default: ":0" },
    headless: { type: "boolean", default: false },
    "no-sandbox": { type: "boolean", default: false },
    trace: { type: "string" },
    observer: { type: "boolean", default: false },
    "device-scale-factor": { type: "string" },
    zoom: { type: "string" },
    "screenshot-new-surface": { type: "boolean", default: false },
    "fault-control": { type: "boolean", default: false },
  },
})
if (!values["run-dir"] || !values.extension || !values["production-manifest"]) {
  throw new Error(
    "Usage: prepare.ts --run-dir /tmp/tandem/chrome-bridge/<fresh-run> --extension <installed-extension-assets> --production-manifest <existing-manifest> [--no-sandbox] [--headless] [--trace <strace>]",
  )
}
process.umask(0o077)
const root = "/tmp/tandem/chrome-bridge"
await mkdir(root, { recursive: true, mode: 0o700 })
await privateDirectory(root)
const space = await statfs(root)
if (space.bavail * space.bsize < 256 * 1024 * 1024)
  throw new Error("Isolated preparation requires 256 MiB free; archive or prune only stopped test artifacts first")
const runDir = resolve(values["run-dir"])
if (!runDir.startsWith(`${root}/`) || runDir.slice(root.length + 1).includes("/"))
  throw new Error("Use a fresh direct child of /tmp/tandem/chrome-bridge")
// Fail if the directory exists; never repair or overwrite a prior run implicitly.
await mkdir(runDir, { mode: 0o700 })
const source = await realpath(values.extension)
const manifestBytes = await readFile(join(source, "manifest.json"))
const manifest = JSON.parse(manifestBytes.toString())
if (!manifest.key || manifest.background?.service_worker !== "background.js")
  throw new Error("Not the expected extension manifest")
const extensionID = createHash("sha256")
  .update(Buffer.from(manifest.key, "base64"))
  .digest("hex")
  .slice(0, 32)
  .replace(/[0-9a-f]/g, (value) => String.fromCharCode(97 + Number.parseInt(value, 16)))
if (extensionID !== EXTENSION_ID) throw new Error("Extension public key has an unexpected ID")
const productionManifestPath = await realpath(values["production-manifest"])
const expectedProduction = await realpath(
  join(
    process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
    "chromium",
    "NativeMessagingHosts",
    `${HOST_NAME}.json`,
  ),
)
if (productionManifestPath !== expectedProduction)
  throw new Error("Production manifest must be the current user's Chromium registration, not a test copy")
const productionBytes = await readFile(productionManifestPath)
const production = JSON.parse(productionBytes.toString())
if (production.name !== HOST_NAME) throw new Error("Unexpected production manifest name")
const home = join(runDir, "home")
const config = join(home, ".config")
const userData = join(config, "chromium")
const nativeDirectory = join(userData, "NativeMessagingHosts")
const extensionPath = join(runDir, "extension")
const observerPath = values.observer ? join(runDir, "observer") : undefined
const observerToken = values.observer ? randomUUID() : undefined
let observerPort: number | undefined
const hostExecutable = join(runDir, "host")
const hostLauncher = join(runDir, "native-host")
const launcher = join(runDir, "launch-browser")
for (const path of [
  nativeDirectory,
  join(runDir, "bin"),
  join(runDir, "cache"),
  join(runDir, "runtime"),
  join(runDir, "tmp"),
]) {
  await mkdir(path, { recursive: true, mode: 0o700 })
}
await cp(source, extensionPath, {
  recursive: true,
  filter: async (path) => {
    if ((await lstat(path)).isSymbolicLink()) throw new Error("Extension assets must not contain symlinks")
    // Chrome Web Store verification metadata is not loadable unpacked code.
    return path !== join(source, "_metadata")
  },
})
if (observerPath) {
  await cp(fileURLToPath(new URL("../test/fixtures/observer", import.meta.url)), observerPath, { recursive: true })
  const reservation = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch: () => new Response("Not ready", { status: 503 }),
  })
  observerPort = reservation.port
  reservation.stop(true)
  await writeFile(
    join(observerPath, "config.js"),
    `globalThis.TANDEM_OBSERVER = ${JSON.stringify({ endpoint: `http://127.0.0.1:${observerPort}/observer?token=${observerToken}` })}\n`,
    { flag: "wx", mode: 0o600 },
  )
}
let faultControl: { path: string; port: number; token: string; hashes: Record<string, string> } | undefined
if (values["fault-control"]) {
  const path = join(runDir, "fault-control")
  await cp(fileURLToPath(new URL("../test/fixtures/fault-control", import.meta.url)), path, { recursive: true })
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("wait") })
  const port = reservation.port!
  reservation.stop(true)
  const token = crypto.randomUUID()
  await writeFile(
    join(path, "config.js"),
    `globalThis.TANDEM_FAULT = ${JSON.stringify({ endpoint: `http://127.0.0.1:${port}/fault?token=${token}` })}\n`,
    { flag: "wx", mode: 0o600 },
  )
  const hashes: Record<string, string> = {}
  for (const name of ["manifest.json", "background.js", "config.js"])
    hashes[name] = sha256(await readFile(join(path, name)))
  faultControl = { path, port, token, hashes }
}
const zoom = Number(values.zoom ?? "1")
const deviceScale = values["device-scale-factor"] ? Number(values["device-scale-factor"]) : undefined
if (!Number.isFinite(zoom) || zoom < 0.5 || zoom > 2 || (deviceScale !== undefined && ![1, 2].includes(deviceScale)))
  throw new Error("Fixture zoom must be 0.5..2 and device scale must be 1 or 2")
await mkdir(join(userData, "Default"), { mode: 0o700 })
await writeFile(
  join(userData, "Default", "Preferences"),
  JSON.stringify({ partition: { default_zoom_level: { x: Math.log(zoom) / Math.log(1.2) } } }),
  { mode: 0o600, flag: "wx" },
)
const hostSource = fileURLToPath(new URL("../src/host.ts", import.meta.url))
const build = Bun.spawn([process.execPath, "build", hostSource, "--compile", "--outfile", hostExecutable], {
  cwd: runDir,
  env: { HOME: home, PATH: join(runDir, "bin"), TMPDIR: join(runDir, "tmp") },
  stdout: "pipe",
  stderr: "pipe",
})
const [buildOutput, buildError, buildExit] = await Promise.all([
  new Response(build.stdout).text(),
  new Response(build.stderr).text(),
  build.exited,
])
if (buildExit !== 0) throw new Error(`Host compilation failed: ${buildOutput}${buildError}`)
await chmod(hostExecutable, 0o700)
const environment = {
  HOME: home,
  XDG_CONFIG_HOME: config,
  XDG_CACHE_HOME: join(runDir, "cache"),
  XDG_RUNTIME_DIR: join(runDir, "runtime"),
  TMPDIR: join(runDir, "tmp"),
  PATH: join(runDir, "bin"),
  LANG: "C.UTF-8",
  TANDEM_CHROME_BRIDGE_RUN_DIR: runDir,
}
const envArgs = Object.entries(environment).map(([key, value]) => `${key}=${value}`)
await writeFile(
  hostLauncher,
  `#!/bin/sh\nexec /usr/bin/env -i ${envArgs.map(quote).join(" ")} ${quote(hostExecutable)} "$@"\n`,
  { mode: 0o700, flag: "wx" },
)
const nativeManifest = join(nativeDirectory, `${HOST_NAME}.json`)
await writeFile(
  nativeManifest,
  JSON.stringify(
    {
      name: HOST_NAME,
      description: "Tandem isolated phase 1 bridge",
      path: hostLauncher,
      type: "stdio",
      allowed_origins: [EXTENSION_ORIGIN],
    },
    null,
    2,
  ),
  { mode: 0o600, flag: "wx" },
)
const browser = await realpath(values.browser!)
const version = Bun.spawn(["/usr/bin/timeout", "10", browser, "--version"], { stdout: "pipe", stderr: "pipe" })
const [browserVersion, versionError, versionExit] = await Promise.all([
  new Response(version.stdout).text(),
  new Response(version.stderr).text(),
  version.exited,
])
if (versionExit !== 0) throw new Error(`Browser version failed: ${versionError}`)
const browserArgs = [
  browser,
  `--user-data-dir=${userData}`,
  `--load-extension=${[extensionPath, observerPath, faultControl?.path].filter(Boolean).join(",")}`,
  `--disable-extensions-except=${[extensionPath, observerPath, faultControl?.path].filter(Boolean).join(",")}`,
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-sync",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  ...(values["screenshot-new-surface"] ? ["--enable-features=CDPScreenshotNewSurface"] : []),
  "--password-store=basic",
  "--window-size=1000,800",
  "--class=Tandem-Bridge-Test",
  ...(deviceScale === undefined ? [] : [`--force-device-scale-factor=${deviceScale}`]),
  ...(values.headless ? ["--headless=new"] : []),
  ...(values["no-sandbox"] ? ["--no-sandbox"] : []),
  "about:blank",
]
const trace = values.trace ? await realpath(values.trace) : undefined
const command = trace
  ? [trace, "-f", "-s", "4096", "-e", "trace=%file,%process", "-o", join(runDir, "process-trace.log"), ...browserArgs]
  : browserArgs
await writeFile(
  launcher,
  `#!/bin/sh\nexec /usr/bin/env -i ${[...envArgs, `DISPLAY=${values.display}`].map(quote).join(" ")} ${command.map(quote).join(" ")} "$@"\n`,
  { mode: 0o700, flag: "wx" },
)
const installed = values["installation-root"]
  ? await install({
      root: resolve(values["installation-root"]),
      manifest: nativeManifest,
      binary: hostExecutable,
      id: "isolated-phase4",
      label: "Isolated Phase 4",
    })
  : undefined
const preparation = {
  passed: true,
  runDir,
  productionManifest: { path: productionManifestPath, sha256: sha256(productionBytes), hostTarget: production.path },
  extension: {
    id: EXTENSION_ID,
    version: manifest.version,
    backgroundSha256: sha256(await readFile(join(extensionPath, "background.js"))),
    manifestSha256: sha256(manifestBytes),
    path: extensionPath,
    source,
    installation: "unmodified installed assets loaded unpacked; store _metadata excluded",
  },
  browser: {
    executable: browser,
    version: browserVersion.trim(),
    args: browserArgs.slice(1),
    headless: values.headless,
    sandboxDisabled: values["no-sandbox"],
  },
  home,
  config,
  userData,
  hostExecutable: installed?.executable ?? hostExecutable,
  ipcDirectory: installed ? join(resolve(values["installation-root"]!), "ipc") : runDir,
  hostLauncher,
  launcher,
  nativeManifest,
  hostSha256: sha256(await readFile(hostExecutable)),
  faultControl,
  observer: observerPath
    ? {
        path: observerPath,
        port: observerPort,
        token: observerToken,
        purpose: "test-only read-only physical tab selection observer",
        hashes: Object.fromEntries(
          await Promise.all(
            ["manifest.json", "background.js", "config.js"].map(async (name) => [
              name,
              sha256(await readFile(join(observerPath, name))),
            ]),
          ),
        ),
      }
    : null,
  zoom,
  deviceScale,
  trace: trace ? join(runDir, "process-trace.log") : null,
  offline: "unverified; disabling background networking does not block all external traffic",
  createdAt: new Date().toISOString(),
}
await writeFile(join(runDir, "preparation.json"), JSON.stringify(preparation, null, 2), { mode: 0o600, flag: "wx" })
if (sha256(await readFile(productionManifestPath)) !== preparation.productionManifest.sha256)
  throw new Error("Production manifest changed during preparation; stop and investigate")
console.log(
  JSON.stringify(
    {
      runDir,
      launch: `timeout --kill-after=5s 240s ${quote(launcher)}`,
      smoke: `bun run --cwd packages/chrome-bridge smoke -- --run-dir ${quote(runDir)}`,
    },
    null,
    2,
  ),
)

function quote(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`
}
function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}
