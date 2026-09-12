import { createHash } from "node:crypto"
import { homedir } from "node:os"
import { readFile, readdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { validateProcessTrace } from "./evidence"
import { controllerReportFailures, probeReportFailures } from "./controller-checks"
import { decodePNG } from "../src/page"

const probeMode = process.argv.includes("--probes")
const extended = process.argv.includes("--extended")
const dirs = process.argv
  .slice(2)
  .filter((x) => x !== "--" && x !== "--probes" && x !== "--extended")
  .map((x) => resolve(x))
const failures: string[] = []
const runs: unknown[] = []
const epochs = new Set<string>()
let previousEnd = 0
if (probeMode) {
  for (const runDir of dirs) {
    try {
      const p = JSON.parse(await readFile(join(runDir, "preparation.json"), "utf8"))
      const identity = await readFile(join(runDir, "identity-report.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null)
      const selection = await readFile(join(runDir, "selection-report.json"), "utf8")
        .then(JSON.parse)
        .catch(() => null)
      const r = identity ?? selection
      failures.push(...probeReportFailures(r).map((x) => `${runDir}: ${x}`))
      const discoveries = identity
        ? [identity.snapshots[0].discovery, identity.snapshots.at(-1).discovery]
        : selection.discoveries
      for (const [index, d] of discoveries.entries()) {
        const actualDir = d.executable.slice(0, -"/host".length)
        const prep = actualDir === runDir ? p : JSON.parse(await readFile(join(actualDir, "preparation.json"), "utf8"))
        const tracePath =
          identity && index === 0 ? join(actualDir, "process-trace-before-browser-restart.log") : prep.trace
        const trace = validateProcessTrace(await readFile(tracePath, "utf8"), {
          runDir: actualDir,
          nativeManifest: prep.nativeManifest,
          productionManifest: prep.productionManifest.path,
          productionHostTarget: prep.productionManifest.hostTarget,
          extensionPath: prep.extension.path,
          browserExecutable: prep.browser.executable,
          browserPID: d.parentPid,
          hostLauncher: prep.hostLauncher,
          hostExecutable: prep.hostExecutable,
          hostPID: d.pid,
          originalHome: homedir(),
        })
        failures.push(...trace.failures.map((x) => `${actualDir}: ${x}`))
        for (const [path, hash] of [
          [join(prep.extension.path, "background.js"), prep.extension.backgroundSha256],
          [join(prep.extension.path, "manifest.json"), prep.extension.manifestSha256],
          [prep.hostExecutable, prep.hostSha256],
        ])
          if (
            createHash("sha256")
              .update(await readFile(path))
              .digest("hex") !== hash
          )
            failures.push(`${actualDir}: artifact hash mismatch`)
        if (
          createHash("sha256")
            .update(await readFile(prep.productionManifest.path))
            .digest("hex") !== prep.productionManifest.sha256
        )
          failures.push(`${actualDir}: production manifest changed`)
        for (const pid of await readdir("/proc")) {
          if (!/^\d+$/.test(pid)) continue
          const cmd = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0")
          if (cmd.includes(`--user-data-dir=${prep.userData}`) || cmd.includes(prep.hostExecutable))
            failures.push(`${actualDir}: owned PID${pid} still alive`)
        }
        runs.push({ runDir: actualDir, tracePath, trace, discovery: d })
      }
    } catch (error) {
      failures.push(`${runDir}: ${String(error)}`)
    }
  }
  console.log(
    JSON.stringify(
      { probeEvidencePassed: failures.length === 0 && dirs.length > 0, phase2AcceptancePassed: false, runs, failures },
      null,
      2,
    ),
  )
  process.exit(failures.length || !dirs.length ? 1 : 0)
}
if (dirs.length !== (extended ? 1 : 3) || new Set(dirs).size !== dirs.length)
  failures.push(extended ? "Exactly one extended run required" : "Exactly three distinct sequential runs required")
for (const runDir of dirs) {
  try {
    const p = JSON.parse(await readFile(join(runDir, "preparation.json"), "utf8"))
    const r = JSON.parse(await readFile(join(runDir, "controller-report.json"), "utf8"))
    const discovery = r.metadata.discovery
    failures.push(...controllerReportFailures(r, extended).map((x) => `${runDir}: ${x}`))
    if (!p.observer || !r.metadata.observations?.length) failures.push(`${runDir}: independent observer missing`)
    if (p.observer?.hashes)
      for (const [name, hash] of Object.entries(p.observer.hashes)) {
        if (
          createHash("sha256")
            .update(await readFile(join(p.observer.path, name)))
            .digest("hex") !== hash
        )
          failures.push(`${runDir}: observer modified`)
      }
    if (Date.parse(r.startedAt) <= previousEnd) failures.push(`${runDir}: overlapping/nonchronological suites`)
    previousEnd = Date.parse(r.endedAt)
    if (epochs.has(discovery.epoch)) failures.push(`${runDir}: reused epoch`)
    epochs.add(discovery.epoch)
    if (
      createHash("sha256")
        .update(await readFile(p.productionManifest.path))
        .digest("hex") !== p.productionManifest.sha256
    )
      failures.push(`${runDir}: production registration changed`)
    for (const [path, hash] of [
      [join(p.extension.path, "background.js"), p.extension.backgroundSha256],
      [join(p.extension.path, "manifest.json"), p.extension.manifestSha256],
      [p.hostExecutable, p.hostSha256],
    ])
      if (
        createHash("sha256")
          .update(await readFile(path))
          .digest("hex") !== hash
      )
        failures.push(`${runDir}: artifact hash mismatch`)
    const trace = validateProcessTrace(await readFile(p.trace, "utf8"), {
      runDir,
      nativeManifest: p.nativeManifest,
      productionManifest: p.productionManifest.path,
      productionHostTarget: p.productionManifest.hostTarget,
      extensionPath: p.extension.path,
      browserExecutable: p.browser.executable,
      browserPID: discovery.parentPid,
      hostLauncher: p.hostLauncher,
      hostExecutable: p.hostExecutable,
      hostPID: discovery.pid,
      originalHome: homedir(),
    })
    failures.push(...trace.failures.map((x) => `${runDir}: ${x}`))
    for (const pid of await readdir("/proc")) {
      if (!/^\d+$/.test(pid)) continue
      const cmd = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")
      if (cmd.split("\0").includes(`--user-data-dir=${p.userData}`) || cmd.split("\0").includes(p.hostExecutable))
        failures.push(`${runDir}: owned process ${pid} still alive`)
    }
    for (const [name, info] of [
      ["controller-screenshot.png", r.metadata.screenshot],
      ...(extended ? [["controller-scrolled.png", r.metadata.scrolledScreenshot]] : []),
    ]) {
      const image = decodePNG((await readFile(join(runDir, name))).toString("base64"))
      if (
        !info ||
        info.mime !== "image/png" ||
        info.width !== image.width ||
        info.height !== image.height ||
        ![info.mapping?.scaleX, info.mapping?.scaleY, info.mapping?.offsetX, info.mapping?.offsetY].every(
          Number.isFinite,
        ) ||
        Math.abs(image.width * info.mapping.scaleX - info.viewport.width) >= 1 ||
        Math.abs(image.height * info.mapping.scaleY - info.viewport.height) >= 1 ||
        (name === "controller-scrolled.png" && !(info.viewport.scrollY > 0))
      )
        failures.push(`${runDir}: screenshot metadata/mapping mismatch`)
    }
    const baseline = r.metadata.physicalBaseline
    const guard = r.assertions.find(
      (x: any) => x.name === "physical selection unchanged throughout input and screenshot",
    )
    const selected = (sample: any) =>
      JSON.stringify(
        sample.tabs
          .filter((x: any) => x.active)
          .map((x: any) => x.id)
          .sort(),
      )
    const observed = r.metadata.observations.filter((x: any) => x.at >= baseline.at && x.at <= guard.endedAt)
    if (
      observed.length < 3 ||
      observed.some(
        (x: any) =>
          x.epoch !== baseline.epoch ||
          x.activations.length !== baseline.activations.length ||
          selected(x) !== selected(baseline),
      )
    )
      failures.push(`${runDir}: physical selection evidence changed or missing during input/capture`)
    runs.push({
      runDir,
      assertions: r.assertions.length,
      trace,
      discovery,
      screenshot: r.metadata.screenshot,
      capabilities: r.metadata.capabilities,
    })
  } catch (error) {
    failures.push(`${runDir}: ${String(error)}`)
  }
}
console.log(
  JSON.stringify(
    {
      controllerSuitesPassed: failures.length === 0,
      phase2AcceptancePassed: false,
      remainingAcceptance:
        "Dedicated faults and all mandatory capability cases require separate evidence; unsupported never counts as passed",
      runs,
      failures,
    },
    null,
    2,
  ),
)
if (failures.length) process.exitCode = 1
