import assert from "node:assert/strict"
import { mkdtemp, mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { parseArgs } from "node:util"

const { values } = parseArgs({
  options: {
    server: { type: "string" },
    browser: { type: "string" },
    help: { type: "boolean" },
  },
})
if (values.help) {
  console.log(
    "bun packages/chrome-bridge/script/original-permission-acceptance.ts --server http://127.0.0.1:4107 --browser original-fixture\nRuns deny then cancel serially. Uses TANDEM_ACCEPTANCE_SERVER/BROWSER and optional TANDEM_ACCEPTANCE_AUTHORIZATION. Starts only local fixture/provider servers; retains reports under /tmp/tandem.",
  )
  process.exit(0)
}
const server = values.server ?? process.env.TANDEM_ACCEPTANCE_SERVER
const browser = values.browser ?? process.env.TANDEM_ACCEPTANCE_BROWSER
assert(server && browser, "Explicit server and browser required")
const base = new URL(server)
assert(["http:", "https:"].includes(base.protocol) && !base.username && !base.password, "Invalid server URL")
process.umask(0o077)
const root = await mkdtemp("/tmp/tandem/original-permission-")
type Wire = Record<string, any>
const reports: Wire[] = []

// Each scenario has its own project, session, fixture and scripted provider.
// Never issue browser/controller calls outside the production legacy HTTP loop.
for (const scenario of ["deny", "cancel"] as const) {
  const project = join(root, scenario)
  await mkdir(project, { mode: 0o700 })
  let session: string | undefined
  let tab: string | undefined
  let step = 0
  let failure: Error | undefined
  let stopping = false
  let cleanup = false
  let inputPermission: string | undefined
  let inputAskedAt = 0
  let heldMilliseconds = 0
  let lateReplyStatus = 0
  let decisionSent = false
  let responder: Promise<void> | undefined
  let transcript: Wire[] = []
  let settlement: Wire | undefined
  const marker = `PERMISSION_${scenario}_${crypto.randomUUID()}`
  const observed = { clicks: 0, inputEvents: 0, value: "seed", reports: 0, ticks: 0 }
  const approvals: string[] = []

  async function request(path: string, body?: unknown) {
    const url = new URL(path, base)
    url.searchParams.set("directory", project)
    return fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.TANDEM_ACCEPTANCE_AUTHORIZATION
          ? { authorization: process.env.TANDEM_ACCEPTANCE_AUTHORIZATION }
          : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    })
  }
  async function api(path: string, body?: unknown): Promise<any> {
    const response = await request(path, body)
    assert(response.ok, `HTTP ${response.status} at ${path.split("/")[1]}`)
    const text = await response.text()
    return text ? JSON.parse(text) : undefined
  }
  const fixture = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      const path = new URL(req.url).pathname
      if (path === "/state") return Response.json(observed)
      if (path === "/click") {
        observed.clicks++
        return Response.json(true)
      }
      if (path === "/report") {
        const body = (await req.json()) as Wire
        observed.reports++
        observed.value = body.value
        observed.inputEvents = Math.max(observed.inputEvents, body.inputEvents)
        observed.ticks = Math.max(observed.ticks, body.ticks)
        return Response.json(true)
      }
      return new Response(
        `<!doctype html><title>Permission ${scenario} fixture</title>
<button>Mutate fixture</button><input name="fixture-name" value="seed"><output>seed</output><div id="noise"></div>
<script>
const input=document.querySelector('input');let inputEvents=0,ticks=0;
function report(){fetch('/report',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({value:input.value,inputEvents,ticks}),keepalive:true})}
input.oninput=()=>{inputEvents++;report()};
document.querySelector('button').onclick=()=>{fetch('/click',{method:'POST',keepalive:true});input.value='MUTATED';document.querySelector('output').textContent=input.value;report()};
setInterval(()=>{document.querySelector('#noise').textContent=String(++ticks);if(ticks%2===0)report()},50);
addEventListener('pagehide',report);report();
</script>`,
        { headers: { "content-type": "text/html" } },
      )
    },
  })
  async function unchanged() {
    const value = (await (await fetch(new URL("state", fixture.url))).json()) as typeof observed
    assert(value.reports > 0, "Fixture never reported readiness")
    assert.equal(value.clicks, 0, "Input click dispatched")
    assert.equal(value.inputEvents, 0, "Unexpected input event")
    assert.equal(value.value, "seed", "Fixture value changed")
  }
  const provider = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(req) {
      try {
        const body = (await req.json()) as Wire
        const auxiliary = !body.tools?.some((item: Wire) => item.function?.name === "browser")
        let input: Wire | undefined
        if (!auxiliary) {
          assert(!failure, "Provider called after fixture failure")
          if (step > 0) {
            const message = body.messages?.findLast(
              (item: Wire) => item.role === "tool" && item.tool_call_id === `${scenario}-${step - 1}`,
            )
            assert(message, "Missing matching tool response")
            if (step < 3) {
              let result: Wire | undefined
              const visit = (value: any) => {
                if (typeof value === "string") {
                  try {
                    visit(JSON.parse(value))
                  } catch {}
                } else if (value && typeof value === "object") {
                  if (value.action && value.outcome) result = value
                  else Object.values(value).forEach(visit)
                }
              }
              visit(message.content)
              assert(result?.outcome === "confirmed" && !result.code, "Create/inspect not confirmed")
              tab = result.tab ?? tab
              if (step === 2) {
                assert(result.text?.includes("seed"), "Populated input missing from snapshot")
                const button = result.elements?.find((item: Wire) => item.label?.includes("Mutate fixture") && item.ref)
                assert(button, "Inspection missing mutation button ref")
                input = { action: "click", tab, ref: button.ref }
              }
            } else {
              assert.equal(scenario, "deny", "Cancelled execution resumed provider")
              assert.equal(step, 3, "Unexpected provider continuation")
              assert(decisionSent, "Input failed before explicit rejection")
              assert(
                JSON.stringify(message.content).includes("The user rejected permission"),
                "Missing explicit permission rejection result",
              )
            }
          }
          if (step === 0) input = { action: "create", browser, url: String(fixture.url) }
          if (step === 1) {
            await Bun.sleep(500)
            input = { action: "inspect", tab }
          }
        }
        const id = auxiliary ? "title" : `${scenario}-${step++}`
        const content = auxiliary ? "Local permission fixture" : marker
        const delta = input
          ? {
              role: "assistant",
              tool_calls: [
                { index: 0, id, type: "function", function: { name: "browser", arguments: JSON.stringify(input) } },
              ],
            }
          : { role: "assistant", content }
        if (!body.stream)
          return Response.json({
            id,
            object: "chat.completion",
            created: 0,
            model: "fixture",
            choices: [{ index: 0, message: delta, finish_reason: input ? "tool_calls" : "stop" }],
            usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
          })
        return new Response(
          `data: ${JSON.stringify({
            id,
            object: "chat.completion.chunk",
            created: 0,
            model: "fixture",
            choices: [{ index: 0, delta, finish_reason: input ? "tool_calls" : "stop" }],
          })}\n\ndata: [DONE]\n\n`,
          { headers: { "content-type": "text/event-stream" } },
        )
      } catch (error) {
        failure = error instanceof Error ? error : new Error("Provider failed")
        return Response.json({ error: { message: "Local permission assertion failed" } }, { status: 400 })
      }
    },
  })

  async function pollCleanup(timeout: number) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      transcript = await api(`/session/${session}/message`)
      const text = JSON.stringify(transcript)
      if (text.includes("Browser cleanup: confirmed; tabs=1; retained=0") && text.includes("nativeConfirmed=true")) {
        cleanup = true
        return
      }
      assert(!text.includes("cleanup_unconfirmed"), "Native cleanup unconfirmed")
      await Bun.sleep(200)
    }
    throw new Error("Timed out awaiting native-confirmed cleanup")
  }

  try {
    await writeFile(
      join(project, "opencode.json"),
      JSON.stringify({
        model: "permission-fixture/fixture",
        small_model: "permission-fixture/fixture",
        permission: { "*": "deny", browser: "ask" },
        provider: {
          "permission-fixture": {
            name: "Local permission fixture",
            env: [],
            npm: "@ai-sdk/openai-compatible",
            options: { baseURL: new URL("v1", provider.url).href, apiKey: "local-fixture" },
            models: {
              fixture: { id: "fixture", name: "Fixture", tool_call: true, limit: { context: 100000, output: 10000 } },
            },
          },
        },
      }),
      { mode: 0o600, flag: "wx" },
    )
    session = (await api("/session", { title: `Original browser ${scenario} permission acceptance` })).id
    assert(session, "Session ID missing")
    responder = (async () => {
      const seen = new Set<string>()
      while (!stopping) {
        for (const permission of (await api("/permission")) as Wire[]) {
          if (permission.sessionID !== session || seen.has(permission.id)) continue
          assert.equal(permission.permission, "browser", "Unexpected permission")
          if (permission.metadata?.capability === "input") {
            assert(!inputPermission || inputPermission === permission.id, "Unexpected second input request")
            if (!inputPermission) {
              inputPermission = permission.id
              inputAskedAt = Date.now()
            }
            continue
          }
          // Keep finalizer approval live even while abort waits for cleanup.
          await api(`/permission/${permission.id}/reply`, { reply: "once" })
          approvals.push(permission.metadata?.capability ?? "unknown")
          seen.add(permission.id)
        }
        await Bun.sleep(150)
      }
    })().catch((error) => {
      failure ??= error instanceof Error ? error : new Error("Permission responder failed")
    })
    await api(`/session/${session}/prompt_async`, {
      model: { providerID: "permission-fixture", modelID: "fixture" },
      parts: [
        {
          type: "text",
          text: "Run the local browser permission fixture.",
          metadata: { tandemCorrectorDisabled: true, tandemRepromptDisabled: true },
        },
      ],
    })
    const deadline = Date.now() + 60000
    while (!inputPermission || Date.now() - inputAskedAt < 22000) {
      if (failure) throw failure
      assert(Date.now() < deadline, "Input approval did not remain pending for 22 seconds")
      if (inputPermission) {
        assert(
          (await api("/permission")).some((item: Wire) => item.id === inputPermission),
          "Input permission disappeared before decision",
        )
        await unchanged()
      }
      await Bun.sleep(150)
    }
    heldMilliseconds = Date.now() - inputAskedAt
    await unchanged()
    assert(observed.ticks >= 400, "Live fixture did not churn during approval hold")
    decisionSent = true
    if (scenario === "deny") await api(`/permission/${inputPermission}/reply`, { reply: "reject" })
    else await api(`/session/${session}/abort`, {})

    const clearDeadline = Date.now() + 5000
    while ((await api("/permission")).some((item: Wire) => item.id === inputPermission)) {
      assert(Date.now() < clearDeadline, "Decided input permission still pending")
      await Bun.sleep(100)
    }
    const late = await request(`/permission/${inputPermission}/reply`, { reply: "once" })
    lateReplyStatus = late.status
    await late.arrayBuffer()
    assert.equal(lateReplyStatus, 404, "Late approval must reject the removed permission ID")
    await pollCleanup(45000)
    await Bun.sleep(1500)
    await unchanged()
    assert.equal(
      (await api("/permission")).filter((item: Wire) => item.sessionID === session).length,
      0,
      "Session permissions not cleared",
    )
    const status = (await api("/session/status"))[session]
    assert(!status || status.type === "idle", "Session still running after cleanup")
    const tools = transcript
      .flatMap((message: Wire) => message.parts ?? [])
      .filter((part: Wire) => part.type === "tool")
    const click = tools.find((part: Wire) => part.callID === `${scenario}-2`)
    assert(click, "Missing durable click settlement")
    settlement = { status: click.state?.status, metadata: click.state?.metadata, error: click.state?.error }
    assert(!tools.some((part: Wire) => ["pending", "running"].includes(part.state?.status)), "Unsettled durable tool")
    if (scenario === "deny") {
      // Legacy SessionProcessor normally stops on RejectedError without asking
      // the provider for a final answer. The durable tool error is the evidence.
      assert.equal(click.state.status, "error", "Rejected tool did not settle as an error")
      assert(click.state.error?.includes("The user rejected permission"), "Missing durable explicit rejection")
      assert(
        step === 3 || (step === 4 && JSON.stringify(transcript).includes(marker)),
        "Unexpected denial continuation",
      )
    } else {
      assert.equal(click.state.status, "completed", "Cancellation lost structured browser outcome")
      const result = JSON.parse(click.state.output)
      assert(
        result.action === "click" && result.outcome === "not_dispatched" && result.code === "cancelled",
        "Cancelled tool did not preserve non-dispatch outcome",
      )
      assert.equal(step, 3, "Aborted turn continued provider execution")
    }
    if (failure) throw failure
  } catch (error) {
    failure ??= error instanceof Error ? error : new Error("Scenario failed")
  } finally {
    if (session && !cleanup) {
      await api(`/session/${session}/abort`, {}).catch(() => undefined)
      await pollCleanup(45000).catch(() => undefined)
    }
    stopping = true
    await responder
    await provider.stop(true)
    await fixture.stop(true)
    await writeFile(join(project, "opencode.json"), JSON.stringify({ permission: { "*": "deny" } }), { mode: 0o600 })
    await writeFile(join(project, "transcript.json"), JSON.stringify(transcript, null, 2), { mode: 0o600 })
    const report = {
      scenario,
      passed: !failure && cleanup,
      session,
      heldMilliseconds,
      lateReplyStatus,
      cleanup,
      approvals,
      observed,
      providerTurns: step,
      settlement,
      error: failure?.message,
    }
    reports.push(report)
    await writeFile(join(project, "acceptance.json"), JSON.stringify(report, null, 2), { mode: 0o600 })
    console.log(
      `${report.passed ? "PASS" : "FAIL"} ${scenario}: hold=${heldMilliseconds}ms late=${lateReplyStatus} clicks=${observed.clicks} cleanup=${cleanup}${failure ? ` error=${failure.message.slice(0, 200)}` : ""}`,
    )
  }
  // Do not start the next browser scenario after a failure or uncertain cleanup.
  if (failure) break
}
const passed = reports.length === 2 && reports.every((item) => item.passed)
await writeFile(join(root, "acceptance.json"), JSON.stringify({ passed, reports }, null, 2), { mode: 0o600 })
console.log(`Evidence: ${join(root, "acceptance.json")}`)
if (!passed) process.exitCode = 1
