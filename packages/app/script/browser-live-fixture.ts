import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"
import path from "node:path"
import { randomBytes } from "node:crypto"

// This fixture starts the production HTTP/SSE application with private storage.
// Its control listener creates real permission requests, never intercepted UI responses.
const root = await mkdtemp("/tmp/tandem/browser-client-")
for (const name of ["home", "data", "config", "cache", "state", "project"]) {
  await mkdir(path.join(root, name), { mode: 0o700 })
}
Object.assign(process.env, {
  HOME: path.join(root, "home"),
  OPENCODE_TEST_HOME: path.join(root, "home"),
  XDG_DATA_HOME: path.join(root, "data"),
  XDG_CONFIG_HOME: path.join(root, "config"),
  XDG_CACHE_HOME: path.join(root, "cache"),
  XDG_STATE_HOME: path.join(root, "state"),
  OPENCODE_CONFIG_DIR: path.join(root, "config"),
  OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
  OPENCODE_DISABLE_PROJECT_CONFIG: "true",
  OPENCODE_DISABLE_MODELS_FETCH: "true",
  TANDEM_PROMPT_CORRECTOR: "false",
  OPENCODE_SERVER_USERNAME: "fixture",
  OPENCODE_SERVER_PASSWORD: randomBytes(24).toString("hex"),
})
delete process.env.TANDEM_CHROME_CONNECTIONS
const directory = path.join(root, "project")
process.chdir(directory)
const v2 = process.env.CLIENT_PROTOCOL === "v2"
const uiPort = Number(process.env.CLIENT_UI_PORT ?? 4498)
let assertPermission: Awaited<ReturnType<typeof import("./browser-live-server").liveServer>>["assert"] | undefined
const server = await (async () => {
  const port = Number(process.env.CLIENT_BACKEND_PORT ?? 4198)
  if (!v2) {
    const { Server } = await import("../../opencode/src/server/server")
    return Server.listen({
      hostname: "127.0.0.1",
      port,
      cors: [`http://127.0.0.1:${uiPort}`, `http://localhost:${uiPort}`],
    })
  }
  const { liveServer } = await import("./browser-live-server")
  const handler = await liveServer()
  assertPermission = handler.assert
  return Bun.serve({
    hostname: "127.0.0.1",
    port,
    idleTimeout: 0,
    async fetch(request) {
      const origin = request.headers.get("origin")
      const response =
        request.method === "OPTIONS" ? new Response(null, { status: 204 }) : await handler.handler(request)
      if (
        origin === `http://127.0.0.1:${uiPort}` ||
        origin === `http://localhost:${uiPort}` ||
        origin === "oc://renderer"
      ) {
        response.headers.set("access-control-allow-origin", origin)
        response.headers.set(
          "access-control-allow-headers",
          "authorization,content-type,x-opencode-directory,x-opencode-workspace",
        )
        response.headers.set("access-control-allow-methods", "GET,POST,PUT,PATCH,DELETE,OPTIONS")
        response.headers.set("access-control-expose-headers", "expires")
      }
      return response
    },
  })
})()
const authorization = `Basic ${Buffer.from(`fixture:${process.env.OPENCODE_SERVER_PASSWORD}`).toString("base64")}`
const api = async (pathname: string, body?: unknown, signal?: AbortSignal) => {
  const response = await fetch(new URL(pathname, server.url), {
    method: body === undefined ? "GET" : "POST",
    headers: { authorization, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  })
  if (!response.ok) throw new Error(`Fixture API ${pathname}: ${response.status} ${await response.text()}`)
  return response.status === 204 ? undefined : response.json()
}
const session = (await api("/api/session", { location: { directory } })).data
if (v2 && process.env.CLIENT_CAPTURE_PNG) {
  const { BrowserMedia } = await import("../../core/src/browser-media")
  const { Database } = await import("../../core/src/database/database")
  const { Database: Sqlite } = await import("bun:sqlite")
  const capture = await BrowserMedia.store(session.id, await readFile(process.env.CLIENT_CAPTURE_PNG))
  const db = new Sqlite(Database.path())
  const now = Date.now()
  const messages = [
    {
      id: "msg_01_client_fixture",
      type: "user",
      text: "Display the isolated client fixture screenshot.",
      time: { created: now },
    },
    {
      id: "msg_02_client_fixture",
      type: "assistant",
      agent: "build",
      model: { providerID: "fixture", id: "fixture" },
      finish: "stop",
      time: { created: now + 1, completed: now + 2 },
      content: [
        {
          type: "tool",
          id: "call_fixture_capture",
          name: "browser",
          time: { created: now + 1, completed: now + 2 },
          state: {
            status: "completed",
            input: { action: "screenshot", browser: "fixture", tab: "fixture-owned tab" },
            structured: {},
            content: [
              { type: "text", text: "Seeded client-only PNG fixture; browser runtime acceptance is separate." },
              { type: "file", uri: capture.uri, mime: capture.mime },
            ],
          },
        },
      ],
    },
  ]
  for (const [index, message] of messages.entries()) {
    const { id, type, ...data } = message
    db.query(
      "INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).run(id, session.id, type, index + 1, now + index, now + index, JSON.stringify(data))
  }
  db.close()
  await writeFile(path.join(root, "capture.json"), JSON.stringify(capture), { mode: 0o600 })
}
const requests = new Map<string, { controller: AbortController; result?: unknown }>()
const controls = Bun.serve({
  hostname: "127.0.0.1",
  port: Number(process.env.CLIENT_CONTROL_PORT ?? 4199),
  async fetch(request) {
    const url = new URL(request.url)
    if (request.method === "GET" && url.pathname === "/status")
      return Response.json({
        sessionID: session.id,
        requests: [...requests].map(([id, value]) => ({ id, result: value.result })),
      })
    if (request.method === "POST" && url.pathname === "/ask") {
      const { capability = "read", origin = "https://example.com" } = await request.json()
      const id = `per_${randomBytes(12).toString("hex")}`
      const resource = Buffer.from(
        JSON.stringify({ browser: "fixture", capability, origin, frameOrigin: origin }),
      ).toString("hex")
      const state: { controller: AbortController; result?: unknown } = { controller: new AbortController() }
      requests.set(id, state)
      const input = {
        id,
        action: "browser",
        resources: [resource],
        save: [resource],
        metadata: {
          browser: "Isolated client fixture",
          capability,
          origin,
          tabTitle: "Phase 3 client test",
          tabScope: "fixture-owned tab",
        },
      }
      const pending = assertPermission
        ? assertPermission(directory, { ...input, sessionID: session.id }, state.controller.signal)
        : api(`/api/session/${session.id}/permission`, input, state.controller.signal)
      void pending.then(
        (result) => {
          state.result = result ?? { allowed: true }
        },
        (error) => {
          state.result = { error: error.name, message: error.message }
        },
      )
      return Response.json({ id })
    }
    if (request.method === "POST" && url.pathname === "/cancel") {
      const { id } = await request.json()
      requests.get(id)?.controller.abort()
      return Response.json({ cancelled: id })
    }
    return new Response("Not found", { status: 404 })
  },
})
const metadata = {
  root,
  directory,
  backend: server.url.href,
  controls: controls.url.href,
  username: "fixture",
  password: process.env.OPENCODE_SERVER_PASSWORD,
  sessionID: session.id,
  ui: `http://127.0.0.1:${uiPort}/${Buffer.from(directory).toString("base64url")}/session/${session.id}`,
}
await writeFile(path.join(root, "connection.json"), JSON.stringify(metadata), { mode: 0o600 })
console.log(`Client fixture ready; private connection metadata: ${root}/connection.json`)
await new Promise(() => {})
