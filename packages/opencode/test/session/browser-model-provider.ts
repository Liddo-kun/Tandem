import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { resolve } from "node:path"
import { parseArgs } from "node:util"

// Auth stays inside the configured runtime/provider plugin. The isolated test processes
// receive only a loopback endpoint and non-secret model metadata, never credentials.
const { values } = parseArgs({
  options: { directory: { type: "string" }, model: { type: "string" }, probe: { type: "boolean" } },
})
const directory = resolve(values.directory ?? "")
const selection = values.model ?? process.env.TANDEM_PHASE3_MODEL
assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
assert(selection)
assert(selection.startsWith("openai/"), "Explicit --model openai/<configured-model> is required")
process.umask(0o077)
await mkdir(directory, { recursive: true, mode: 0o700 })
process.env.OPENCODE_DB = ":memory:"
process.env.OPENCODE_DISABLE_MODELS_FETCH = "true"
process.env.TMPDIR = directory
const { Effect } = await import("effect")
const { LayerNode } = await import("../../../core/src/effect/layer-node")
const { ProviderV2 } = await import("../../../core/src/provider")
const { ModelV2 } = await import("../../../core/src/model")
const { Provider } = await import("../../src/provider/provider")
const { Auth } = await import("../../src/auth")
const { provideInstance, testInstanceStoreLayer } = await import("../fixture/fixture")
const abort = new AbortController()
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => abort.abort())
const transport = (value: unknown): value is typeof fetch => typeof value === "function"
let stage = "configured OAuth resolution"
await Effect.runPromise(
  Effect.gen(function* () {
    const provider = yield* Provider.Service
    const auth = yield* (yield* Auth.Service).get("openai")
    if (auth?.type !== "oauth") throw new Error("configured_oauth_unavailable")
    stage = "configured model lookup"
    const model = yield* provider.getModel(
      ProviderV2.ID.make("openai"),
      ModelV2.ID.make(selection.slice("openai/".length)),
    )
    const configured = yield* provider.getProvider(ProviderV2.ID.make("openai"))
    stage = "configured OAuth transport lookup"
    const send = configured.options.fetch
    if (!transport(send)) throw new Error("configured_provider_transport_unavailable")
    const metadata = {
      selection,
      apiID: model.api.id,
      name: model.name,
      limit: model.limit,
      image: model.capabilities.input.image,
      auth: "configured OAuth provider plugin; no credential export",
    }
    if (values.probe) {
      yield* Effect.promise(() =>
        writeFile(`${directory}/provider.json`, JSON.stringify({ available: true, ...metadata }, null, 2), {
          mode: 0o600,
        }),
      )
      return
    }
    const evidence: Record<string, { requests: number; images: number; statuses: number[]; validation: string[] }> = {}
    const server = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      idleTimeout: 120,
      async fetch(request) {
        const runtime = new URL(request.url).pathname.split("/")[1]
        if ((runtime !== "legacy" && runtime !== "v2") || request.method !== "POST")
          return new Response("unsupported", { status: 400 })
        const item = (evidence[runtime] ??= { requests: 0, images: 0, statuses: [], validation: [] })
        if (++item.requests > 16) return new Response("fixture turn limit", { status: 400 })
        try {
          const body = await request.json()
          assert(body && typeof body === "object" && "model" in body && body.model === model.api.id)
          if ("tools" in body) {
            assert(Array.isArray(body.tools))
            assert(
              body.tools.every(
                (tool: unknown) => tool && typeof tool === "object" && "name" in tool && tool.name === "browser",
              ),
              "Only the browser tool may reach the genuine model",
            )
          }
          const images: string[] = []
          const visit = (value: unknown): void => {
            if (Array.isArray(value)) value.forEach(visit)
            else if (value && typeof value === "object") {
              if (
                "type" in value &&
                value.type === "input_image" &&
                "image_url" in value &&
                typeof value.image_url === "string" &&
                value.image_url.startsWith("data:image/png;base64,")
              )
                images.push(value.image_url)
              Object.values(value).forEach(visit)
            }
          }
          visit(body)
          for (const image of images) {
            const bytes = Buffer.from(image.slice("data:image/png;base64,".length), "base64")
            assert.equal(bytes.subarray(0, 8).toString("hex"), "89504e470d0a1a0a")
            await writeFile(`${directory}/${runtime}-provider.png`, bytes, { mode: 0o600 })
            item.images++
          }
          // These isolated providers do not load Codex's chat.params hook. Apply its
          // no-max-output constraint and required Responses defaults at the proxy seam.
          const outgoing = {
            ...body,
            store: false,
            instructions:
              "instructions" in body && body.instructions
                ? body.instructions
                : "Complete only the supplied local browser fixture task.",
          }
          if ("max_output_tokens" in outgoing) delete outgoing.max_output_tokens
          const response = await send("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: { "content-type": "application/json", originator: "opencode" },
            body: JSON.stringify(outgoing),
            signal: request.signal,
          })
          item.statuses.push(response.status)
          if (!response.ok) {
            const error = await response.text()
            item.validation.push(
              ["max_output_tokens", "instructions", "store", "temperature", "top_p", "tool_choice"].find((key) =>
                error.includes(key),
              ) ?? "unclassified_provider_rejection",
            )
          }
          await writeFile(`${directory}/provider-evidence.json`, JSON.stringify(evidence, null, 2), { mode: 0o600 })
          // Failed responses may contain account diagnostics. Do not record or relay their bodies.
          if (!response.ok) return new Response(`Configured provider HTTP ${response.status}`, { status: 400 })
          return new Response(response.body, { headers: { "content-type": "text/event-stream" } })
        } catch {
          return new Response("Configured provider fixture failed", { status: 400 })
        }
      },
    })
    yield* Effect.addFinalizer(() => Effect.sync(() => server.stop(true)))
    yield* Effect.promise(() =>
      writeFile(
        `${directory}/provider.json`,
        JSON.stringify({ available: true, ...metadata, url: String(server.url) }, null, 2),
        { mode: 0o600 },
      ),
    )
    yield* Effect.never
  }).pipe(
    provideInstance(directory),
    Effect.provide(LayerNode.compile(LayerNode.group([Provider.node, Auth.node]))),
    Effect.provide(testInstanceStoreLayer),
    Effect.scoped,
  ),
  { signal: abort.signal },
).catch(async () => {
  if (abort.signal.aborted) return
  // No raw Effect causes, provider objects or auth errors in fixture artifacts.
  await writeFile(`${directory}/blocked.json`, JSON.stringify({ blocked: true, stage, selection }), { mode: 0o600 })
  process.exitCode = 1
})
