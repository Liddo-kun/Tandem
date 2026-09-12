import assert from "node:assert/strict"
import { mkdir, mkdtemp, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { parseArgs } from "node:util"

// Uses only the embedded legacy HTTP API, never controller/runtime imports.
// Start an isolated, original-engine-enabled backend separately. Loopback fixture
// URLs must be reachable from both that backend and its configured Chromium.
const { values } = parseArgs({
  args: process.argv.slice(2),
  options: {
    server: { type: "string" },
    browser: { type: "string" },
    project: { type: "string" },
    help: { type: "boolean" },
  },
})
if (values.help) {
  console.log(`bun packages/chrome-bridge/script/original-session-acceptance.ts \\
  --server http://127.0.0.1:4107 --browser <isolated-binding> [--project <NEW-directory>]
Environment: TANDEM_ACCEPTANCE_SERVER, TANDEM_ACCEPTANCE_BROWSER, TANDEM_ACCEPTANCE_PROJECT.
Optional TANDEM_ACCEPTANCE_AUTHORIZATION supplies the HTTP Authorization header (never logged).
The project must be new; default is a private directory under /tmp/tandem.
Success intentionally retains ONE local fixture deliverable tab; close it manually after reviewing evidence.
No server/browser is launched, restarted or reconfigured. No account provider is used.`)
  process.exit(0)
}

type Wire = Record<string, any>
const server = values.server ?? process.env.TANDEM_ACCEPTANCE_SERVER
const browser = values.browser ?? process.env.TANDEM_ACCEPTANCE_BROWSER
assert(server && browser, "Explicit --server and --browser (or acceptance environment variables) required")
const base = new URL(server)
assert(["http:", "https:"].includes(base.protocol) && !base.username && !base.password, "Invalid server URL")
process.umask(0o077)
const requested = values.project ?? process.env.TANDEM_ACCEPTANCE_PROJECT
const project = requested ? resolve(requested) : await mkdtemp("/tmp/tandem/original-session-")
if (requested) await mkdir(project, { mode: 0o700 }) // Refuse any existing project/config.

let session: string | undefined
let tab: string | undefined
let inputRef: string | undefined
let lastID: string | undefined
let lastAction: string | undefined
let step = 0
let failure: Error | undefined
let pngBytes = 0
let heldMilliseconds = 0
let cleanup = false
let finished = false
let clipboardBridgeRemoved = false
let stopping = false
let configWritten = false
let permissionTask: Promise<void> | undefined
const outcomes: { action: string; outcome: string }[] = []
const state: Record<string, { value: string; clicks: number; tick: number; clipboardBridgePresent: boolean }> = {}
const valueChecks: { value: string; snapshot: boolean }[] = []
const marker = `ORIGINAL_SESSION_ACCEPTANCE_${crypto.randomUUID()}`

function check(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message)
}

async function api(path: string, body?: unknown) {
  const url = new URL(path, base)
  url.searchParams.set("directory", project)
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.TANDEM_ACCEPTANCE_AUTHORIZATION
        ? { authorization: process.env.TANDEM_ACCEPTANCE_AUTHORIZATION }
        : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  check(response.ok, `HTTP ${response.status} at ${path.split("/")[1]}`)
  const text = await response.text()
  return text ? JSON.parse(text) : undefined
}

function page(kind: string, children = "") {
  const main = kind === "main"
  return `<!doctype html><meta charset="utf-8"><title>Original engine fixture ${kind}</title>
<style>body{font:16px sans-serif}iframe{width:420px;height:140px}input{display:block}#noise{height:24px}</style>
<h1>${kind === "finish" ? "Fixture navigation finished" : `${kind} fixture`}</h1><div id="noise">0</div>
${main ? '<button id="open">Open form</button>' : ""}
<section id="form" ${main ? "hidden" : ""}>
<label>Fixture ${kind}<input name="fixture-${main ? "name" : kind}" value="seed-${kind}"></label>
<output id="value">value: seed-${kind}</output></section>${children}
<script>
let clicks=0,tick=0;const input=document.querySelector('input');
function report(){return fetch('/report',{method:'POST',headers:{'content-type':'application/json'},
body:JSON.stringify({kind:${JSON.stringify(kind)},value:input.value,clicks,tick,
clipboardBridgePresent:!!globalThis.__browserUseClipboardBridge})})}
input.addEventListener('input',()=>{document.querySelector('#value').textContent='value: '+(input.value||'[empty]');report()});
${main ? "document.querySelector('#open').onclick=()=>{clicks++;document.querySelector('#form').hidden=false;report()}" : ""}
setInterval(()=>{document.querySelector('#noise').textContent=String(++tick);if(tick%10===0)report()},50);
report();
</script>`
}

async function report(request: Request) {
  const body = (await request.json()) as Wire
  check(["main", "same", "cross", "finish"].includes(body.kind), "Unexpected fixture report")
  state[body.kind] = {
    value: body.value,
    clicks: body.clicks,
    tick: body.tick,
    clipboardBridgePresent: body.clipboardBridgePresent === true,
  }
  return Response.json({ ok: true })
}

const cross = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    if (new URL(request.url).pathname === "/report") return report(request)
    return new Response(page("cross"), { headers: { "content-type": "text/html" } })
  },
})
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const path = new URL(request.url).pathname
    if (path === "/report") return report(request)
    if (path === "/state") return Response.json(state)
    if (path === "/finish") return new Response(page("finish"), { headers: { "content-type": "text/html" } })
    return new Response(
      path === "/same"
        ? page("same")
        : page(
            "main",
            `<iframe name="same" title="Same origin fixture" src="/same"></iframe>
<iframe name="cross" title="Cross origin fixture" src="${cross.url}"></iframe>`,
          ),
      { headers: { "content-type": "text/html" } },
    )
  },
})

async function fixtureState() {
  return (await (await fetch(new URL("state", fixture.url))).json()) as typeof state
}

function fieldRef(result: Wire | undefined, name = "fixture-name") {
  const element = result?.elements?.find(
    (item: Wire) => item.tag === "input" && item.label?.includes(name) && typeof item.ref === "string",
  )
  check(element, `Inspect did not expose live input ref for ${name}`)
  return element.ref as string
}

async function mainValue(value: string, snapshot?: Wire) {
  const deadline = Date.now() + 3000
  while ((await fixtureState()).main?.value !== value) {
    check(Date.now() < deadline, "Independent main input value mismatch")
    await Bun.sleep(100)
  }
  if (snapshot) check(snapshot.text?.includes(`value: ${value || "[empty]"}`), "Intermediate input snapshot mismatch")
  valueChecks.push({ value, snapshot: !!snapshot })
}

// Look only at the matching tool response, not stale results in provider history.
function toolResult(body: Wire): Wire {
  const message = body.messages?.findLast((item: Wire) => item.role === "tool" && item.tool_call_id === lastID)
  check(message, `Missing tool response at step ${step}`)
  let result: Wire | undefined
  function visit(value: any) {
    if (typeof value === "string") {
      try {
        visit(JSON.parse(value))
      } catch {
        /* Ordinary snapshot text is not JSON. */
      }
    } else if (value && typeof value === "object") {
      if (value.action === lastAction && value.outcome) result = value
      else Object.values(value).forEach(visit)
    }
  }
  visit(message.content)
  check(result, `Missing structured browser result for ${lastAction}`)
  check(
    result.outcome === (lastAction === "keep" ? "not_dispatched" : "confirmed") && !result.code,
    `Browser ${lastAction}: ${String(result.outcome).slice(0, 40)} / ${String(result.code ?? "no code").slice(0, 60)}`,
  )
  if (lastAction === "keep") check(result.disposition === "deliverable" && result.pending, "Keep intent not recorded")
  outcomes.push({ action: result.action, outcome: result.outcome })
  if (result.tab) tab = result.tab
  return result
}

const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    try {
      check(!failure, "Provider called after failed acceptance")
      const body = (await request.json()) as Wire
      // Legacy title/small-model requests can run concurrently with the tool loop.
      if (!body.tools?.some((item: Wire) => item.function?.name === "browser")) {
        const content = "Local original-engine acceptance"
        if (!body.stream)
          return Response.json({
            id: "fixture-title",
            object: "chat.completion",
            created: 0,
            model: "fixture",
            choices: [{ index: 0, message: { role: "assistant", content }, finish_reason: "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        return new Response(
          `data: ${JSON.stringify({
            id: "fixture-title",
            object: "chat.completion.chunk",
            created: 0,
            model: "fixture",
            choices: [{ index: 0, delta: { role: "assistant", content }, finish_reason: "stop" }],
          })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
      }
      if (step === 0) {
        const tool = body.tools?.find((item: Wire) => item.function?.name === "browser")
        check(
          tool?.function?.parameters?.properties?.selector,
          "Backend browser schema lacks original selector support",
        )
      }
      const result = step ? toolResult(body) : undefined
      let input: Wire | undefined
      switch (step) {
        case 0:
          input = { action: "create", browser, url: String(fixture.url) }
          break
        case 1:
          await Bun.sleep(1000)
          input = { action: "inspect", tab }
          break
        case 2: {
          check(result, "Missing initial inspection")
          check(
            result.text?.includes("same fixture") && result.text.includes("cross fixture"),
            "Snapshot missing ordinary frame contents",
          )
          check(
            result.frames?.some((frame: Wire) => frame.origin === new URL(String(cross.url)).origin),
            "Cross-origin frame missing",
          )
          const button = result.elements?.find((element: Wire) => element.label?.includes("Open form") && element.ref)
          check(button, "Inspect did not expose Open form ref; ref path is required")
          input = { action: "click", tab, ref: button.ref }
          break
        }
        case 3:
          check(heldMilliseconds >= 22000, "Input approval was not held for 22 seconds")
          check((await fixtureState()).main?.clicks === 1, "Open form click was not delivered exactly once")
          input = { action: "inspect", tab }
          break
        case 4:
          check(result?.text?.includes("seed-main"), "Populated field missing from snapshot")
          await mainValue("seed-main", result)
          inputRef = fieldRef(result)
          // Start at Home so append must move to End rather than use the caret.
          input = { action: "key", tab, ref: inputRef, key: "Home" }
          break
        case 5:
          input = { action: "type", tab, ref: inputRef, text: "-appended", mode: "append" }
          break
        case 6:
          await mainValue("seed-main-appended")
          input = { action: "inspect", tab }
          break
        case 7:
          await mainValue("seed-main-appended", result)
          input = { action: "type", tab, ref: fieldRef(result), text: "", mode: "replace" }
          break
        case 8:
          await mainValue("")
          input = { action: "inspect", tab }
          break
        case 9:
          await mainValue("", result)
          input = { action: "type", tab, ref: fieldRef(result), text: "accepted-main", mode: "replace" }
          break
        case 10:
          await mainValue("accepted-main")
          input = { action: "inspect", tab }
          break
        case 11:
          await mainValue("accepted-main", result)
          input = {
            action: "type",
            tab,
            selector: 'input[name="fixture-name"]',
            text: "accepted-main",
            mode: "replace",
          }
          break
        case 12:
          input = {
            action: "type",
            tab,
            selector: 'iframe[name="same"] >> internal:control=enter-frame >> input[name="fixture-same"]',
            text: "accepted-same",
            mode: "replace",
          }
          break
        case 13:
          input = {
            action: "type",
            tab,
            selector: 'iframe[name="cross"] >> internal:control=enter-frame >> input[name="fixture-cross"]',
            text: "accepted-cross",
            mode: "replace",
          }
          break
        case 14:
          input = { action: "key", tab, selector: 'input[name="fixture-name"]', key: "Tab" }
          break
        case 15:
          await Bun.sleep(600)
          for (const kind of ["main", "same", "cross"]) {
            const observed = (await fixtureState())[kind]
            check(observed?.value === `accepted-${kind}`, `Independent ${kind} input value mismatch`)
            check(observed.tick > 20, `Fixture ${kind} DOM churn missing`)
          }
          check((await fixtureState()).main?.clicks === 1, "Unexpected duplicate click")
          input = { action: "inspect", tab }
          break
        case 16:
          for (const kind of ["main", "same", "cross"])
            check(result?.text?.includes(`accepted-${kind}`), `Read snapshot missing ${kind} value`)
          input = { action: "screenshot", tab }
          break
        case 17: {
          // The provider must receive the bytes, not merely a persisted media URL.
          const images = JSON.stringify(body).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/g) ?? []
          for (const image of images) {
            const bytes = Buffer.from(image.slice(image.indexOf(",") + 1), "base64")
            if (
              bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
              bytes.length > 100 &&
              bytes.toString("ascii", 12, 16) === "IHDR" &&
              bytes.readUInt32BE(16) > 0 &&
              bytes.readUInt32BE(20) > 0
            ) {
              pngBytes = bytes.length
              await writeFile(join(project, "provider.png"), bytes, { mode: 0o600 })
            }
          }
          check(pngBytes > 100, "Real PNG did not reach scripted provider")
          input = { action: "navigate", tab, url: new URL("finish", fixture.url).href }
          break
        }
        case 18:
          await Bun.sleep(500)
          input = { action: "inspect", tab }
          break
        case 19:
          check(result?.text?.includes("Fixture navigation finished"), "Final navigation not observed")
          // Exercise the bridge in the document that will survive finalization.
          input = {
            action: "type",
            tab,
            ref: fieldRef(result, "fixture-finish"),
            text: "retained-fixture",
            mode: "replace",
          }
          break
        case 20: {
          const deadline = Date.now() + 3000
          while ((await fixtureState()).finish?.value !== "retained-fixture") {
            check(Date.now() < deadline, "Retained page input not delivered")
            await Bun.sleep(100)
          }
          check(
            (await fixtureState()).finish?.clipboardBridgePresent,
            "Retained document never reported clipboard bridge installation",
          )
          input = { action: "keep", tab, disposition: "deliverable" }
          break
        }
        case 21:
          finished = true
          break
        default:
          throw new Error("Unexpected provider continuation")
      }
      lastID = `original-acceptance-${step++}`
      lastAction = input?.action
      const delta = input
        ? {
            role: "assistant",
            tool_calls: [
              {
                index: 0,
                id: lastID,
                type: "function",
                function: { name: "browser", arguments: JSON.stringify(input) },
              },
            ],
          }
        : { role: "assistant", content: marker }
      return new Response(
        `data: ${JSON.stringify({ id: lastID, object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta, finish_reason: input ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )
    } catch (error) {
      failure = error instanceof Error ? error : new Error("Provider fixture failed")
      return Response.json({ error: { message: "Local acceptance assertion failed" } }, { status: 400 })
    }
  },
})

try {
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      model: "original-acceptance/fixture",
      small_model: "original-acceptance/fixture",
      permission: { "*": "deny", browser: "ask" },
      provider: {
        "original-acceptance": {
          name: "Local original-engine acceptance",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: new URL("v1", provider.url).href, apiKey: "local-fixture" },
          models: {
            fixture: {
              id: "fixture",
              name: "Fixture",
              tool_call: true,
              attachment: true,
              modalities: { input: ["text", "image"], output: ["text"] },
              limit: { context: 100000, output: 10000 },
            },
          },
        },
      },
    }),
    { mode: 0o600, flag: "wx" },
  )
  configWritten = true
  await api("/global/health")
  session = (await api("/session", { title: "Original Chrome engine HTTP acceptance" })).id
  check(session, "Missing legacy session ID")
  permissionTask = (async () => {
    const delayed = new Map<string, number>()
    const replied = new Set<string>()
    while (!stopping) {
      const pending: Wire[] = await api("/permission")
      for (const permission of pending) {
        if (permission.sessionID !== session || replied.has(permission.id)) continue
        check(permission.permission === "browser", "Unexpected non-browser permission")
        if (!heldMilliseconds && permission.metadata?.capability === "input" && !failure) {
          if (!delayed.has(permission.id)) {
            check(lastAction === "click", "First input permission is not fixture click")
            delayed.set(permission.id, Date.now())
            console.log("Holding fixture click approval for 22 seconds")
          }
          const elapsed = Date.now() - delayed.get(permission.id)!
          check((await fixtureState()).main?.clicks === 0, "Click dispatched before approval")
          if (elapsed < 22000) continue
          heldMilliseconds = elapsed
        }
        await api(`/permission/${permission.id}/reply`, { reply: "once" })
        replied.add(permission.id)
      }
      for (const [id] of delayed) {
        check(
          replied.has(id) || pending.some((item) => item.id === id) || !!failure,
          "Delayed permission disappeared before approval",
        )
      }
      await Bun.sleep(150)
    }
  })().catch((error) => {
    failure ??= error instanceof Error ? error : new Error("Permission responder failed")
  })
  await api(`/session/${session}/prompt_async`, {
    model: { providerID: "original-acceptance", modelID: "fixture" },
    parts: [
      {
        type: "text",
        text: "Run the local original-engine browser acceptance fixture.",
        metadata: { tandemCorrectorDisabled: true, tandemRepromptDisabled: true },
      },
    ],
  })
  const deadline = Date.now() + 180000
  while (Date.now() < deadline) {
    if (failure) throw failure
    const messages = JSON.stringify(await api(`/session/${session}/message`))
    check(!messages.includes("cleanup_unconfirmed"), "Browser cleanup unconfirmed")
    if (finished && messages.includes(marker) && messages.includes("Browser cleanup: confirmed;")) {
      check(
        /tabs=1; retained=1(?:;|["\\])/.test(messages) && /nativeConfirmed=true/.test(messages),
        "Cleanup did not confirm native finalization with one retained deliverable",
      )
      cleanup = true
      break
    }
    await Bun.sleep(250)
  }
  check(cleanup, "Timed out awaiting final transcript and confirmed browser cleanup")
  // Independent page telemetry continues without reattaching or reinjecting the
  // engine. This checks bridge removal, not full clipboard descriptor equivalence.
  const restorationDeadline = Date.now() + 5000
  const cleanupTick = (await fixtureState()).finish?.tick ?? 0
  while (Date.now() < restorationDeadline) {
    const observed = (await fixtureState()).finish
    if (observed && observed.tick > cleanupTick && !observed.clipboardBridgePresent) {
      clipboardBridgeRemoved = true
      break
    }
    await Bun.sleep(150)
  }
  check(clipboardBridgeRemoved, "Retained fixture did not report clipboard bridge removal after finalization")
  check(heldMilliseconds >= 22000 && pngBytes > 100 && finished, "Incomplete ordinary workflow")
} catch (error) {
  failure ??= error instanceof Error ? error : new Error("Acceptance failed")
} finally {
  // Abort only our session on failure; keep the provider and responder alive while
  // the real runtime awaits finalizer permission. Never replay a failed mutation.
  if (session && !cleanup) {
    await api(`/session/${session}/abort`, {}).catch(() => undefined)
    const deadline = Date.now() + 45000
    while (Date.now() < deadline) {
      const messages = await api(`/session/${session}/message`).catch(() => undefined)
      if (JSON.stringify(messages ?? "").includes("Browser cleanup: confirmed;")) {
        cleanup = true
        break
      }
      await Bun.sleep(250)
    }
  }
  stopping = true
  await permissionTask
  await provider.stop(true)
  await fixture.stop(true)
  await cross.stop(true)
  // Retain the isolated config and session evidence, but prevent later turns from
  // accidentally addressing a recycled ephemeral provider port.
  if (configWritten)
    await writeFile(join(project, "opencode.json"), JSON.stringify({ permission: { "*": "deny" } }), { mode: 0o600 })
  await writeFile(
    join(project, "acceptance.json"),
    JSON.stringify(
      {
        passed: !failure && cleanup && clipboardBridgeRemoved,
        session,
        heldMilliseconds,
        pngBytes,
        cleanup,
        clipboardBridgeRemoved,
        valueChecks,
        deliverable: {
          tab,
          url: new URL("finish", fixture.url).href,
          retained: finished && cleanup,
          removal: "Close this owned fixture tab manually after reviewing evidence; fixture server has stopped.",
        },
        outcomes,
        fixture: state,
        error: failure?.message,
        exclusions: ["decline/cancel scenario", "full clipboard descriptor restoration", "real sites", "UI rendering"],
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
}
if (failure) {
  console.error(
    `FAIL original session: ${failure.message.slice(0, 240)}; cleanup=${cleanup}; report=${join(project, "acceptance.json")}`,
  )
  process.exitCode = 1
} else
  console.log(
    `PASS original session: live-ref append/clear/replace, selectors, frames, 22s approval, PNG, retained cleanup, bridge removal; ONE fixture tab retained; report=${join(project, "acceptance.json")}`,
  )
