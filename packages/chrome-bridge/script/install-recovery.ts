import assert from "node:assert/strict"
import { createHash, randomUUID } from "node:crypto"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { connect } from "../src/client"
import { install, restore, status } from "../src/install"

// Isolated manual recovery demonstration. No production profile, process,
// registration, journal deletion or mutation replay is permitted here.
const directory = resolve(process.argv[2] ?? "")
assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
const preparation = JSON.parse(await readFile(join(directory, "preparation.json"), "utf8"))
assert.equal(preparation.runDir, directory)
assert(preparation.ipcDirectory && preparation.ipcDirectory !== directory)
assert(preparation.nativeManifest.startsWith(directory + "/"))
const root = resolve(preparation.ipcDirectory, "..")
const production = await readFile(preparation.productionManifest.path)
let mutations = 0
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  fetch(request) {
    if (new URL(request.url).pathname === "/mutate") {
      mutations++
      return new Response("ok")
    }
    return new Response("<!doctype html><title>Isolated recovery fixture</title><p>Recovery</p>", {
      headers: { "content-type": "text/html" },
    })
  },
})
let browser: ReturnType<typeof Bun.spawn> | undefined
let bridge: Awaited<ReturnType<typeof connect>> | undefined
const turn = { session_id: randomUUID(), turn_id: randomUUID() }
async function wait<T>(read: () => Promise<T | undefined>, timeout = 15000): Promise<T> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await read()
    if (value !== undefined) return value
    await Bun.sleep(100)
  }
  throw new Error("Recovery fixture timed out")
}
async function launch() {
  browser = Bun.spawn([preparation.launcher], { stdout: "ignore", stderr: "ignore" })
  bridge = await wait(() => connect(preparation.ipcDirectory).catch(() => undefined))
}
async function stop() {
  bridge?.close()
  bridge = undefined
  if (!browser) return
  browser.kill("SIGTERM")
  await Promise.race([
    browser.exited,
    Bun.sleep(10000).then(() => {
      throw new Error("Isolated browser did not exit")
    }),
  ])
  browser = undefined
}
try {
  await launch()
  const host = await bridge!.status()
  const tab = await bridge!.call<{ id: number }>("createTab", { ...turn, session_context: "live" })
  await bridge!.call("attach", { ...turn, session_context: "live", tabId: tab.id })
  const cdp = (method: string, commandParams: unknown, timeout = 5000) =>
    bridge!.call(
      "executeCdp",
      { ...turn, session_context: "live", target: { tabId: tab.id }, method, commandParams },
      timeout,
    )
  await cdp("Page.navigate", { url: String(fixture.url) })
  await wait(async () => {
    const result: any = await cdp("Runtime.evaluate", { expression: "document.title", returnByValue: true })
    return result.result?.value === "Isolated recovery fixture" ? true : undefined
  })
  const outcome = cdp(
    "Runtime.evaluate",
    { expression: "fetch('/mutate').then(()=>new Promise(()=>{}))", awaitPromise: true },
    300,
  ).then(
    () => "unexpected_success",
    (error) => error.outcome,
  )
  await wait(async () => (mutations === 1 ? true : undefined))
  assert.equal(await outcome, "unknown")
  // Only the host verified through this isolated discovery is killed. Its
  // write-ahead evidence is retained before the approved isolated restart.
  process.kill(host.pid, "SIGKILL")
  bridge!.close()
  bridge = undefined
  await stop()
  const files = (await readdir(preparation.ipcDirectory)).filter((name: string) => name.startsWith("journal-"))
  const journals = await Promise.all(
    files.map(async (name: string) => ({ name, bytes: await readFile(join(preparation.ipcDirectory, name)) })),
  )
  assert(journals.some((file) => JSON.parse(file.bytes.toString()).sessions.length > 0))
  // Check that no process still references the exact isolated user-data root.
  for (const pid of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
    const args = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")
    assert(!args.split("\0").includes(`--user-data-dir=${preparation.userData}`), "Old browser is still alive")
  }
  // New binding prevents saved grants following a replacement connection.
  const nextRoot = `${root}-fresh`
  await install({
    root: nextRoot,
    manifest: preparation.nativeManifest,
    binary: preparation.hostExecutable,
    id: "recovered-fixture",
    label: "Recovered isolated fixture",
  })
  preparation.ipcDirectory = join(nextRoot, "ipc")
  await launch()
  const fresh = await bridge!.status()
  assert.equal(fresh.recovery, "ready")
  assert.notEqual(fresh.epoch, host.epoch)
  // The restarted browser has no prior debugger attachments; verify from the
  // extension's target list using only a newly created inspection session.
  const observer = { session_id: randomUUID(), turn_id: randomUUID(), session_context: "live" }
  const inspector = await bridge!.call<{ id: number }>("createTab", observer)
  await bridge!.call("attach", { ...observer, tabId: inspector.id })
  const targets: any = await bridge!.call("executeCdp", {
    ...observer,
    target: { tabId: inspector.id },
    method: "Target.getTargets",
    commandParams: {},
  })
  const own: any = await bridge!.call("executeCdp", {
    ...observer,
    target: { tabId: inspector.id },
    method: "Target.getTargetInfo",
    commandParams: {},
  })
  await writeFile(join(directory, "recovery-targets.json"), JSON.stringify({ targets, own }, null, 2), { mode: 0o600 })
  assert(
    targets.targetInfos.every(
      (target: any) => !target.attached || (target.tabId === inspector.id && target.id === own.targetInfo.targetId),
    ),
  )
  await bridge!.endTurn(observer)
  assert.equal(mutations, 1)
  for (const journal of journals) assert.deepEqual(await readFile(join(root, "ipc", journal.name)), journal.bytes)
  await stop()
  await restore(nextRoot)
  await restore(root)
  assert.deepEqual(await readFile(preparation.productionManifest.path), production)
  await writeFile(
    join(directory, "install-recovery-report.json"),
    JSON.stringify(
      {
        passed: true,
        originalOutcome: "unknown",
        mutations,
        oldJournalHashes: journals.map((file) => ({
          name: file.name,
          sha256: createHash("sha256").update(file.bytes).digest("hex"),
        })),
        newBinding: "recovered-fixture",
        restartedBrowserHadNoOldAttachments: true,
        productionUnchanged: true,
        restored: await status(root),
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
} finally {
  await stop()
  fixture.stop(true)
}
