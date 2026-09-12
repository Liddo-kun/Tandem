// Evidence gates validate recorded facts, not just a report's aggregate success flag.
export function controllerReportFailures(report: any, extended = false): string[] {
  const failures: string[] = []
  const required = [
    "production registration and unmodified extension hashes",
    "exact prepared host executable profile and environment provenance",
    "explicit browser identity and unverified profile metadata",
    "busy host rejects second controller",
    extended
      ? "two sessions claim independent startup user fixtures"
      : "two sessions create background fixture tabs concurrently",
    "physical selected tab is unrelated user tab",
    "foreign session handle rejected",
    "overlapping target-local replacement input",
    "append inserts text once with trusted input",
    "textarea replace and allowed key are trusted",
    "ordinary contenteditable replace and append use trusted input",
    "framework-controlled input receives replace and append events",
    "two background clicks each dispatch exactly once and trusted",
    "open shadow root trusted click",
    "same-origin nested frame trusted click",
    "screenshot DPR and measured mapping",
    "coordinate click uses screenshot pixel mapping",
    "horizontal vertical and diagonal wheel target local scroll",
    "SPA route invalidates old element reference",
    "replaced DOM element cannot silently retarget",
    "removed same-origin frame invalidates its handle",
    "overlay blocks native click without submitting",
    "large DOM and excluded values stay bounded",
    "redirect changes origin and denied content remains unread",
    "HTTP error document differs from browser navigation failure",
    "cross-origin frame boundary is explicit",
    "physical selection unchanged throughout input and screenshot",
    "handoff finalization and ordinary cleanup confirmed",
    "handoff resumes in later turn with fresh handle",
    "deliverable preserved and released",
    "sessions close confirmed",
    "production manifest unchanged after suite",
    ...(extended
      ? [
          "background click establishes target-local focus without prior typing",
          "wheel at both scroll boundaries does not navigate",
          "nonzero document scroll preserves viewport screenshot mapping",
          "never-ready page respects deadline without blocking another session",
          "frame reload invalidates its document-bound handle",
        ]
      : []),
  ]
  if (
    report?.passed !== true ||
    !Array.isArray(report.assertions) ||
    report.assertions.some((x: any) => x.passed !== true)
  )
    return ["suite failed or assertions missing"]
  for (const name of required)
    if (report.assertions.filter((x: any) => x.name === name && x.passed === true).length !== 1)
      failures.push(`required assertion missing or duplicated: ${name}`)
  if (report.metadata?.close?.confirmed !== true) failures.push("controller close not confirmed")
  if (
    !Number.isFinite(Date.parse(report.startedAt)) ||
    !Number.isFinite(Date.parse(report.endedAt)) ||
    Date.parse(report.endedAt) <= Date.parse(report.startedAt)
  )
    failures.push("invalid suite timestamps")
  return failures
}

export function probeReportFailures(report: any): string[] {
  if (!report || report.failure) return ["probe failed or missing"]
  const failures: string[] = []
  if (Array.isArray(report.discoveries)) {
    const required = [
      "two configured bindings resolve to independent exact browser processes",
      "same caller identities create independent agent tabs on both browsers",
      "foreign browser handle rejected before inspection",
      "both browsers independently verify disposable tab cleanup",
    ]
    if (
      report.passed !== true ||
      report.close?.confirmed !== true ||
      report.discoveries.length !== 2 ||
      report.discoveries[0].parentPid === report.discoveries[1].parentPid
    )
      failures.push("independent browser selection or close failed")
    for (const name of required)
      if (!report.assertions?.some((x: any) => x.name === name && x.passed === true))
        failures.push(`missing selection assertion: ${name}`)
    if (report.cleanup?.length !== 2 || report.cleanup.some((x: any) => x.confirmed !== true))
      failures.push("selection cleanup not confirmed")
    return failures
  }
  if (!Array.isArray(report.outcomes) || report.outcomes.some((x: any) => x.passed === false))
    return ["fault outcomes failed or missing"]
  const outcome = (name: string) => {
    const matches = report.outcomes.filter((x: any) => x.fault === name)
    if (matches.length !== 1) failures.push(`missing or duplicated fault: ${name}`)
    return matches[0] ?? {}
  }
  for (const name of ["host-SIGTERM", "host-SIGKILL"]) {
    const x = outcome(name)
    if (
      x.epochChanged !== true ||
      x.browserPIDStable !== true ||
      x.extensionInstanceStable !== true ||
      x.generationStable !== true ||
      x.pendingFailure?.code !== "disconnected"
    )
      failures.push(`${name}: identity or pending failure not established`)
  }
  const late = outcome("late native completion before endTurn")
  if (
    late.passed !== true ||
    late.effects !== 1 ||
    late.result?.outcome !== "unknown" ||
    late.settled?.state !== "settled" ||
    late.settled?.outcome !== "confirmed" ||
    late.completion?.status !== "confirmed"
  )
    failures.push("late mutation did not settle exactly once before cleanup")
  for (const origin of ["agent", "user"])
    for (const disposition of ["default", "handoff", "deliverable"]) {
      const matches = report.outcomes.filter(
        (x: any) => x.fault === "lifecycle contract" && x.origin === origin && x.disposition === disposition,
      )
      const x = matches[0]
      if (
        matches.length !== 1 ||
        x?.passed !== true ||
        x?.completion?.status !== "confirmed" ||
        x?.completion?.stage !== "verification" ||
        (disposition === "handoff" && (x?.resumed !== true || x?.release?.status !== "confirmed"))
      )
        failures.push(`unconfirmed disposition: ${origin}/${disposition}`)
    }
  const controller = outcome("controller-process-SIGKILL")
  if (controller.passed !== true || controller.hostEpochStable !== true)
    failures.push("controller crash cleanup not established")
  const worker = outcome("worker-restart")
  if (
    worker.passed !== true ||
    worker.disconnected !== true ||
    worker.epochChanged !== true ||
    worker.browserPIDStable !== true ||
    worker.generationChanged !== true
  )
    failures.push("worker restart identity not established")
  const browser = outcome("browser-SIGKILL-restart")
  if (
    browser.epochChanged !== true ||
    browser.browserPIDChanged !== true ||
    browser.extensionInstanceStable !== true ||
    browser.generationStable !== false
  )
    failures.push("browser restart identity not established")
  return failures
}
