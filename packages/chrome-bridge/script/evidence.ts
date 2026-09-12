import { createHash } from "node:crypto"
import { lstat, readFile, readdir, realpath } from "node:fs/promises"
import { homedir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { HOST_NAME } from "../src/client"

type RecordValue = Record<string, unknown>

export type TraceValidationInput = {
  runDir: string
  nativeManifest: string
  productionManifest: string
  productionHostTarget: string
  extensionPath: string
  browserExecutable: string
  browserPID: number
  hostLauncher: string
  hostExecutable: string
  hostPID: number
  originalHome: string
}

export type TraceValidation = {
  status: "verified" | "unverified"
  passed: boolean
  failures: string[]
  observed: {
    nativeManifestOpened: boolean
    browserExecutable: boolean
    hostLauncher: boolean
    hostExecutable: boolean
    browserExited: boolean
    hostExited: boolean
    successfulExecPaths: string[]
  }
}

export type Evidence = {
  liveProofPassed: boolean
  runs: RecordValue[]
  failures: string[]
  offline: string
  scope: string
}

const requiredAssertions = [
  "CLI has exactly --run-dir <path>",
  "preparation.json has the required shape",
  "preparation run directory matches --run-dir",
  "preparation paths are absolute",
  "prepared HOME, config, user data, and launcher are isolated under the run directory",
  "prepared extension ID is the expected unmodified extension",
  "extension assets still match the preparation hashes",
  "production manifest matches its prepared SHA-256",
  "connect to the explicitly prepared native host",
  "discovery executable is the prepared host executable",
  "host status identifies discovery processes",
  "browser command line has the exact isolated user-data argument",
  "host environment has isolated HOME and no CODEX_CLI_PATH",
  "ping returns pong",
  "getInfo reports the prepared extension ID",
  "getUserTabs returns a raw tab array",
  "inspect initial debugger targets",
  "claim unrelated startup about:blank user tab",
  "attach claimed user tab returns void",
  "claimed user tab is attached",
  "end claimed user-tab turn",
  "ended user turn preserves and detaches its tab",
  "createTab returns a numeric tab ID",
  "attach created tab returns void",
  "created tab debugger target is attached",
  "navigate created tab to the loopback fixture",
  "fixture readiness marker appears within 10 seconds",
  "bring the disposable fixture tab to the foreground",
  "fixture heading and original input value are correct",
  "focus and select the complete input value",
  "insert replacement text exactly once",
  "Input.insertText replaces rather than appends",
  "read button coordinates",
  "dispatch one coordinate mouse press and release",
  "one trusted coordinate click lands within the button",
  "capture, decode, and save a valid PNG screenshot",
  "65-second connection wait receives at least two heartbeats",
  "post-wait read succeeds",
  "unknown method fails without breaking the bridge",
  "invalid tab fails without acting on another tab",
  "ping succeeds after RPC errors",
  "normal turnEnded succeeds",
  "normal turnEnded removes the disposable tab and target",
  "all original user tabs remain",
  "no unexpected pre-existing target was lost",
  "create disposable tab for native restart",
  "native host shutdown rejects a pending controller call",
  "extension reconnects to a fresh native host",
  "native restart cleanup closes only its disposable tab",
  "production manifest is byte-for-byte unchanged after smoke",
] as const

export async function verifyEvidence(runDirs: string[]): Promise<Evidence> {
  const failures: string[] = []
  const runs: RecordValue[] = []
  if (runDirs.length !== 3)
    failures.push(`exactly three consecutive run directories are required; received ${runDirs.length}`)

  const resolved = runDirs.map((path) => resolve(path))
  if (new Set(resolved).size !== resolved.length) failures.push("run directories must be distinct")

  for (const [index, runDir] of resolved.entries()) {
    const runFailures: string[] = []
    const fail = (message: string) => runFailures.push(message)
    let preparation: RecordValue | undefined
    let report: RecordValue | undefined
    try {
      const actual = await realpath(runDir)
      if (actual !== runDir) fail("run directory must not be a symlink")
      if (
        !runDir.startsWith("/tmp/tandem/chrome-bridge/") ||
        runDir.slice("/tmp/tandem/chrome-bridge/".length).includes("/")
      ) {
        fail("run directory is not a direct child of /tmp/tandem/chrome-bridge")
      }
      preparation = jsonRecord(await readFile(join(runDir, "preparation.json"), "utf8"), "preparation.json")
      report = jsonRecord(await readFile(join(runDir, "smoke-report.json"), "utf8"), "smoke-report.json")
    } catch (cause) {
      fail(errorMessage(cause))
    }

    let browserPID: number | undefined
    let hostPID: number | undefined
    let startedAt: string | undefined
    let finishedAt: string | undefined
    let sessions: string[] = []
    let turns: string[] = []
    let trace: TraceValidation | undefined
    let screenshot: RecordValue | undefined

    if (preparation && report) {
      if (preparation.passed !== true) fail("preparation.json passed is not true")
      if (report.passed !== true) fail("smoke-report.json passed is not true")
      if (resolveString(preparation.runDir) !== runDir) fail("preparation runDir does not match its directory")
      startedAt = validDate(report.startedAt, "report startedAt", fail)
      finishedAt = validDate(report.finishedAt, "report finishedAt", fail)
      const preparedAt = validDate(preparation.createdAt, "preparation createdAt", fail)
      if (startedAt && finishedAt && Date.parse(finishedAt) < Date.parse(startedAt))
        fail("report finished before it started")
      if (preparedAt && startedAt && Date.parse(startedAt) < Date.parse(preparedAt))
        fail("smoke report started before preparation")

      const assertions = array(report.assertions)
      for (const name of requiredAssertions) {
        const assertion = assertions.find((value) => record(value)?.name === name)
        if (!assertion || record(assertion)?.passed !== true) fail(`required assertion did not pass: ${name}`)
      }

      const metadata = record(report.metadata)
      if (!record(metadata?.preparation) || JSON.stringify(metadata!.preparation) !== JSON.stringify(preparation)) {
        fail("smoke report preparation metadata does not match preparation.json")
      }
      const discovery = record(metadata?.discovery)
      browserPID = positiveInteger(discovery?.parentPid)
      hostPID = positiveInteger(discovery?.pid)
      if (!browserPID) fail("metadata.discovery.parentPid is missing or invalid")
      if (!hostPID) fail("metadata.discovery.pid is missing or invalid")

      const heartbeat = record(metadata?.heartbeat)
      if (!numberAtLeast(heartbeat?.delta, 2) || !numberAtLeast(heartbeat?.waitMs, 65_000)) {
        fail("heartbeat proof requires delta >= 2 and waitMs >= 65000")
      }
      for (const point of ["before", "after"]) {
        const status = record(heartbeat?.[point])
        if (status?.pid !== hostPID || status?.parentPid !== browserPID)
          fail(`heartbeat ${point} process provenance does not match discovery`)
      }

      const tabIDs = record(metadata?.tabIDs)
      const original = integerArray(tabIDs?.original)
      const final = integerArray(tabIDs?.final)
      const claimed = positiveInteger(tabIDs?.claimedUser)
      const disposable = positiveInteger(tabIDs?.created)
      if (!original || original.length === 0 || !final) fail("original and final tab ID arrays are required")
      if (!claimed) fail("claimed user tab ID must be non-null")
      if (!disposable) fail("disposable tab ID must be non-null")
      if (original && final && original.some((id) => !final.includes(id)))
        fail("an original user tab is absent from final tabs")
      if (claimed && final && !final.includes(claimed)) fail("claimed user tab is absent from final tabs")
      if (disposable && final?.includes(disposable)) fail("disposable tab remains in final tabs")

      const turnMetadata = record(metadata?.turns)
      for (const name of ["core", "user", "inspector"]) {
        const value = record(turnMetadata?.[name])
        const session = nonemptyString(value?.session_id)
        const turn = nonemptyString(value?.turn_id)
        if (!session || !turn) fail(`metadata.turns.${name} must contain session_id and turn_id`)
        else {
          sessions.push(session)
          turns.push(turn)
        }
      }
      if (new Set(sessions).size !== sessions.length || new Set(turns).size !== turns.length)
        fail("session and turn IDs must be distinct within the run")

      const production = record(preparation.productionManifest)
      const extension = record(preparation.extension)
      const browser = record(preparation.browser)
      const expectedProduction = resolve(
        process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"),
        "chromium",
        "NativeMessagingHosts",
        `${HOST_NAME}.json`,
      )
      const productionPath = nonemptyString(production?.path)
      const nativeManifest = nonemptyString(preparation.nativeManifest)
      const extensionPath = nonemptyString(extension?.path)
      const browserExecutable = nonemptyString(browser?.executable)
      const hostLauncher = nonemptyString(preparation.hostLauncher)
      const hostExecutable = nonemptyString(preparation.hostExecutable)
      const tracePath = nonemptyString(preparation.trace)
      if (!productionPath || resolve(productionPath) !== expectedProduction)
        fail("production manifest path is not the current Chromium native registry path")
      for (const [name, path] of [
        ["native manifest", nativeManifest],
        ["extension", extensionPath],
        ["host launcher", hostLauncher],
        ["host executable", hostExecutable],
        ["trace", tracePath],
      ] as const) {
        if (!path || !inside(runDir, path)) fail(`${name} path is not inside the run directory`)
      }
      if (discovery?.executable !== hostExecutable) fail("discovery executable does not match preparation")

      if (productionPath) {
        try {
          if ((await realpath(productionPath)) !== (await realpath(expectedProduction)))
            fail("production manifest real path mismatch")
          const bytes = await readFile(productionPath)
          if (sha256(bytes) !== lowerHash(production?.sha256))
            fail("current production manifest bytes do not match the recorded hash")
          const manifest = jsonRecord(bytes.toString("utf8"), "production manifest")
          if (manifest.path !== production?.hostTarget)
            fail("current production host target does not match preparation")
        } catch (cause) {
          fail(`production manifest: ${errorMessage(cause)}`)
        }
      }

      if (extensionPath) {
        try {
          const manifest = await readFile(join(extensionPath, "manifest.json"))
          const background = await readFile(join(extensionPath, "background.js"))
          if (sha256(manifest) !== lowerHash(extension?.manifestSha256))
            fail("prepared extension manifest hash mismatch")
          if (sha256(background) !== lowerHash(extension?.backgroundSha256))
            fail("prepared extension background hash mismatch")
        } catch (cause) {
          fail(`prepared extension assets: ${errorMessage(cause)}`)
        }
      } else fail("prepared extension path is missing")

      const screenshots = array(metadata?.screenshots)
      const image = screenshots.length === 1 ? record(screenshots[0]) : undefined
      if (!image) fail("exactly one screenshot record is required")
      else {
        const path = nonemptyString(image.path)
        if (path !== join(runDir, "screenshot.png") || image.mime !== "image/png" || image.decoded !== true) {
          fail("screenshot record must identify the decoded run screenshot PNG")
        } else {
          try {
            const info = await lstat(path)
            const bytes = await readFile(path)
            const png = pngInfo(bytes)
            if (!info.isFile() || info.isSymbolicLink() || (info.mode & 0o777) !== 0o600)
              fail("screenshot must be a regular mode-0600 file")
            if (info.uid !== process.getuid!()) fail("screenshot is not owned by the current user")
            if (image.width !== png.width || image.height !== png.height || image.bytes !== bytes.length)
              fail("screenshot file does not match reported dimensions or byte count")
            screenshot = {
              path,
              sha256: sha256(bytes),
              width: png.width,
              height: png.height,
              bytes: bytes.length,
              decoded: true,
              mode: "0600",
            }
          } catch (cause) {
            fail(`screenshot: ${errorMessage(cause)}`)
          }
        }
      }

      if (!tracePath || tracePath !== join(runDir, "process-trace.log"))
        fail("preparation.trace must be the process trace inside the run directory")
      if (
        tracePath &&
        productionPath &&
        nativeManifest &&
        extensionPath &&
        browserExecutable &&
        hostLauncher &&
        hostExecutable &&
        browserPID &&
        hostPID &&
        nonemptyString(production?.hostTarget)
      ) {
        try {
          const info = await lstat(tracePath)
          if (!info.isFile() || info.isSymbolicLink()) throw new Error("trace is not a regular file")
          trace = validateProcessTrace(await readFile(tracePath, "utf8"), {
            runDir,
            nativeManifest,
            productionManifest: productionPath,
            productionHostTarget: String(production!.hostTarget),
            extensionPath,
            browserExecutable,
            browserPID,
            hostLauncher,
            hostExecutable,
            hostPID,
            originalHome: homedir(),
          })
          runFailures.push(...trace.failures.map((failure) => `trace: ${failure}`))
        } catch (cause) {
          fail(`trace: ${errorMessage(cause)}`)
        }
      } else fail("trace provenance fields are incomplete")

      try {
        const artifacts = (await readdir(runDir)).filter((name) => /^host-.*\.json$/.test(name) || /\.sock$/.test(name))
        if (artifacts.length) fail(`native host cleanup artifacts remain: ${artifacts.join(", ")}`)
      } catch (cause) {
        fail(`cleanup artifacts: ${errorMessage(cause)}`)
      }
      if (
        browserPID &&
        (await processHasArgument(browserPID, `--user-data-dir=${nonemptyString(preparation.userData) ?? ""}`))
      )
        fail("recorded browser process is still using the run profile")
      if (
        nonemptyString(preparation.userData) &&
        (await anyProcessHasArgument(`--user-data-dir=${preparation.userData}`))
      )
        fail("a live process is still using the run profile")
    }

    failures.push(...runFailures.map((failure) => `run ${index + 1} (${runDir}): ${failure}`))
    runs.push({
      runDir,
      passed: runFailures.length === 0,
      startedAt,
      finishedAt,
      browserPID,
      hostPID,
      sessions,
      turns,
      screenshot,
      trace,
    })
  }

  const typedRuns = runs as Array<
    RecordValue & {
      startedAt?: string
      finishedAt?: string
      browserPID?: number
      hostPID?: number
      sessions?: string[]
      turns?: string[]
    }
  >
  for (let index = 1; index < typedRuns.length; index++) {
    const previous = typedRuns[index - 1]!
    const current = typedRuns[index]!
    if (previous.finishedAt && current.startedAt && Date.parse(current.startedAt) < Date.parse(previous.finishedAt)) {
      failures.push(`runs ${index} and ${index + 1} overlap or are not supplied in consecutive chronological order`)
    }
  }
  uniqueAcrossRuns(
    typedRuns.map((run) => run.browserPID),
    "browser PIDs",
    failures,
  )
  uniqueAcrossRuns(
    typedRuns.map((run) => run.hostPID),
    "host PIDs",
    failures,
  )
  uniqueAcrossRuns(
    typedRuns.flatMap((run) => run.sessions ?? []),
    "session IDs",
    failures,
  )
  uniqueAcrossRuns(
    typedRuns.flatMap((run) => run.turns ?? []),
    "turn IDs",
    failures,
  )
  const allPIDs = typedRuns
    .flatMap((run) => [run.browserPID, run.hostPID])
    .filter((value): value is number => value !== undefined)
  if (new Set(allPIDs).size !== allPIDs.length)
    failures.push("browser and host process IDs must be unique across all runs")

  return {
    liveProofPassed: failures.length === 0 && runs.length === 3,
    runs,
    failures,
    offline:
      "unverified; offline execution is optional Phase 1 evidence and is not established by background-networking flags",
    scope: "not permission/model integration; unit checks separate",
  }
}

export function validateProcessTrace(source: string, input: TraceValidationInput): TraceValidation {
  const failures: string[] = []
  const events = traceEvents(source)
  const successfulExec = events.filter(
    (event) => (event.syscall === "execve" || event.syscall === "execveat") && event.result === 0,
  )
  const execPaths = successfulExec.map((event) => event.path).filter((path): path is string => path !== undefined)
  const allowed = new Set([
    resolve(input.browserExecutable),
    resolve(dirname(input.browserExecutable), "chrome_crashpad_handler"),
    "/proc/self/exe",
    "/usr/bin/env",
    resolve(input.hostLauncher),
    resolve(input.hostExecutable),
    "/bin/sh",
  ])
  for (const event of successfulExec) {
    if (!event.path) failures.push(`could not establish path for successful ${event.syscall}`)
    else if (!allowed.has(resolveTracePath(event.path)))
      failures.push(`unapproved successful executable: ${event.path}`)
  }

  const browserEvent = successfulExec.find(
    (event) => event.path && resolveTracePath(event.path) === resolve(input.browserExecutable),
  )
  const launcherEvent = successfulExec.find(
    (event) => event.path && resolveTracePath(event.path) === resolve(input.hostLauncher),
  )
  const hostEvent = successfulExec.find(
    (event) => event.path && resolveTracePath(event.path) === resolve(input.hostExecutable),
  )
  if (!browserEvent) failures.push("browser executable was not observed successfully executing")
  else if (browserEvent.pid !== input.browserPID)
    failures.push("browser executable PID does not match smoke provenance")
  if (!launcherEvent) failures.push("prepared native host launcher was not observed successfully executing")
  else if (launcherEvent.pid !== input.hostPID) failures.push("host launcher PID does not match smoke provenance")
  if (!hostEvent) failures.push("prepared host executable was not observed successfully executing")
  else if (hostEvent.pid !== input.hostPID) failures.push("host executable PID does not match smoke provenance")

  const nativeOpen = events.some(
    (event) =>
      ["open", "openat", "openat2"].includes(event.syscall) &&
      event.result !== undefined &&
      event.result >= 0 &&
      event.path &&
      resolveTracePath(event.path) === resolve(input.nativeManifest),
  )
  if (!nativeOpen) failures.push("a successful open of the exact isolated native manifest was not established")

  const forbiddenDirectories = [
    resolve(input.originalHome, ".codex"),
    resolve(input.originalHome, "code", "codex"),
    resolve(input.originalHome, ".local", "share", "chrome-standalone"),
  ]
  for (const event of events) {
    for (const tracedPath of event.paths) {
      const path = resolveTracePath(tracedPath)
      const inExtension = inside(input.extensionPath, path)
      const forbidden =
        path === resolve(input.productionHostTarget) ||
        forbiddenDirectories.some((directory) => path === directory || inside(directory, path)) ||
        (!inExtension &&
          ["node_repl", "browser-client.mjs", "browser-service.mjs"].includes(path.split("/").at(-1) ?? ""))
      if (forbidden) failures.push(`attempted access to an original runtime/config path: ${tracedPath}`)
      if (
        ["open", "openat", "openat2"].includes(event.syscall) &&
        event.result !== undefined &&
        event.result >= 0 &&
        path === resolve(input.productionManifest)
      ) {
        failures.push("production native registry manifest was opened successfully")
      }
    }
  }

  const exited = new Set<number>()
  for (const line of source.split("\n")) {
    const match = line.match(/^\s*(?:\[pid\s+)?(\d+)\]?\s+\+\+\+\s+(?:exited with|killed by)/)
    if (match) exited.add(Number(match[1]))
  }
  if (!exited.has(input.browserPID)) failures.push("recorded browser PID has no exit in the trace")
  if (!exited.has(input.hostPID)) failures.push("recorded host PID has no exit in the trace")

  return {
    status: failures.length ? "unverified" : "verified",
    passed: failures.length === 0,
    failures: [...new Set(failures)],
    observed: {
      nativeManifestOpened: nativeOpen,
      browserExecutable: Boolean(browserEvent),
      hostLauncher: Boolean(launcherEvent),
      hostExecutable: Boolean(hostEvent),
      browserExited: exited.has(input.browserPID),
      hostExited: exited.has(input.hostPID),
      successfulExecPaths: [...new Set(execPaths)],
    },
  }
}

type TraceEvent = { pid?: number; syscall: string; path?: string; paths: string[]; result?: number }

function traceEvents(source: string) {
  const events: TraceEvent[] = []
  const unfinished = new Map<string, { syscall: string; path?: string; paths: string[] }>()
  for (const line of source.split("\n")) {
    const prefix = line.match(/^\s*(?:\[pid\s+)?(\d+)\]?\s+(.*)$/)
    if (!prefix) continue
    const pid = Number(prefix[1])
    const body = prefix[2]!
    const resumed = body.match(/^<\.\.\.\s+(\w+) resumed>(.*)$/)
    if (resumed) {
      const key = `${pid}:${resumed[1]}`
      const prior = unfinished.get(key)
      unfinished.delete(key)
      events.push({
        pid,
        syscall: resumed[1]!,
        path: prior?.path,
        paths: prior?.paths ?? [],
        result: traceResult(resumed[2]!),
      })
      continue
    }
    const call = body.match(/^(\w+)\((.*)$/)
    if (!call) continue
    const paths = quotedPaths(call[2]!)
    const event = {
      pid,
      syscall: call[1]!,
      path: paths[0],
      paths: call[1]!.startsWith("exec") ? paths.slice(0, 1) : paths,
      result: traceResult(body),
    }
    if (body.includes("<unfinished ...>")) unfinished.set(`${pid}:${event.syscall}`, event)
    else events.push(event)
  }
  return events
}

function quotedPaths(args: string) {
  return [...args.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((match) =>
    match[1]!
      .replace(/\\([\\"])/g, "$1")
      .replace(/\\x([0-9a-fA-F]{2})/g, (_, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)))
      .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8))),
  )
}

function traceResult(value: string) {
  const match = value.match(/=\s*(-?\d+)(?:\s|$)/)
  return match ? Number(match[1]) : undefined
}

function resolveTracePath(path: string) {
  return path.startsWith("/") ? resolve(path) : path
}
function inside(parent: string, child: string) {
  return resolve(child).startsWith(`${resolve(parent)}/`)
}
function record(value: unknown): RecordValue | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as RecordValue) : undefined
}
function array(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}
function nonemptyString(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : undefined
}
function resolveString(value: unknown) {
  const text = nonemptyString(value)
  return text ? resolve(text) : undefined
}
function positiveInteger(value: unknown) {
  return Number.isSafeInteger(value) && Number(value) > 0 ? Number(value) : undefined
}
function integerArray(value: unknown) {
  return Array.isArray(value) && value.every((item) => Number.isSafeInteger(item) && item > 0)
    ? (value as number[])
    : undefined
}
function numberAtLeast(value: unknown, minimum: number) {
  return typeof value === "number" && Number.isFinite(value) && value >= minimum
}
function lowerHash(value: unknown) {
  return typeof value === "string" ? value.toLowerCase() : ""
}
function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex")
}
function errorMessage(cause: unknown) {
  return cause instanceof Error ? cause.message : String(cause)
}
function jsonRecord(source: string, name: string) {
  const value: unknown = JSON.parse(source)
  const result = record(value)
  if (!result) throw new Error(`${name} is not a JSON object`)
  return result
}
function validDate(value: unknown, name: string, fail: (message: string) => void) {
  const text = nonemptyString(value)
  if (!text || !Number.isFinite(Date.parse(text))) {
    fail(`${name} is invalid`)
    return undefined
  }
  return text
}
function uniqueAcrossRuns(values: Array<string | number | undefined>, name: string, failures: string[]) {
  const present = values.filter((value): value is string | number => value !== undefined)
  if (present.length && new Set(present).size !== present.length) failures.push(`${name} must be unique across runs`)
}

function pngInfo(bytes: Buffer) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  if (bytes.length < 33 || !bytes.subarray(0, 8).equals(signature) || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("file is not a PNG")
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width < 1 || height < 1 || bytes.toString("ascii", bytes.length - 8, bytes.length - 4) !== "IEND")
    throw new Error("PNG is incomplete")
  return { width, height }
}

async function processHasArgument(pid: number, argument: string) {
  try {
    return (await readFile(`/proc/${pid}/cmdline`)).toString("utf8").split("\0").includes(argument)
  } catch {
    return false
  }
}

async function anyProcessHasArgument(argument: string) {
  for (const name of await readdir("/proc"))
    if (/^\d+$/.test(name) && (await processHasArgument(Number(name), argument))) return true
  return false
}

if (import.meta.main) {
  const evidence = await verifyEvidence(process.argv.slice(2).filter((argument) => argument !== "--"))
  process.stdout.write(`${JSON.stringify(evidence, null, 2)}\n`)
  if (!evidence.liveProofPassed) process.exitCode = 1
}
