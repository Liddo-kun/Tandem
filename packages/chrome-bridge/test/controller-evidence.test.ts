import { expect, test } from "bun:test"
import { controllerReportFailures, probeReportFailures } from "../script/controller-checks"

function faults() {
  const completion = { status: "confirmed", stage: "verification" }
  return {
    outcomes: [
      ...["host-SIGTERM", "host-SIGKILL"].map((fault) => ({
        fault,
        epochChanged: true,
        browserPIDStable: true,
        extensionInstanceStable: true,
        generationStable: true,
        pendingFailure: { code: "disconnected" },
      })),
      {
        fault: "late native completion before endTurn",
        passed: true,
        effects: 1,
        result: { outcome: "unknown" },
        settled: { state: "settled", outcome: "confirmed" },
        completion,
      },
      ...["agent", "user"].flatMap((origin) =>
        ["default", "handoff", "deliverable"].map((disposition) => ({
          fault: "lifecycle contract",
          origin,
          disposition,
          passed: true,
          completion,
          resumed: true,
          release: completion,
        })),
      ),
      { fault: "controller-process-SIGKILL", passed: true, hostEpochStable: true },
      {
        fault: "worker-restart",
        passed: true,
        disconnected: true,
        epochChanged: true,
        browserPIDStable: true,
        generationChanged: true,
      },
      {
        fault: "browser-SIGKILL-restart",
        epochChanged: true,
        browserPIDChanged: true,
        extensionInstanceStable: true,
        generationStable: false,
      },
    ],
  }
}

test("controller evidence cannot pass with empty, skipped, or duplicated assertions", () => {
  const report = {
    passed: true,
    assertions: [] as any[],
    metadata: { close: { confirmed: true } },
    startedAt: "2026-09-10T01:00:00Z",
    endedAt: "2026-09-10T01:01:00Z",
  }
  expect(controllerReportFailures(report).length).toBeGreaterThan(20)
  report.assertions.push({ name: "physical selection unchanged throughout input and screenshot", passed: true })
  expect(controllerReportFailures(report).some((x) => x.includes("physical selection unchanged"))).toBe(false)
  report.assertions.push(report.assertions[0])
  expect(controllerReportFailures(report).some((x) => x.includes("physical selection unchanged"))).toBe(true)
  report.assertions[0] = { passed: "unsupported" }
  expect(controllerReportFailures(report)).toContain("suite failed or assertions missing")
})

test("fault evidence requires every disposition and actual restart identity facts", () => {
  expect(probeReportFailures(faults())).toEqual([])
  for (let i = 0; i < faults().outcomes.length; i++) {
    const report = faults()
    report.outcomes.splice(i, 1)
    expect(probeReportFailures(report).length).toBeGreaterThan(0)
  }
  for (const [fault, property] of [
    ["host-SIGKILL", "epochChanged"],
    ["worker-restart", "generationChanged"],
    ["browser-SIGKILL-restart", "browserPIDChanged"],
  ]) {
    const report = faults()
    const outcome = report.outcomes.find((x) => x.fault === fault)! as any
    delete outcome[property!]
    outcome.passed = true
    expect(probeReportFailures(report).length).toBeGreaterThan(0)
  }
  const report = faults()
  ;(report.outcomes.find((x) => x.fault === "late native completion before endTurn")! as any).effects = 2
  expect(probeReportFailures(report)).toContain("late mutation did not settle exactly once before cleanup")
})

test("selection evidence cannot pass on one browser or unconfirmed cleanup", () => {
  expect(
    probeReportFailures({
      passed: true,
      discoveries: [{ parentPid: 1 }, { parentPid: 1 }],
      assertions: [],
      close: { confirmed: true },
    }),
  ).toContain("independent browser selection or close failed")
  expect(
    probeReportFailures({
      passed: true,
      discoveries: [{ parentPid: 1 }, { parentPid: 2 }],
      assertions: [],
      close: { confirmed: true },
    }),
  ).toContain("selection cleanup not confirmed")
})
