import assert from "node:assert/strict"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { sessionFixture } from "./session-fixture"
import { connect } from "../src/client"

process.umask(0o077)

const directory = resolve(process.argv[2] ?? "")
const binary = resolve(process.argv[3] ?? "")
assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
const reusePath = process.env.TANDEM_PHASE4_REUSE_CONNECTION
if (reusePath) assert(resolve(reusePath).startsWith("/tmp/tandem/chrome-bridge/"))
const reuse = reusePath ? JSON.parse(await readFile(reusePath, "utf8")) : undefined
const preparation = JSON.parse(await readFile(join(directory, "preparation.json"), "utf8"))
assert(preparation.ipcDirectory !== directory)
process.env.TANDEM_PHASE3_RUN_DIR = directory
const fixture = await sessionFixture("v2")
for (const args of [
  ["init"],
  [
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.test",
    "commit",
    "--allow-empty",
    "-m",
    "Isolated Phase 4 fixture",
  ],
]) {
  const git = Bun.spawn(["git", ...args], { cwd: fixture.artifacts, stdout: "ignore", stderr: "ignore" })
  assert.equal(await git.exited, 0)
}
const home = join(directory, "server-home")
await mkdir(home, { mode: 0o700 })
if (reuse) {
  await mkdir(join(home, "state/tandem"), { recursive: true, mode: 0o700 })
  await writeFile(join(home, "state/tandem/password"), reuse.password, { mode: 0o600 })
}
await writeFile(
  join(fixture.artifacts, "opencode.json"),
  JSON.stringify({
    model: "fixture/fixture",
    snapshots: false,
    permissions: [{ action: "browser", resource: "*", effect: "ask" }],
    providers: {
      fixture: {
        name: "Fixture",
        api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: fixture.url },
        request: { body: { apiKey: "fixture-not-a-credential" } },
        models: {
          fixture: {
            api: { id: "fixture" },
            capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
            limit: { context: 100000, output: 10000 },
          },
        },
      },
    },
  }),
)
const browser = Bun.spawn([preparation.launcher], { stdout: "ignore", stderr: "ignore" })
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() })
const port = reuse ? Number(new URL(reuse.backend).port) : reservation.port!
reservation.stop(true)
const backend = `http://127.0.0.1:${port}`
const server = Bun.spawn([binary, "serve", "--hostname", "127.0.0.1", "--port", String(port)], {
  cwd: fixture.artifacts,
  env: {
    PATH: process.env.PATH,
    HOME: home,
    XDG_DATA_HOME: join(home, "data"),
    XDG_CONFIG_HOME: join(home, "config"),
    XDG_CACHE_HOME: join(home, "cache"),
    XDG_STATE_HOME: join(home, "state"),
    TANDEM_PROMPT_CORRECTOR: "false",
    OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_MODELS_FETCH: "true",
    TANDEM_CHROME_CONNECTIONS: JSON.stringify(
      fixture.connections.map((item) => ({ ...item, directory: preparation.ipcDirectory })),
    ),
  },
  stdout: Bun.file(join(directory, "packaged-server.log")),
  stderr: Bun.file(join(directory, "packaged-server-error.log")),
})
let ui: ReturnType<typeof Bun.serve> | undefined
async function wait<T>(read: () => Promise<T | undefined>, label: string, timeout = 45000): Promise<T> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await read()
    if (value !== undefined) return value
    await Bun.sleep(100)
  }
  throw new Error(label)
}
try {
  console.error("packaged server: waiting for password")
  const password = await wait(
    () =>
      readFile(join(home, "state/tandem/password"), "utf8")
        .then((value) => value.trim() || undefined)
        .catch(() => undefined),
    "No packaged daemon password",
  )
  const headers = {
    authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
    "content-type": "application/json",
  }
  const api = async (path: string, body?: unknown, method = body === undefined ? "GET" : "POST"): Promise<any> => {
    const response = await fetch(backend + path, {
      headers,
      method,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(5000),
    })
    const text = await response.text()
    assert(response.ok, `${path}: ${response.status} ${text}`)
    return response.status === 204 ? undefined : JSON.parse(text)
  }
  console.error("packaged server: waiting for health")
  await wait(
    async () =>
      fetch(backend + "/api/health", { headers, signal: AbortSignal.timeout(2000) }).then(
        async (r) => {
          await r.arrayBuffer()
          return r.ok ? true : undefined
        },
        () => undefined,
      ),
    "Packaged server did not listen",
  )
  console.error("installed host: waiting for discovery")
  await wait(async () => {
    const bridge = await connect(preparation.ipcDirectory).catch(() => undefined)
    if (!bridge) return undefined
    assert.equal(bridge.discovery.executable, preparation.hostExecutable)
    bridge.close()
    return true
  }, "Installed host did not connect")
  const session = (
    await api("/api/session", {
      location: { directory: fixture.artifacts },
      model: { providerID: "fixture", id: "fixture" },
    })
  ).data
  console.error("packaged server: session created")
  const dist = resolve(import.meta.dir, "../../app/dist")
  ui = Bun.serve({
    idleTimeout: 0,
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const url = new URL(request.url)
      if (url.pathname.startsWith("/phase4/")) {
        if (request.headers.get("authorization") !== headers.authorization) return new Response(null, { status: 401 })
        if (url.pathname === "/phase4/effects")
          return Response.json({ clicks: fixture.effects().filter((item: any) => item.kind === "click").length })
        if (url.pathname === "/phase4/revoke" && request.method === "POST") {
          fixture.setScenario(() => {
            const chunk = {
              id: "revocation",
              object: "chat.completion.chunk",
              created: 0,
              model: "fixture",
              choices: [
                {
                  index: 0,
                  delta: {
                    role: "assistant",
                    tool_calls: [
                      {
                        index: 0,
                        id: "revoked-create",
                        type: "function",
                        function: {
                          name: "browser",
                          arguments: JSON.stringify({ action: "create", browser: "fixture", url: fixture.pageURL }),
                        },
                      },
                    ],
                  },
                  finish_reason: "tool_calls",
                },
              ],
            }
            return new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, {
              headers: { "content-type": "text/event-stream" },
            })
          })
          return Response.json({ ok: true })
        }
        return new Response(null, { status: 404 })
      }
      if (url.pathname.startsWith("/api/")) return fetch(new Request(backend + url.pathname + url.search, request))
      const candidate = resolve(dist, "." + url.pathname)
      const file =
        candidate.startsWith(dist + "/") && (await Bun.file(candidate).exists())
          ? Bun.file(candidate)
          : Bun.file(join(dist, "index.html"))
      return new Response(file)
    },
  })
  const clientConfig = join(directory, "packaged-client.json")
  await writeFile(
    clientConfig,
    JSON.stringify({
      directory,
      binary,
      backend,
      uiURL: String(ui.url),
      artifacts: fixture.artifacts,
      task: fixture.task,
      session,
      password,
      installedHost: preparation.hostExecutable,
    }),
    { mode: 0o600 },
  )
  if (process.env.TANDEM_PHASE4_ANDROID) {
    console.error("Packaged Android fixture ready; use private packaged-client.json for connection details")
    await wait(
      async () => ((await Bun.file(join(directory, "android-finished.json")).exists()) ? true : undefined),
      "Android verification did not finish",
      1200000,
    )
    const report = JSON.parse(await readFile(join(directory, "packaged-session-report.json"), "utf8"))
    assert.equal(report.passed, true)
    assert.equal(fixture.effects().filter((item: any) => item.kind === "click").length, 1)
    assert.equal((await api("/api/permission/saved")).data.length, 0)
    assert.equal((await api(`/api/session/${session.id}/permission`)).data.length, 0)
  } else {
    const runner = Bun.spawn(
      ["node", "--experimental-strip-types", resolve(import.meta.dir, "install-client.ts"), clientConfig],
      { stdout: "inherit", stderr: "inherit" },
    )
    assert.equal(await runner.exited, 0, "Packaged client workflow failed")
    assert.equal(fixture.effects().filter((item: any) => item.kind === "click").length, 1)
  }
} finally {
  ui?.stop(true)
  server.kill("SIGTERM")
  await Promise.race([server.exited, Bun.sleep(10000).then(() => server.kill("SIGKILL"))])
  browser.kill("SIGTERM")
  await Promise.race([browser.exited, Bun.sleep(10000).then(() => browser.kill("SIGKILL"))])
  fixture.close()
}
