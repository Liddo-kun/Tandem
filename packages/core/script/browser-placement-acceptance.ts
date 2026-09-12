import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { access, chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

process.umask(0o077)
const root = fileURLToPath(new URL("../../..", import.meta.url))
const directory = `/tmp/tandem/chrome-bridge/vp-${Date.now()}`
const evidence = `${directory}-e`
await mkdir("/tmp/tandem/chrome-bridge", { recursive: true, mode: 0o700 })
await chmod("/tmp/tandem/chrome-bridge", 0o700)
await mkdir(evidence, { mode: 0o700 })
assert(
  !(await access("/tmp/.X11-unix/X94").then(
    () => true,
    () => false,
  )),
  "Display :94 is occupied",
)
const files = [
  "packages/core/script/browser-placement-acceptance.ts",
  "packages/core/test/lib/browser-placement-fixture.ts",
  "packages/core/test/session-browser-placement-live.test.ts",
  "packages/core/src/session/execution/local.ts",
  "packages/core/src/location-service-map.ts",
  "packages/core/src/location-services.ts",
  "packages/core/src/session/runner/llm.ts",
  "packages/core/src/session/runner/model.ts",
  "packages/core/src/session.ts",
  "packages/core/src/tool/registry.ts",
  "packages/core/src/tool/builtins.ts",
  "packages/core/src/tool/browser.ts",
  "packages/core/src/browser.ts",
  "packages/chrome-bridge/src/tools.ts",
  "packages/chrome-bridge/src/controller.ts",
]
const hashes = async () =>
  Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(`${root}/${file}`))
          .digest("hex"),
      ]),
    ),
  )
files.push("packages/core/src/plugin/internal.ts", "packages/core/test/location-layer.test.ts")
const before = await hashes()
const commands: unknown[] = []
async function command(args: string[]) {
  const child = Bun.spawn(["timeout", "--kill-after=5s", "90s", ...args], {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  })
  const code = await child.exited
  commands.push({ args, pid: child.pid, code })
  assert.equal(code, 0)
}
const xvfb = Bun.spawn(
  [
    "timeout",
    "--kill-after=5s",
    "600s",
    process.env.TANDEM_XVFB ?? "/tmp/tandem/chrome-bridge/tools/usr/bin/Xvfb",
    ":94",
    "-screen",
    "0",
    "1280x900x24",
    "-nolisten",
    "tcp",
  ],
  { stdout: Bun.file(`${evidence}/xvfb.log`), stderr: Bun.file(`${evidence}/xvfb-error.log`) },
)
let browser: ReturnType<typeof Bun.spawn> | undefined
let passed = false
let failure: string | undefined
let preparation: { launcher: string; home: string; productionManifest: { path: string; sha256: string } } | undefined
try {
  await command([
    process.execPath,
    "run",
    "--cwd",
    "packages/chrome-bridge",
    "prepare:isolated",
    "--",
    "--display",
    ":94",
    "--run-dir",
    directory,
    "--extension",
    "/home/jon/.config/chromium/Profile 5/Extensions/hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0",
    "--production-manifest",
    "/home/jon/.config/chromium/NativeMessagingHosts/com.openai.codexextension.json",
    "--screenshot-new-surface",
    "--no-sandbox",
  ])
  await command([process.execPath, "packages/chrome-bridge/script/session-native-tap.ts", "--prepare", directory])
  preparation = JSON.parse(await readFile(`${directory}/preparation.json`, "utf8"))
  assert(preparation)
  browser = Bun.spawn(["timeout", "--kill-after=5s", "420s", preparation.launcher], {
    stdout: Bun.file(`${evidence}/browser.log`),
    stderr: Bun.file(`${evidence}/browser-error.log`),
  })
  const deadline = Date.now() + 20000
  while (!(await readdir(directory)).some((name) => /^host-.*\.json$/.test(name))) {
    assert(browser.exitCode === null && Date.now() < deadline, "Isolated native host did not start")
    await Bun.sleep(50)
  }
  const args = [
    "timeout",
    "--kill-after=5s",
    "300s",
    process.execPath,
    "test",
    "test/session-browser-placement-live.test.ts",
    "--timeout",
    "240000",
  ]
  const test = Bun.spawn(args, {
    cwd: `${root}/packages/core`,
    env: {
      PATH: process.env.PATH,
      HOME: preparation.home,
      TMPDIR: `${directory}/tmp`,
      LANG: "C.UTF-8",
      TANDEM_PLACEMENT_RUN_DIR: directory,
      TANDEM_CHROME_CONNECTIONS: JSON.stringify([
        { id: "fixture", label: "Isolated V2 placement", directory, screenshotVerified: true },
      ]),
    },
    stdout: Bun.file(`${evidence}/test.log`),
    stderr: Bun.file(`${evidence}/test-error.log`),
  })
  const code = await test.exited
  commands.push({ args, cwd: "packages/core", pid: test.pid, code })
  assert.equal(code, 0, `See ${evidence}/test-error.log`)
  passed = true
} catch (error) {
  failure = String(error)
} finally {
  browser?.kill("SIGTERM")
  if (browser) await browser.exited
  xvfb.kill("SIGTERM")
  await xvfb.exited
  const native = await readFile(`${directory}/native-processes.json`, "utf8").then(
    (value) => JSON.parse(value),
    () => undefined,
  )
  const exited = async (pid: number) => {
    const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "")
    return !stat || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")
  }
  if (native)
    for (const pid of [native.tapPid, native.hostPid]) {
      const deadline = Date.now() + 5000
      while (!(await exited(pid))) {
        assert(Date.now() < deadline, `Owned native pid ${pid} leaked`)
        await Bun.sleep(25)
      }
    }
  const after = await hashes()
  const sourceUnchanged = JSON.stringify(before) === JSON.stringify(after)
  const manifestUnchanged = preparation
    ? createHash("sha256")
        .update(await readFile(preparation.productionManifest.path))
        .digest("hex") === preparation.productionManifest.sha256
    : undefined
  const report = passed ? JSON.parse(await readFile(`${directory}/placement/report.json`, "utf8")) : undefined
  await writeFile(
    `${evidence}/acceptance.json`,
    JSON.stringify(
      {
        passed: passed && manifestUnchanged && sourceUnchanged,
        failure,
        directory,
        evidence,
        commands,
        before,
        after,
        sourceUnchanged,
        manifestUnchanged,
        browser: { pid: browser?.pid, exited: true },
        native: { ...native, exited: !!native },
        xvfb: { pid: xvfb.pid, exited: true },
        report,
      },
      null,
      2,
    ),
  )
  console.log(`PLACEMENT EVIDENCE: ${evidence}/acceptance.json`)
  assert(
    passed && manifestUnchanged && sourceUnchanged,
    failure ?? "Source or production manifest changed during acceptance",
  )
}
