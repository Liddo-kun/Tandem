import { createHash, randomUUID } from "node:crypto"
import { chmod, readFile, writeFile } from "node:fs/promises"
import { inflateSync } from "node:zlib"
import { isAbsolute, join, resolve } from "node:path"
import { connect, EXTENSION_ID } from "../src/client"

type Preparation = {
  runDir: string
  productionManifest: { path: string; sha256: string }
  extension: { id: string; version: string; backgroundSha256: string; manifestSha256: string; path: string }
  browser: { executable: string; version: string }
  home: string
  config: string
  userData: string
  ipcDirectory?: string
  hostExecutable: string
  launcher: string
}

type Assertion = {
  name: string
  passed: boolean
  durationMs: number
  detail?: unknown
  failure?: string
}

type Tab = { id: number; url?: string; pendingUrl?: string }
type TargetInfo = { id: string; tabId?: number; url: string; attached: boolean; type: string }
type RuntimeResult<T> = { result: { value?: T; type: string; description?: string }; exceptionDetails?: unknown }

const startedAt = new Date()
const assertions: Assertion[] = []
const failures: string[] = []
const runDirArgument = parseRunDir(process.argv.slice(2))
const runDir = runDirArgument ? resolve(runDirArgument) : undefined
const reportPath = runDir && join(runDir, "smoke-report.json")
const screenshotPath = runDir && join(runDir, "screenshot.png")
const metadata: Record<string, unknown> = {
  command: "bun run --cwd packages/chrome-bridge smoke -- --run-dir <prepared-run-dir>",
  runDir,
  fixture: null,
  preparation: null,
  discovery: null,
  extensionInfo: null,
  tabIDs: { original: [], claimedUser: null, created: null, final: [] },
  heartbeat: null,
  reconnect: null,
  turns: {},
  screenshots: [],
}

let client: Awaited<ReturnType<typeof connect>> | undefined
let server: ReturnType<typeof Bun.serve> | undefined
let productionBefore: Buffer | undefined
let preparation: Preparation | undefined
const activeTurns = new Map<string, { session_id: string; turn_id: string }>()

try {
  await check("CLI has exactly --run-dir <path>", () =>
    requireValue(runDir, "Usage: smoke.ts --run-dir <prepared-run-dir>"),
  )
  const preparationPath = join(runDir!, "preparation.json")
  preparation = await check("preparation.json has the required shape", async () => {
    const value: unknown = JSON.parse(await readFile(preparationPath, "utf8"))
    if (!isPreparation(value)) throw new Error("Invalid preparation.json")
    return value
  })
  metadata.preparation = preparation
  await check("preparation run directory matches --run-dir", () => {
    equal(resolve(preparation!.runDir), runDir, "preparation runDir mismatch")
  })
  await check("preparation paths are absolute", () => {
    for (const path of [
      preparation!.productionManifest.path,
      preparation!.extension.path,
      preparation!.browser.executable,
      preparation!.home,
      preparation!.config,
      preparation!.userData,
      preparation!.hostExecutable,
      preparation!.launcher,
    ])
      if (!isAbsolute(path)) throw new Error(`Preparation path is not absolute: ${path}`)
  })
  await check("prepared HOME, config, user data, and launcher are isolated under the run directory", () => {
    for (const path of [preparation!.home, preparation!.config, preparation!.userData, preparation!.launcher]) {
      if (!inside(runDir!, path)) throw new Error(`Prepared path escapes the run directory: ${path}`)
    }
  })
  await check("prepared extension ID is the expected unmodified extension", () => {
    equal(preparation!.extension.id, EXTENSION_ID, "unexpected extension ID")
  })
  await check("extension assets still match the preparation hashes", async () => {
    equal(
      sha256(await readFile(join(preparation!.extension.path, "manifest.json"))),
      preparation!.extension.manifestSha256,
      "extension manifest changed",
    )
    equal(
      sha256(await readFile(join(preparation!.extension.path, "background.js"))),
      preparation!.extension.backgroundSha256,
      "extension background changed",
    )
  })
  await check("production manifest matches its prepared SHA-256", async () => {
    productionBefore = await readFile(preparation!.productionManifest.path)
    equal(
      sha256(productionBefore),
      preparation!.productionManifest.sha256.toLowerCase(),
      "production manifest hash mismatch",
    )
  })

  const fixture = await readFile(new URL("../test/fixture.html", import.meta.url))
  server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const url = new URL(request.url)
      if (url.pathname !== "/") return new Response("Not found", { status: 404 })
      return new Response(fixture, {
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
      })
    },
  })
  const fixtureURL = `http://127.0.0.1:${server.port}/`
  metadata.fixture = fixtureURL

  client = await check("connect to the explicitly prepared native host", () =>
    connect(preparation!.ipcDirectory ?? runDir!),
  )
  metadata.discovery = client.discovery
  await check("discovery executable is the prepared host executable", () => {
    equal(client!.discovery.executable, preparation!.hostExecutable, "host executable mismatch")
  })
  const initialStatus = await check("host status identifies discovery processes", async () => {
    const status = await client!.status()
    equal(status.pid, client!.discovery.pid, "host PID mismatch")
    equal(status.parentPid, client!.discovery.parentPid, "browser PID mismatch")
    return status
  })
  await check("browser command line has the exact isolated user-data argument", async () => {
    const args = splitNull(await readFile(`/proc/${initialStatus.parentPid}/cmdline`))
    if (!args.includes(`--user-data-dir=${preparation!.userData}`))
      throw new Error("isolated --user-data-dir argument not found")
  })
  await check("host environment has isolated HOME and no CODEX_CLI_PATH", async () => {
    const environment = splitNull(await readFile(`/proc/${initialStatus.pid}/environ`))
    if (!environment.includes(`HOME=${preparation!.home}`)) throw new Error("isolated HOME not found")
    if (environment.some((entry) => entry.startsWith("CODEX_CLI_PATH="))) throw new Error("CODEX_CLI_PATH is present")
  })

  await check("ping returns pong", async () => equal(await client!.call("ping"), "pong", "ping failed"))
  const extensionInfo = await check("getInfo reports the prepared extension ID", async () => {
    const info = await client!.call<unknown>("getInfo")
    if (!isRecord(info) || !isRecord(info.metadata)) throw new Error("getInfo returned an unexpected shape")
    equal(info.metadata.extensionId, preparation!.extension.id, "getInfo extension ID mismatch")
    // Ordinary Chromium may report "unknown"; the manifest hash pins the build.
    if (info.version !== "unknown")
      equal(info.version, preparation!.extension.version, "getInfo extension version mismatch")
    return info
  })
  metadata.extensionInfo = extensionInfo

  const originalTabs = await check("getUserTabs returns a raw tab array", async () =>
    tabArray(await client!.call("getUserTabs", {})),
  )
  const originalIDs = originalTabs.map((tab) => tab.id)
  ;(metadata.tabIDs as Record<string, unknown>).original = originalIDs

  const inspector = turn("inspector")
  activeTurns.set("inspector", inspector)
  const initialTargets = await check("inspect initial debugger targets", () => targets(inspector))
  const blank = originalTabs.find((tab) => (tab.url ?? tab.pendingUrl) === "about:blank")
  if (blank) {
    const claim = turn("user-tab")
    activeTurns.set("user-tab", claim)
    ;(metadata.tabIDs as Record<string, unknown>).claimedUser = blank.id
    await check("claim unrelated startup about:blank user tab", async () => {
      const result = await client!.call<Tab>("claimUserTab", { ...claim, session_context: "live", tabId: blank.id })
      equal(result.id, blank.id, "claimUserTab returned a different tab")
    })
    await check("attach claimed user tab returns void", async () => {
      equal(
        await client!.call("attach", { ...claim, session_context: "live", tabId: blank.id }),
        null,
        "attach was not void",
      )
    })
    await check("claimed user tab is attached", async () => {
      const target = (await targets(inspector)).find((item) => item.tabId === blank.id)
      if (!target?.attached) throw new Error("claimed user tab is not attached")
    })
    await check("end claimed user-tab turn", () => endTurn("user-tab"))
    await check("ended user turn preserves and detaches its tab", async () => {
      const tabs = tabArray(await client!.call("getUserTabs", {}))
      if (!tabs.some((tab) => tab.id === blank.id)) throw new Error("claimed user tab was closed")
      const target = (await targets(inspector)).find((item) => item.tabId === blank.id)
      if (!target || target.attached) throw new Error("claimed user tab was not detached")
    })
  } else {
    throw new Error(
      "Required unrelated startup about:blank tab is missing; launch the prepared browser with about:blank",
    )
  }

  const core = turn("core")
  activeTurns.set("core", core)
  const created = await check("createTab returns a numeric tab ID", async () => {
    const tab = await client!.call<Tab>("createTab", { ...core, session_context: "live" })
    if (!Number.isSafeInteger(tab?.id) || tab.id <= 0) throw new Error("createTab returned an invalid ID")
    return tab
  })
  ;(metadata.tabIDs as Record<string, unknown>).created = created.id
  await check("attach created tab returns void", async () => {
    equal(
      await client!.call("attach", { ...core, session_context: "live", tabId: created.id }),
      null,
      "attach was not void",
    )
  })
  await check("created tab debugger target is attached", async () => {
    const target = (await targets(inspector)).find((item) => item.tabId === created.id)
    if (!target?.attached) throw new Error("created tab is not attached")
  })

  await check("navigate created tab to the loopback fixture", () =>
    cdp(core, created.id, "Page.navigate", { url: fixtureURL }),
  )
  await check("fixture readiness marker appears within 10 seconds", async () => {
    await waitFor(
      async () => await evaluate<boolean>(core, created.id, "document.body?.dataset.ready === 'true'"),
      10_000,
    )
  })
  await check("bring the disposable fixture tab to the foreground", () =>
    cdp(core, created.id, "Page.bringToFront", {}),
  )
  await check("fixture heading and original input value are correct", async () => {
    const state = await evaluate<{ heading: string | null; value: string | undefined }>(
      core,
      created.id,
      "({heading: document.querySelector('h1')?.textContent, value: document.querySelector('#smoke-input')?.value})",
    )
    equal(state.heading, "Tandem Chrome Bridge Ready", "heading mismatch")
    equal(state.value, "original", "initial input mismatch")
  })
  await check("focus and select the complete input value", async () => {
    equal(
      await evaluate(
        core,
        created.id,
        "(() => { const input = document.querySelector('#smoke-input'); input.focus(); input.select(); return input === document.activeElement && input.selectionStart === 0 && input.selectionEnd === input.value.length })()",
      ),
      true,
      "input was not focused and selected",
    )
  })
  await check("insert replacement text exactly once", () =>
    cdp(core, created.id, "Input.insertText", { text: "replacement" }),
  )
  await check("Input.insertText replaces rather than appends", async () => {
    equal(
      await evaluate(core, created.id, "document.querySelector('#smoke-input').value"),
      "replacement",
      "final input mismatch",
    )
  })

  const rect = await check("read button coordinates", () =>
    evaluate<{ left: number; top: number; right: number; bottom: number }>(
      core,
      created.id,
      "(() => { const r = document.querySelector('#smoke-button').getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom} })()",
    ),
  )
  const x = (rect.left + rect.right) / 2
  const y = (rect.top + rect.bottom) / 2
  await check("dispatch one coordinate mouse press and release", async () => {
    await cdp(core, created.id, "Input.dispatchMouseEvent", {
      type: "mousePressed",
      x,
      y,
      button: "left",
      clickCount: 1,
    })
    await cdp(core, created.id, "Input.dispatchMouseEvent", {
      type: "mouseReleased",
      x,
      y,
      button: "left",
      clickCount: 1,
    })
  })
  await check("one trusted coordinate click lands within the button", async () => {
    await waitFor(async () => (await evaluate<number>(core, created.id, "window.smokeClick.count")) !== 0, 3000)
    const click = await evaluate<{ count: number; x: number; y: number; trusted: boolean }>(
      core,
      created.id,
      "window.smokeClick",
    )
    equal(click.count, 1, "click count mismatch")
    equal(click.trusted, true, "click was not trusted")
    if (click.x < rect.left || click.x > rect.right || click.y < rect.top || click.y > rect.bottom)
      throw new Error("recorded click is outside button bounds")
  })

  await check("capture, decode, and save a valid PNG screenshot", async () => {
    const capture = await cdp<{ data: string }>(core, created.id, "Page.captureScreenshot", { format: "png" })
    const bytes = Buffer.from(capture.data, "base64")
    const image = decodePng(bytes)
    if (image.width < 1 || image.height < 1 || image.distinctByteValues < 2)
      throw new Error("PNG has no meaningful image content")
    await writeFile(screenshotPath!, bytes, { mode: 0o600, flag: "wx" })
    await chmod(screenshotPath!, 0o600)
    ;(metadata.screenshots as unknown[]).push({
      path: screenshotPath,
      mime: "image/png",
      width: image.width,
      height: image.height,
      bytes: bytes.length,
      decoded: true,
      visualInspection: "required outside this automated runner",
    })
    return image
  })

  await check("65-second connection wait receives at least two heartbeats", async () => {
    const heartbeatBefore = await client!.status()
    const heartbeatWaitStarted = performance.now()
    await Bun.sleep(65_000)
    const heartbeatAfter = await client!.status()
    const heartbeatWaitMs = performance.now() - heartbeatWaitStarted
    metadata.heartbeat = {
      before: heartbeatBefore,
      after: heartbeatAfter,
      delta: heartbeatAfter.heartbeats - heartbeatBefore.heartbeats,
      waitMs: heartbeatWaitMs,
    }
    if (heartbeatWaitMs < 65_000) throw new Error("heartbeat observation interval was too short")
    if (heartbeatAfter.heartbeats - heartbeatBefore.heartbeats < 2) throw new Error("fewer than two heartbeats arrived")
  })
  await check("post-wait read succeeds", async () => {
    equal(
      await evaluate(core, created.id, "document.querySelector('#click-count').value"),
      "1",
      "post-wait read mismatch",
    )
  })
  await check("unknown method fails without breaking the bridge", async () => {
    await expectFailure(() => client!.call(`tandemUnknown_${randomUUID()}`, {}, 3000))
  })
  await check("invalid tab fails without acting on another tab", async () => {
    await expectFailure(() => cdp(core, 2_147_483_647, "Runtime.evaluate", { expression: "1" }, 3000))
  })
  await check("ping succeeds after RPC errors", async () =>
    equal(await client!.call("ping"), "pong", "post-error ping failed"),
  )

  await check("normal turnEnded succeeds", () => endTurn("core"))
  await check("normal turnEnded removes the disposable tab and target", async () => {
    const tabs = tabArray(await client!.call("getUserTabs", {}))
    if (tabs.some((tab) => tab.id === created.id)) throw new Error("disposable tab remains")
    const currentTargets = await targets(inspector)
    if (currentTargets.some((target) => target.tabId === created.id || target.url === fixtureURL))
      throw new Error("disposable target remains")
  })
  await check("all original user tabs remain", async () => {
    const tabs = tabArray(await client!.call("getUserTabs", {}))
    const ids = tabs.map((tab) => tab.id)
    ;(metadata.tabIDs as Record<string, unknown>).final = ids
    for (const id of originalIDs) if (!ids.includes(id)) throw new Error(`original tab ${id} is missing`)
  })
  await check("no unexpected pre-existing target was lost", async () => {
    const current = await targets(inspector)
    for (const target of initialTargets) {
      if (
        target.tabId !== undefined &&
        originalIDs.includes(target.tabId) &&
        !current.some((item) => item.tabId === target.tabId)
      ) {
        throw new Error(`original target for tab ${target.tabId} is missing`)
      }
    }
  })
  const restart = turn("restart")
  activeTurns.set("restart", restart)
  const restartTab = await check("create disposable tab for native restart", () =>
    client!.call<Tab>("createTab", { ...restart, session_context: "live" }),
  )
  await client.call("attach", { ...restart, session_context: "live", tabId: restartTab.id })
  const pending = cdp(restart, restartTab.id, "Runtime.evaluate", {
    expression: "new Promise(resolve => setTimeout(() => resolve(1), 500))",
    awaitPromise: true,
    returnByValue: true,
  }).then(
    () => false,
    () => true,
  )
  await Bun.sleep(50)
  await check("native host shutdown rejects a pending controller call", async () => {
    process.kill(initialStatus.pid, "SIGTERM")
    equal(await pending, true, "pending call unexpectedly completed before host shutdown")
  })
  client.close()
  client = undefined
  await check("extension reconnects to a fresh native host", async () => {
    await waitFor(async () => {
      try {
        client = await connect(preparation!.ipcDirectory ?? runDir!, { timeoutMs: 1000 })
      } catch {
        return false
      }
      return true
    }, 20_000)
    const status = await client!.status()
    if (status.pid === initialStatus.pid || status.parentPid !== initialStatus.parentPid)
      throw new Error("unexpected native-host replacement identity")
    equal(await client!.call("ping"), "pong", "reconnected ping failed")
    metadata.reconnect = {
      oldHostPid: initialStatus.pid,
      newHostPid: status.pid,
      parentPid: status.parentPid,
      pendingRejected: true,
    }
  })
  await check("native restart cleanup closes only its disposable tab", async () => {
    const tabs = tabArray(await client!.call("getUserTabs", {}))
    if (tabs.some((tab) => tab.id === restartTab.id)) throw new Error("restart tab was not cleaned up")
    for (const id of originalIDs)
      if (!tabs.some((tab) => tab.id === id)) throw new Error("native restart lost an original user tab")
    await expectFailure(() =>
      client!.call(
        "executeCdp",
        {
          ...restart,
          session_context: "cached",
          target: { tabId: restartTab.id },
          method: "Runtime.evaluate",
          commandParams: { expression: "1" },
        },
        3000,
      ),
    )
    activeTurns.delete("restart")
    activeTurns.delete("inspector")
  })
} catch (cause) {
  const failure = errorMessage(cause)
  if (!failures.some((entry) => entry === failure || entry.endsWith(`: ${failure}`))) failures.push(failure)
} finally {
  if (client) {
    for (const name of [...activeTurns.keys()].reverse()) {
      const began = performance.now()
      try {
        await endTurn(name)
        assertions.push({ name: `cleanup turn ${name}`, passed: true, durationMs: rounded(performance.now() - began) })
      } catch (cause) {
        const failure = errorMessage(cause)
        assertions.push({
          name: `cleanup turn ${name}`,
          passed: false,
          durationMs: rounded(performance.now() - began),
          failure,
        })
        failures.push(`cleanup ${name}: ${failure}`)
      }
    }
    client.close()
  }
  await server?.stop(true)

  if (preparation && productionBefore) {
    const began = performance.now()
    try {
      const after = await readFile(preparation.productionManifest.path)
      const passed =
        after.equals(productionBefore) && sha256(after) === preparation.productionManifest.sha256.toLowerCase()
      assertions.push({
        name: "production manifest is byte-for-byte unchanged after smoke",
        passed,
        durationMs: rounded(performance.now() - began),
        failure: passed ? undefined : "production manifest changed",
      })
      if (!passed) failures.push("production manifest changed")
    } catch (cause) {
      const failure = errorMessage(cause)
      assertions.push({
        name: "production manifest is byte-for-byte unchanged after smoke",
        passed: false,
        durationMs: 0,
        failure,
      })
      failures.push(failure)
    }
  }

  const report = {
    schemaVersion: 1,
    passed: failures.length === 0 && assertions.every((assertion) => assertion.passed),
    startedAt: startedAt.toISOString(),
    finishedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt.getTime(),
    assertions,
    failures,
    metadata,
  }
  if (reportPath) {
    try {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: "wx" })
      await chmod(reportPath, 0o600)
    } catch (cause) {
      report.passed = false
      failures.push("Could not persist a fresh report; each prepared run may be used only once")
      process.stderr.write(`chrome-bridge smoke: could not write report: ${errorMessage(cause)}\n`)
    }
  }
  process.stdout.write(`${JSON.stringify(report)}\n`)
  if (!report.passed) process.exitCode = 1
}

function turn(label: string) {
  const suffix = randomUUID()
  const value = { session_id: `phase1-${label}-${suffix}`, turn_id: `phase1-${label}-turn-${suffix}` }
  ;(metadata.turns as Record<string, unknown>)[label === "user-tab" ? "user" : label] = value
  return value
}

async function endTurn(name: string) {
  const value = activeTurns.get(name)
  if (!value || !client) return
  await client.call("turnEnded", value, 10_000)
  activeTurns.delete(name)
}

async function cdp<T = unknown>(
  scope: { session_id: string; turn_id: string },
  tabId: number | undefined,
  method: string,
  commandParams: unknown,
  timeoutMs = 10_000,
) {
  return client!.call<T>(
    "executeCdp",
    {
      ...scope,
      session_context: "live",
      target: tabId === undefined ? {} : { tabId },
      method,
      commandParams,
      timeoutMs,
    },
    timeoutMs + 1000,
  )
}

async function targets(scope: { session_id: string; turn_id: string }) {
  const value = await cdp<{ targetInfos: unknown[] }>(scope, undefined, "Target.getTargets", {})
  if (!isRecord(value) || !Array.isArray(value.targetInfos))
    throw new Error("Target.getTargets returned an unexpected shape")
  if (!value.targetInfos.every(isTargetInfo)) throw new Error("Target.getTargets included an invalid target")
  return value.targetInfos
}

async function evaluate<T>(scope: { session_id: string; turn_id: string }, tabId: number, expression: string) {
  const value = await cdp<RuntimeResult<T>>(scope, tabId, "Runtime.evaluate", {
    expression,
    returnByValue: true,
    awaitPromise: true,
  })
  if (value.exceptionDetails || value.result.type === "undefined" || !("value" in value.result)) {
    throw new Error(value.result.description ?? "Runtime.evaluate returned no value")
  }
  return value.result.value as T
}

async function check<T>(name: string, operation: () => T | Promise<T>): Promise<T> {
  const began = performance.now()
  try {
    const value = await operation()
    assertions.push({ name, passed: true, durationMs: rounded(performance.now() - began) })
    return value
  } catch (cause) {
    const failure = errorMessage(cause)
    assertions.push({ name, passed: false, durationMs: rounded(performance.now() - began), failure })
    failures.push(`${name}: ${failure}`)
    throw cause
  }
}

async function expectFailure(operation: () => Promise<unknown>) {
  try {
    await operation()
  } catch (cause) {
    if (!errorMessage(cause)) throw new Error("operation failed without an error message")
    return
  }
  throw new Error("operation unexpectedly succeeded")
}

async function waitFor(operation: () => Promise<boolean>, deadlineMs: number) {
  const deadline = performance.now() + deadlineMs
  while (performance.now() < deadline) {
    if (await operation()) return
    await Bun.sleep(100)
  }
  throw new Error(`condition was not reached within ${deadlineMs}ms`)
}

function tabArray(value: unknown): Tab[] {
  if (
    !Array.isArray(value) ||
    !value.every((tab) => isRecord(tab) && Number.isSafeInteger(tab.id) && (tab.id as number) > 0)
  ) {
    throw new Error("getUserTabs returned an unexpected shape")
  }
  return value as Tab[]
}

function isTargetInfo(value: unknown): value is TargetInfo {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.url === "string" &&
    typeof value.attached === "boolean" &&
    typeof value.type === "string" &&
    (value.tabId === undefined || Number.isSafeInteger(value.tabId))
  )
}

function decodePng(bytes: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature)) throw new Error("screenshot is not a PNG")
  let offset = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = -1
  let interlace = -1
  const idat: Buffer[] = []
  let ended = false
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > bytes.length) throw new Error("truncated PNG chunk")
    const type = bytes.toString("ascii", offset + 4, offset + 8)
    const data = bytes.subarray(offset + 8, offset + 8 + length)
    if (type === "IHDR") {
      if (length !== 13) throw new Error("invalid PNG IHDR")
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]!
      colorType = data[9]!
      interlace = data[12]!
    } else if (type === "IDAT") idat.push(data)
    else if (type === "IEND") {
      ended = true
      offset = end
      break
    }
    offset = end
  }
  if (!ended || offset !== bytes.length || idat.length === 0 || width < 1 || height < 1)
    throw new Error("incomplete PNG structure")
  if (bitDepth !== 8 || interlace !== 0 || ![0, 2, 4, 6].includes(colorType))
    throw new Error("unsupported PNG encoding")
  const channels = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[colorType]!
  const rowBytes = width * channels
  if (height * (rowBytes + 1) > 64 * 1024 * 1024) throw new Error("PNG exceeds the 64 MiB decoded image limit")
  const inflated = inflateSync(Buffer.concat(idat), { maxOutputLength: 64 * 1024 * 1024 })
  if (inflated.length !== height * (rowBytes + 1)) throw new Error("decoded PNG size mismatch")
  const previous = Buffer.alloc(rowBytes)
  const current = Buffer.alloc(rowBytes)
  const values = new Set<number>()
  for (let row = 0; row < height; row++) {
    const source = row * (rowBytes + 1)
    const filter = inflated[source]!
    if (filter > 4) throw new Error("invalid PNG row filter")
    for (let column = 0; column < rowBytes; column++) {
      const raw = inflated[source + 1 + column]!
      const left = column >= channels ? current[column - channels]! : 0
      const up = previous[column]!
      const upperLeft = column >= channels ? previous[column - channels]! : 0
      current[column] = (raw + pngPredictor(filter, left, up, upperLeft)) & 0xff
      values.add(current[column]!)
    }
    current.copy(previous)
  }
  return { width, height, distinctByteValues: values.size }
}

function pngPredictor(filter: number, left: number, up: number, upperLeft: number) {
  if (filter === 0) return 0
  if (filter === 1) return left
  if (filter === 2) return up
  if (filter === 3) return Math.floor((left + up) / 2)
  const estimate = left + up - upperLeft
  const leftDistance = Math.abs(estimate - left)
  const upDistance = Math.abs(estimate - up)
  const upperLeftDistance = Math.abs(estimate - upperLeft)
  return leftDistance <= upDistance && leftDistance <= upperLeftDistance
    ? left
    : upDistance <= upperLeftDistance
      ? up
      : upperLeft
}

function isPreparation(value: unknown): value is Preparation {
  if (!isRecord(value) || !isRecord(value.productionManifest) || !isRecord(value.extension) || !isRecord(value.browser))
    return false
  return (
    strings(value, ["runDir", "home", "config", "userData", "hostExecutable", "launcher"]) &&
    strings(value.productionManifest, ["path", "sha256"]) &&
    /^[a-fA-F0-9]{64}$/.test(String(value.productionManifest.sha256)) &&
    strings(value.extension, ["id", "version", "backgroundSha256", "manifestSha256", "path"]) &&
    /^[a-fA-F0-9]{64}$/.test(String(value.extension.backgroundSha256)) &&
    /^[a-fA-F0-9]{64}$/.test(String(value.extension.manifestSha256)) &&
    strings(value.browser, ["executable", "version"])
  )
}

function strings(value: Record<string, unknown>, keys: string[]) {
  return keys.every((key) => typeof value[key] === "string" && (value[key] as string).length > 0)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function inside(parent: string, child: string) {
  return resolve(child).startsWith(`${resolve(parent)}/`)
}

function splitNull(value: Buffer) {
  return value.toString("utf8").split("\0").filter(Boolean)
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}

function equal(actual: unknown, expected: unknown, message: string) {
  if (!Object.is(actual, expected)) throw new Error(`${message}: expected ${String(expected)}, got ${String(actual)}`)
}

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message)
  return value
}

function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}

function rounded(value: number) {
  return Math.round(value * 100) / 100
}

function parseRunDir(args: string[]) {
  if (args.length !== 2 || args[0] !== "--run-dir" || !args[1]) return undefined
  return args[1]
}
