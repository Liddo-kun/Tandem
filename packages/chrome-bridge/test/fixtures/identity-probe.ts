// Dedicated test transport identity/fault probe; never used as controller-action evidence.
import { spawn } from "node:child_process"
import { openSync, closeSync } from "node:fs"
import { copyFile, readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { connect } from "../../src/client"
import { probeReportFailures } from "../../script/controller-checks"

const runDir = resolve(process.argv[2] ?? "")
const preparation = JSON.parse(await readFile(join(runDir, "preparation.json"), "utf8"))
if (preparation.runDir !== runDir || !preparation.trace) throw new Error("Requires explicit traced preparation")
if (!preparation.faultControl) throw new Error("Requires --fault-control isolated preparation")
let restartRequested = false
const workerEvents: string[] = []
const control = Bun.serve({
  hostname: "127.0.0.1",
  port: preparation.faultControl.port,
  async fetch(request) {
    if (new URL(request.url).searchParams.get("token") !== preparation.faultControl.token)
      return new Response("Forbidden", { status: 403 })
    if (request.method === "POST") {
      const value = (await request.json()) as { event: string }
      workerEvents.push(value.event)
      return new Response("ok")
    }
    return new Response(restartRequested ? "restart" : "wait")
  },
})
const report: any = {
  startedAt: new Date().toISOString(),
  scope: "raw test-only identity and lifecycle fault probes, not controller-action acceptance",
  snapshots: [],
  outcomes: [],
  pids: [],
}
let client: Awaited<ReturnType<typeof connect>> | undefined
async function launch() {
  const fd = openSync(join(runDir, "identity-browser.log"), "a", 0o600)
  const child = spawn("/usr/bin/timeout", ["--kill-after=5s", "180s", preparation.launcher], {
    detached: true,
    stdio: ["ignore", fd, fd],
  })
  child.unref()
  closeSync(fd)
  report.pids.push({ wrapper: child.pid })
  await reconnect()
}
async function reconnect(oldEpoch?: string) {
  const deadline = Date.now() + 25000
  while (Date.now() < deadline) {
    try {
      const candidates = (await readdir(runDir)).filter(
        (x) => /^host-.+\.json$/.test(x) && x !== `host-${oldEpoch}.json`,
      )
      for (const hostId of candidates) {
        try {
          const next = await connect(runDir, { hostId })
          client = next
          return
        } catch {}
      }
      await Bun.sleep(150)
    } catch {
      await Bun.sleep(150)
    }
  }
  throw new Error("No fresh native epoch within 25 seconds")
}
async function snapshot(kind: string) {
  const info = await client!.call("getInfo")
  const discovery = client!.discovery
  const args = (await readFile(`/proc/${discovery.parentPid}/cmdline`, "utf8")).split("\0")
  if (!args.includes(`--user-data-dir=${preparation.userData}`))
    throw new Error("Refusing fault against unowned browser")
  const value = { kind, at: new Date().toISOString(), discovery, info, status: await client!.status() }
  report.snapshots.push(value)
  return value
}
try {
  await launch()
  let before = await snapshot("initial")
  for (const signal of ["SIGTERM", "SIGKILL"] as const) {
    const disconnected = client!.call("ping").catch((error) => ({ code: error.code, outcome: error.outcome }))
    process.kill(before.discovery.pid, signal)
    await disconnected
    client!.close()
    await reconnect(before.discovery.epoch)
    const after = await snapshot(`host-${signal}`)
    report.outcomes.push({
      fault: `host-${signal}`,
      epochChanged: before.discovery.epoch !== after.discovery.epoch,
      browserPIDStable: before.discovery.parentPid === after.discovery.parentPid,
      extensionInstanceStable:
        JSON.stringify((before.info as any).metadata) === JSON.stringify((after.info as any).metadata),
      generationStable:
        (before.info as any).browserTabMentions?.generation === (after.info as any).browserTabMentions?.generation,
      pendingFailure: await disconnected,
    })
    before = after
  }
  const late = { session_id: crypto.randomUUID(), turn_id: crypto.randomUUID(), session_context: "live" }
  const tab: any = await client!.call("createTab", late)
  await client!.call("attach", { ...late, tabId: tab.id })
  const operationId = crypto.randomUUID()
  let lateCalls = 0
  const telemetry = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch() {
      lateCalls++
      return new Response("ok", { headers: { "access-control-allow-origin": "*" } })
    },
  })
  try {
    const start = Date.now()
    const result = await client!
      .call(
        "executeCdp",
        {
          ...late,
          target: { tabId: tab.id },
          method: "Runtime.evaluate",
          commandParams: {
            expression: `new Promise(resolve=>setTimeout(async()=>{await fetch("http://127.0.0.1:${telemetry.port}/");resolve(1)},1200))`,
            awaitPromise: true,
            returnByValue: true,
          },
        },
        100,
        { operationId },
      )
      .then(
        () => ({ unexpectedSuccess: true }),
        (error) => ({ code: error.code, outcome: error.outcome }),
      )
    const immediate = await client!.operationStatus(operationId)
    const completion = await client!.endTurn(late)
    const settled = await client!.operationStatus(operationId)
    report.outcomes.push({
      fault: "late native completion before endTurn",
      result,
      immediate,
      completion,
      settled,
      elapsedMs: Date.now() - start,
      effects: lateCalls,
      passed:
        (result as any).outcome === "unknown" &&
        lateCalls === 1 &&
        settled?.state === "settled" &&
        completion.status === "confirmed",
    })
  } finally {
    telemetry.stop(true)
  }
  for (const origin of ["agent", "user"] as const)
    for (const disposition of ["default", "handoff", "deliverable"] as const) {
      const lifecycle = { session_id: crypto.randomUUID(), turn_id: crypto.randomUUID(), session_context: "live" }
      const tab: any =
        origin === "agent"
          ? await client!.call("createTab", lifecycle)
          : await client!.call("claimUserTab", {
              ...lifecycle,
              tabId: (await client!.call<any[]>("getUserTabs")).find((x) => x.url === "about:blank")!.id,
            })
      await client!.call("attach", { ...lifecycle, tabId: tab.id })
      const completion = await client!.endTurn({
        ...lifecycle,
        keep: disposition === "default" ? [] : [{ tabId: tab.id, status: disposition }],
      })
      const outcome: any = {
        fault: "lifecycle contract",
        origin,
        disposition,
        tabId: tab.id,
        completion,
        passed: completion.status === "confirmed",
      }
      if (disposition === "handoff" && completion.status === "confirmed") {
        const resumed = { ...lifecycle, turn_id: crypto.randomUUID() }
        await client!.call("attach", { ...resumed, tabId: tab.id })
        outcome.resumed = true
        outcome.release = await client!.endTurn({ ...resumed, keep: [{ tabId: tab.id, status: "deliverable" }] })
        outcome.passed &&= outcome.release.status === "confirmed"
      }
      report.outcomes.push(outcome)
    }
  client!.close()
  await Bun.sleep(300)
  const child = Bun.spawn(
    [
      process.execPath,
      "-e",
      `
    const {connect}=await import(${JSON.stringify(fileURLToPath(new URL("../../src/client.ts", import.meta.url)))});
    const client=await connect(${JSON.stringify(runDir)},{hostId:${JSON.stringify(`host-${before.discovery.epoch}`)}});
    const turn={session_id:crypto.randomUUID(),turn_id:crypto.randomUUID()};
    const tab=await client.call("createTab",turn);
    await client.call("attach",{...turn,tabId:tab.id});
    console.log(JSON.stringify({tabId:tab.id,...turn}));
    setInterval(()=>{},1000);
  `,
    ],
    { stdout: "pipe", stderr: "pipe" },
  )
  let crashedTab: { tabId: number }
  try {
    const reader = child.stdout.getReader()
    const first = await Promise.race([
      reader.read(),
      Bun.sleep(10000).then(() => {
        throw new Error("Controller child acquisition timed out")
      }),
    ])
    crashedTab = JSON.parse(new TextDecoder().decode(first.value))
  } finally {
    child.kill("SIGKILL")
    await child.exited
  }
  await reconnect()
  const audit = { session_id: crypto.randomUUID(), turn_id: crypto.randomUUID() }
  const remaining: any = await client!.call("executeCdp", {
    ...audit,
    target: {},
    method: "Target.getTargets",
    commandParams: {},
  })
  report.outcomes.push({
    fault: "controller-process-SIGKILL",
    tabId: crashedTab.tabId,
    passed: !remaining.targetInfos.some((x: any) => x.tabId === crashedTab.tabId),
    hostEpochStable: client!.discovery.epoch === before.discovery.epoch,
  })
  await client!.endTurn(audit)
  // The extension's browser-target seam may not expose worker targets. Never guess an ID.
  const scope = { session_id: crypto.randomUUID(), turn_id: crypto.randomUUID(), session_context: "live" }
  const targets: any = await client!.call("executeCdp", {
    ...scope,
    target: {},
    method: "Target.getTargets",
    commandParams: {},
  })
  const worker = targets.targetInfos?.find(
    (x: any) => x.type === "service_worker" && x.url?.startsWith(`chrome-extension://${preparation.extension.id}/`),
  )
  report.workerTarget = worker ?? null
  await client!.endTurn(scope)
  // The separate fixed-purpose fixture disables/re-enables only this extension in this profile.
  // It does not modify the ChatGPT extension or masquerade as the read-only tab observer.
  restartRequested = true
  const workerDeadline = Date.now() + 20000
  while (!workerEvents.includes("enabled") && !workerEvents.includes("failed") && Date.now() < workerDeadline)
    await Bun.sleep(100)
  if (!workerEvents.includes("enabled")) throw new Error("Extension worker restart fixture failed")
  restartRequested = false
  const disconnected = await client!.status().then(
    () => false,
    () => true,
  )
  client!.close()
  await reconnect(before.discovery.epoch)
  const restarted = await snapshot("extension-disable-enable-worker-restart")
  report.outcomes.push({
    fault: "worker-restart",
    mechanism: "profile-scoped extension disable/enable",
    events: workerEvents,
    disconnected,
    epochChanged: before.discovery.epoch !== restarted.discovery.epoch,
    browserPIDStable: before.discovery.parentPid === restarted.discovery.parentPid,
    generationChanged:
      (before.info as any).browserTabMentions?.generation !== (restarted.info as any).browserTabMentions?.generation,
    passed:
      disconnected &&
      before.discovery.epoch !== restarted.discovery.epoch &&
      before.discovery.parentPid === restarted.discovery.parentPid,
  })
  before = restarted
  client!.close()
  process.kill(before.discovery.parentPid, "SIGKILL")
  await Bun.sleep(2500)
  await copyFile(preparation.trace, join(runDir, "process-trace-before-browser-restart.log"))
  await launch()
  const after = await snapshot("browser-restart-same-profile")
  report.outcomes.push({
    fault: "browser-SIGKILL-restart",
    epochChanged: before.discovery.epoch !== after.discovery.epoch,
    browserPIDChanged: before.discovery.parentPid !== after.discovery.parentPid,
    extensionInstanceStable:
      JSON.stringify((before.info as any).metadata) === JSON.stringify((after.info as any).metadata),
    generationStable:
      (before.info as any).browserTabMentions?.generation === (after.info as any).browserTabMentions?.generation,
  })
} catch (error) {
  report.failure = String(error)
} finally {
  if (client) {
    const pid = client.discovery.parentPid
    client.close()
    try {
      process.kill(pid, "SIGTERM")
    } catch {}
  }
  report.endedAt = new Date().toISOString()
  control.stop(true)
  await writeFile(join(runDir, "identity-report.json"), JSON.stringify(report, null, 2), { flag: "wx", mode: 0o600 })
  console.log(JSON.stringify(report, null, 2))
  if (probeReportFailures(report).length) process.exitCode = 1
}
