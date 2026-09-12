import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { sessionFixture } from "./session-fixture"
import { Database } from "bun:sqlite"

// Real CLI children only: no imported disposal, replacement runtime, or synthetic extension.
const root = fileURLToPath(new URL("../../..", import.meta.url))
const runtime = process.argv[2]
const mode = process.argv[3]
const signal = process.argv[4]
assert(runtime === "legacy" || runtime === "v2")
assert(mode === "work" || mode === "permission" || mode === "keep" || mode === "uncertain")
assert(signal === "SIGTERM" || signal === "SIGINT")
const directory = resolve(process.argv[5] ?? "")
assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
process.umask(0o077)
process.env.TANDEM_PHASE3_RUN_DIR = directory
const preparation = JSON.parse(await readFile(join(directory, "preparation.json"), "utf8"))
assert.equal(preparation.runDir, directory)
await readFile(join(directory, "native-tap-preparation.json"))
const fixture = await sessionFixture(runtime)
assert(preparation.observer?.path.startsWith(directory + "/"))
await writeFile(
  join(preparation.observer.path, "background.js"),
  await readFile(new URL("./shutdown-observer.js", import.meta.url)),
)
await writeFile(
  join(preparation.observer.path, "manifest.json"),
  JSON.stringify({
    manifest_version: 3,
    name: "Tandem Shutdown Observer",
    version: "1.0",
    permissions: ["tabs", "debugger"],
    host_permissions: ["http://127.0.0.1/*"],
    background: { service_worker: "background.js" },
  }),
)
let observe = false
let observed: { at: number; targetInfos: { url: string; attached: boolean; type: string }[] } | undefined
const observationServer = Bun.serve({
  hostname: "127.0.0.1",
  port: preparation.observer.port,
  async fetch(request) {
    if (new URL(request.url).searchParams.get("token") !== preparation.observer.token)
      return new Response(null, { status: 403 })
    if (!observe) return new Response(null, { status: 409 })
    if (request.method === "POST") observed = JSON.parse(await request.text())
    return new Response("ok")
  },
})
const records = async () =>
  (await readFile(join(directory, "native-dispatch.jsonl"), "utf8").catch(() => ""))
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line))
async function wait(check: () => boolean | Promise<boolean>, label: string, timeout = 30000) {
  const until = Date.now() + timeout
  while (!(await check())) {
    assert(Date.now() < until, label)
    await Bun.sleep(30)
  }
}
const browser = Bun.spawn([preparation.launcher], {
  stdout: Bun.file(join(directory, "shutdown-browser.log")),
  stderr: Bun.file(join(directory, "shutdown-browser-error.log")),
})
let server: ReturnType<typeof Bun.spawn> | undefined
let release: (() => void) | undefined
const gate = new Promise<void>((resolve) => {
  release = resolve
})
let providerReady = false
let providerTurns = 0
let tab: string | undefined
let endpoint = ""
let sessionID = ""
let pendingID: string | undefined
const providerResults: unknown[] = []
fixture.setScenario(async (body) => {
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      try {
        const parsed = JSON.parse(value)
        if (parsed?.action && parsed?.outcome) {
          providerResults.push(parsed)
          if (typeof parsed.tab === "string") tab = parsed.tab
        }
      } catch {
        /* Ordinary prompt text. */
      }
    } else if (value && typeof value === "object") Object.values(value).forEach(visit)
  }
  visit(body)
  providerTurns++
  if (providerTurns === 2 && mode === "uncertain")
    await writeFile(join(directory, "native-fault.json"), JSON.stringify({ cdp: "Runtime.callFunctionOn" }))
  const input =
    providerTurns === 1
      ? { action: "create", browser: "fixture", url: fixture.pageURL }
      : providerTurns === 2 && mode === "keep"
        ? { action: "keep", browser: "fixture", tab, disposition: "deliverable" }
        : providerTurns === 2 && (mode === "permission" || mode === "uncertain")
          ? { action: "inspect", browser: "fixture", tab }
          : undefined
  if (!input) {
    providerReady = true
    await gate
  }
  const delta = input
    ? {
        tool_calls: [
          {
            index: 0,
            id: `shutdown-${providerTurns}`,
            type: "function",
            function: {
              name: "browser",
              arguments: JSON.stringify(input),
            },
          },
        ],
      }
    : { content: "No more actions." }
  return new Response(
    [delta, {}]
      .map(
        (delta, index) =>
          `data: ${JSON.stringify({
            id: "shutdown",
            object: "chat.completion.chunk",
            created: 1,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason: index ? (input ? "tool_calls" : "stop") : null }],
          })}\n\n`,
      )
      .join("") + "data: [DONE]\n\n",
    { headers: { "content-type": "text/event-stream" } },
  )
})
try {
  await wait(async () => (await readdir(directory)).some((file) => /^host-.*\.json$/.test(file)), "native host absent")
  const permission =
    mode === "permission"
      ? {
          browser: {
            "*": "ask",
            "66697874757265:637265617465:*": "allow",
            "66697874757265:6e617669676174696f6e:*": "allow",
          },
        }
      : { browser: "allow" }
  const config = {
    model: "fixture/fixture",
    small_model: "fixture/fixture",
    permission,
    provider: {
      fixture: {
        name: "Shutdown fixture",
        env: [],
        npm: "@ai-sdk/openai-compatible",
        options: { baseURL: fixture.url, apiKey: "fixture-not-a-credential" },
        models: {
          fixture: {
            id: "fixture",
            name: "Fixture",
            tool_call: true,
            limit: { context: 100000, output: 10000 },
            modalities: { input: ["text"], output: ["text"] },
          },
        },
      },
    },
  }
  const v2Config = {
    model: "fixture/fixture",
    snapshots: false,
    permissions:
      mode === "permission"
        ? [
            { action: "browser", resource: "*", effect: "ask" },
            { action: "browser", resource: "66697874757265:637265617465:*", effect: "allow" },
            { action: "browser", resource: "66697874757265:6e617669676174696f6e:*", effect: "allow" },
          ]
        : [{ action: "browser", resource: "*", effect: "allow" }],
    providers: {
      fixture: {
        name: "Fixture",
        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: fixture.url },
        request: { body: { apiKey: "fixture-not-a-credential" } },
        models: {
          fixture: {
            api: { id: "fixture" },
            capabilities: { tools: true, input: ["text"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  }
  await writeFile(join(fixture.artifacts, "opencode.json"), JSON.stringify(runtime === "legacy" ? config : v2Config))
  const home = join(directory, "server-home")
  await mkdir(home, { mode: 0o700 })
  const reservation = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() })
  const port = reservation.port
  assert(port && port !== 4097)
  await reservation.stop(true)
  endpoint = `http://127.0.0.1:${port}`
  const entrypoint = join(root, runtime === "legacy" ? "packages/opencode/src/index.ts" : "packages/cli/src/index.ts")
  server = Bun.spawn(
    [process.execPath, "--conditions=browser", entrypoint, "serve", "--hostname", "127.0.0.1", "--port", String(port)],
    {
      cwd: fixture.artifacts,
      env: {
        PATH: process.env.PATH,
        HOME: home,
        TMPDIR: join(directory, "tmp"),
        LANG: "C.UTF-8",
        XDG_DATA_HOME: join(home, "data"),
        XDG_CONFIG_HOME: join(home, "config"),
        XDG_CACHE_HOME: join(home, "cache"),
        XDG_STATE_HOME: join(home, "state"),
        TANDEM_PROMPT_CORRECTOR: "false",
        OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
        OPENCODE_DISABLE_MODELS_FETCH: "true",
        TANDEM_CHROME_CONNECTIONS: JSON.stringify(fixture.connections),
      },
      stdout: Bun.file(join(directory, "shutdown-server.log")),
      stderr: Bun.file(join(directory, "shutdown-server-error.log")),
    },
  )
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-opencode-directory": fixture.artifacts,
  }
  if (runtime === "v2") {
    const passwordPath = join(home, "state/tandem/password")
    await wait(async () => !!(await readFile(passwordPath, "utf8").catch(() => "")), "daemon password absent")
    headers.authorization = `Basic ${Buffer.from(`opencode:${await readFile(passwordPath, "utf8")}`).toString("base64")}`
  }
  async function request(path: string, body?: unknown) {
    const response = await fetch(endpoint + path, {
      headers,
      method: body === undefined ? "GET" : "POST",
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    assert(response.ok, `${path}: ${response.status} ${await response.clone().text()}`)
    return response.status === 204 ? undefined : JSON.parse(await response.text())
  }
  const health = runtime === "legacy" ? "/global/health" : "/api/health"
  await wait(
    async () =>
      fetch(endpoint + health, { headers, signal: AbortSignal.timeout(2000) }).then(
        (r) => r.ok,
        () => false,
      ),
    "server never listened",
  )
  const created = await request(
    runtime === "legacy" ? "/session" : "/api/session",
    runtime === "legacy"
      ? {}
      : {
          location: { directory: fixture.artifacts },
          model: { providerID: "fixture", id: "fixture" },
        },
  )
  sessionID = runtime === "legacy" ? created.id : created.data.id
  await request(
    runtime === "legacy" ? `/session/${sessionID}/prompt_async` : `/api/session/${sessionID}/prompt`,
    runtime === "legacy"
      ? {
          model: { providerID: "fixture", modelID: "fixture" },
          parts: [{ type: "text", text: "Run the bounded browser shutdown fixture." }],
        }
      : { prompt: { text: "Run the bounded browser shutdown fixture." } },
  )
  if (mode === "permission") {
    await wait(async () => {
      const result = await request(runtime === "legacy" ? "/permission" : `/api/session/${sessionID}/permission`)
      const pending = runtime === "legacy" ? result : result.data
      pendingID = pending.find(
        (item: { metadata?: { capability?: string }; id: string }) => item.metadata?.capability === "read",
      )?.id
      return !!pendingID
    }, "read approval did not become pending")
  } else if (mode === "uncertain") {
    await wait(
      async () => !!(await readFile(join(directory, "native-fault-dropped.json"), "utf8").catch(() => "")),
      "native response was not dropped",
    )
  } else await wait(() => providerReady, "provider never reached held continuation")
  const before = await records()
  assert.equal(before.filter((row) => row.method === "createTab").length, 1)
  const argv = await readFile(`/proc/${server.pid}/cmdline`, "utf8")
  assert(argv.includes(entrypoint) && argv.includes(String(port)) && !argv.includes("4097"))
  const browserArgv = await readFile(`/proc/${browser.pid}/cmdline`, "utf8")
  assert(browserArgv.includes(preparation.userData) || browserArgv.includes(directory), "browser profile guard")
  const started = Date.now()
  server.kill(signal)
  await wait(
    async () =>
      fetch(endpoint + health, { headers, signal: AbortSignal.timeout(500) }).then(
        () => false,
        () => true,
      ),
    "endpoint stayed live",
  )
  const endpointStoppedMs = Date.now() - started
  await wait(() => server?.exitCode !== null, "server failed to await/finish shutdown", 70000)
  const exitedMs = Date.now() - started
  assert.equal(server.exitCode, runtime === "legacy" ? 0 : 130, "expected CLI signal exit after finalization")
  assert.equal(browser.exitCode, null, "browser must outlive server for independent inspection")
  const atExit = await records()
  release?.()
  await Bun.sleep(750) // Deliberately observe absence of late dispatch after releasing the provider.
  assert.equal((await records()).length, atExit.length, "late native action after server exit")
  // A lost native response intentionally fences controller reconnection; independent
  // read-only extension observation still measures the real browser, without adopting it.
  observe = true
  await wait(() => !!observed, "post-exit browser observation missing")
  assert(observed)
  const targets = observed
  const owned = targets.targetInfos.filter((target) => target.url === fixture.pageURL)
  if (mode !== "uncertain") {
    assert.equal(owned.length, mode === "keep" ? 1 : 0, "disposable/retained tab disposition")
    assert(
      targets.targetInfos.every((target) => !target.attached),
      "debugger left attached",
    )
    assert.equal(atExit.filter((row) => row.method === "turnEnded" || row.method === "finalizeTabs").length, 1)
  } else {
    assert.equal(owned.length, 1, "uncertain tab must not be destroyed speculatively")
    assert.equal(atExit.filter((row) => row.method === "turnEnded" || row.method === "finalizeTabs").length, 0)
    assert(exitedMs >= 25000, "process exited before the bounded settlement finalizer")
  }
  const db = new Database(join(home, "data/tandem/opencode-local.db"), { readonly: true })
  const transcript = db
    .query<{ data: string }, [string]>(
      `select data from ${runtime === "legacy" ? "part" : "session_message"} where session_id = ?`,
    )
    .all(sessionID)
    .map((row) => JSON.parse(row.data))
  db.close()
  const text = JSON.stringify(transcript)
  assert(
    text.includes(mode === "uncertain" ? "cleanup_unconfirmed" : "Browser cleanup: confirmed"),
    "cleanup must be persisted before exit",
  )
  if (mode === "permission") {
    assert(text.includes("cancelled") && text.includes("not_dispatched"), "approval wait not cancelled before exit")
    const replyPath =
      runtime === "legacy" ? `/permission/${pendingID}/reply` : `/api/session/${sessionID}/permission/${pendingID}`
    const late = await fetch(endpoint + replyPath, {
      headers,
      method: "POST",
      body: JSON.stringify({ reply: "once" }),
      signal: AbortSignal.timeout(1000),
    }).then(
      () => true,
      () => false,
    )
    assert.equal(late, false, "late approval accepted by stopped process")
  }
  await writeFile(join(directory, "shutdown-transcript.json"), JSON.stringify(transcript, null, 2))
  const report = {
    runtime,
    mode,
    signal,
    passed: true,
    serverPID: server.pid,
    browserPID: browser.pid,
    sessionID,
    pendingID,
    endpointStoppedMs,
    exitedMs,
    exitCode: server.exitCode,
    targets,
    counts: Object.fromEntries(
      [...new Set(atExit.map((row) => row.cdp ?? row.method))].map((method) => [
        method,
        atExit.filter((row) => (row.cdp ?? row.method) === method).length,
      ]),
    ),
    providerTurns,
    providerResults,
    browserAliveAfterExit: true,
    noLateAction: true,
    productionManifestUnchanged:
      createHash("sha256")
        .update(await readFile(preparation.productionManifest.path))
        .digest("hex") === preparation.productionManifest.sha256,
  }
  assert(report.productionManifestUnchanged)
  await writeFile(join(directory, "shutdown-report.json"), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report))
} finally {
  release?.()
  if (server?.exitCode === null) {
    server.kill("SIGTERM")
    await Promise.race([server.exited, Bun.sleep(70000)])
    if (server.exitCode === null) server.kill("SIGKILL")
    await server.exited
  }
  browser.kill("SIGTERM")
  await Promise.race([browser.exited, Bun.sleep(5000)])
  if (browser.exitCode === null) browser.kill("SIGKILL")
  await browser.exited
  fixture.close()
  await observationServer.stop(true)
  const native = JSON.parse(await readFile(join(directory, "native-processes.json"), "utf8"))
  for (const pid of [native.tapPid, native.hostPid]) {
    await wait(
      async () => {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "")
        return !stat || stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")
      },
      `owned native process ${pid} did not exit`,
      5000,
    )
  }
  const unchanged =
    createHash("sha256")
      .update(await readFile(preparation.productionManifest.path))
      .digest("hex") === preparation.productionManifest.sha256
  await writeFile(
    join(directory, "shutdown-processes.json"),
    JSON.stringify({
      serverPID: server?.pid,
      browserPID: browser.pid,
      native,
      serverExited: server?.exitCode !== null,
      browserExited: true,
      nativeExited: true,
      productionManifestUnchanged: unchanged,
    }),
  )
  assert(unchanged)
}
