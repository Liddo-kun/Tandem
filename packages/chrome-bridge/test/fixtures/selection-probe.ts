import { spawn } from "node:child_process"
import { openSync, closeSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { BrowserController, BrowserError } from "../../src/controller"
import { connect } from "../../src/client"

const directories = process.argv.slice(2).map((x) => resolve(x))
if (directories.length !== 2 || directories[0] === directories[1])
  throw new Error("Requires two distinct fresh traced preparations")
const preparations = await Promise.all(
  directories.map(async (d) => JSON.parse(await readFile(join(d, "preparation.json"), "utf8"))),
)
const report: any = { startedAt: new Date().toISOString(), assertions: [], discoveries: [], wrappers: [] }
let controller: BrowserController | undefined
try {
  for (const p of preparations) {
    if (!directories.includes(p.runDir) || !p.trace) throw new Error("Not an explicit traced preparation")
    const fd = openSync(join(p.runDir, "selection-browser.log"), "a", 0o600)
    const child = spawn("/usr/bin/timeout", ["--kill-after=5s", "180s", p.launcher], {
      detached: true,
      stdio: ["ignore", fd, fd],
    })
    child.unref()
    closeSync(fd)
    report.wrappers.push(child.pid)
    const deadline = Date.now() + 20000
    for (;;) {
      try {
        const raw = await connect(p.runDir)
        report.discoveries.push({ ...raw.discovery, info: await raw.call("getInfo") })
        raw.close()
        break
      } catch (error) {
        if (Date.now() > deadline) throw error
        await Bun.sleep(150)
      }
    }
  }
  await Bun.sleep(300)
  controller = await BrowserController.create({
    connections: directories.map((directory, index) => ({
      id: `browser-${index}`,
      label: `Isolated ${index}`,
      directory,
    })),
    authorize: (request) =>
      /^browser-[01]$/.test(request.browserId) && request.capability === "create" ? "allow" : "deny",
  })
  const status = await controller.status()
  if (status[0]!.transport.parentPid === status[1]!.transport.parentPid)
    throw new Error("Browser bindings resolved to same process")
  report.assertions.push({
    name: "two configured bindings resolve to independent exact browser processes",
    passed: true,
  })
  const sessions = await Promise.all(
    directories.map((_, index) =>
      controller!.openSession({ browserId: `browser-${index}`, callerSessionId: "same-caller-id-different-browser" }),
    ),
  )
  const turns = await Promise.all(sessions.map((s) => s.beginTurn({ callerTurnId: "same-turn-id" })))
  const tabs = await Promise.all(turns.map((t) => t.createTab()))
  report.assertions.push({
    name: "same caller identities create independent agent tabs on both browsers",
    passed: true,
  })
  try {
    await turns[1]!.inspect(tabs[0]!)
    throw new Error("Foreign browser handle accepted")
  } catch (error) {
    if (!(error instanceof BrowserError) || error.code !== "stale_handle") throw error
  }
  report.assertions.push({ name: "foreign browser handle rejected before inspection", passed: true })
  report.cleanup = await Promise.all(turns.map((t) => t.end({ keep: [] })))
  if (!report.cleanup.every((x: any) => x.confirmed)) throw new Error("Independent tab cleanup not confirmed")
  report.assertions.push({ name: "both browsers independently verify disposable tab cleanup", passed: true })
  await Promise.all(sessions.map((s) => s.close()))
  report.passed = true
} catch (error) {
  report.failure = String(error)
  report.passed = false
} finally {
  if (controller) report.close = await controller.close()
  for (const [index, discovery] of report.discoveries.entries()) {
    const cmd = (await readFile(`/proc/${discovery.parentPid}/cmdline`, "utf8").catch(() => "")).split("\0")
    if (cmd.includes(`--user-data-dir=${preparations[index].userData}`)) process.kill(discovery.parentPid, "SIGTERM")
  }
  report.endedAt = new Date().toISOString()
  await writeFile(join(directories[0]!, "selection-report.json"), JSON.stringify(report, null, 2), {
    flag: "wx",
    mode: 0o600,
  })
  console.log(JSON.stringify(report, null, 2))
  if (!report.passed) process.exitCode = 1
}
