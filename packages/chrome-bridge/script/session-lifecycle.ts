import assert from "node:assert/strict"
import { readFile, writeFile } from "node:fs/promises"

export const lifecycleCases = [
  "normal",
  "provider-failure",
  "tool-failure",
  "stop",
  "retained-provider-failure",
  "copied-alias",
  "fork-alias",
  "subagent-alias",
  "steering",
  "admission-retry",
  "duplicate-delivery",
  "text-only",
  "stale-capture",
  "denied-keep",
  "shutdown",
  "provider-retry",
  "lost-result",
] as const
export type LifecycleCase = (typeof lifecycleCases)[number]

// Only the provider is scripted: calls still traverse the real runtime, permissions,
// native host and unmodified extension. Counts are deltas, not aggregate guesses.
export async function lifecycleScenario(directory: string, name: LifecycleCase, copied?: string, pageURL?: string) {
  if (name === "lost-result")
    await writeFile(
      `${directory}/native-fault.json`,
      JSON.stringify({ cdp: "Input.dispatchMouseEvent", inputType: "mouseReleased" }),
      { mode: 0o600 },
    )
  const native = async () =>
    (await readFile(`${directory}/native-dispatch.jsonl`, "utf8"))
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
  const before = (await native()).length
  let turns = 0
  let tab: string | undefined
  let view: unknown
  let operation: unknown
  let ready = false
  let release: (() => void) | undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const requests: unknown[] = []
  const results: Record<string, unknown>[] = []
  const response = (input?: Record<string, unknown>, tool = "browser") => {
    const delta = input
      ? {
          tool_calls: [
            {
              index: 0,
              id: `${name}-${turns}`,
              type: "function",
              function: { name: tool, arguments: JSON.stringify(input) },
            },
          ],
        }
      : { content: "Lifecycle fixture finished without retry." }
    if (name === "duplicate-delivery" && turns === 1 && "tool_calls" in delta && delta.tool_calls?.[0])
      delta.tool_calls.push({ ...delta.tool_calls[0], index: 1 })
    const chunk = (delta: unknown, finish_reason: string | null) => ({
      id: "lifecycle",
      object: "chat.completion.chunk",
      created: 1,
      model: "fixture",
      choices: [{ index: 0, delta, finish_reason }],
    })
    return new Response(
      [chunk(delta, null), chunk({}, input ? "tool_calls" : "stop")]
        .map((item) => `data: ${JSON.stringify(item)}\n\n`)
        .join("") + "data: [DONE]\n\n",
      { headers: { "content-type": "text/event-stream" } },
    )
  }
  return {
    get ready() {
      return ready
    },
    get tab() {
      return tab
    },
    release: () => release?.(),
    async wait() {
      const deadline = Date.now() + 15000
      while (!ready) {
        assert(Date.now() < deadline, "Provider never reached the controlled lifecycle boundary")
        await Bun.sleep(10)
      }
    },
    async fetch(body: unknown) {
      requests.push(body)
      const visit = (value: unknown): void => {
        if (typeof value === "string") {
          try {
            const parsed = JSON.parse(value)
            if (parsed?.action && parsed?.outcome) results.push(parsed)
          } catch {
            /* Non-JSON prompt text. */
          }
        } else if (Array.isArray(value)) value.forEach(visit)
        else if (value && typeof value === "object") Object.values(value).forEach(visit)
      }
      visit(body)
      await writeFile(`${directory}/scenario-${name}-provider.json`, JSON.stringify({ requests, results }, null, 2), {
        mode: 0o600,
      })
      const latest = results.at(-1)
      if (typeof latest?.tab === "string") tab = latest.tab
      turns++
      if (name === "subagent-alias") {
        if (turns === 1)
          return response(
            {
              description: "Check foreign browser alias",
              subagent_type: "general",
              prompt: `Attempt exactly one browser inspect with browser fixture and tab ${copied}. Do not create or claim a tab.`,
            },
            "task",
          )
        if (turns === 2) return response({ action: "inspect", browser: "fixture", tab: copied })
        return response()
      }
      if (turns === 1)
        return response(
          name === "copied-alias" || name === "fork-alias"
            ? { action: "inspect", browser: "fixture", tab: copied }
            : {
                action: "create",
                browser: "fixture",
                ...(name === "stale-capture" || name === "lost-result" || name === "provider-retry"
                  ? { url: pageURL }
                  : {}),
              },
        )
      if (name === "provider-failure" || (name === "retained-provider-failure" && turns === 3))
        return new Response("Intentional nonretryable lifecycle provider failure", { status: 400 })
      if ((name === "retained-provider-failure" || name === "denied-keep") && turns === 2)
        return response({ action: "keep", browser: "fixture", tab, disposition: "handoff" })
      if (name === "tool-failure" && turns === 2)
        return response({ action: "inspect", browser: "fixture", tab: "forged-runtime-alias" })
      if (name === "stop" || name === "shutdown" || name === "admission-retry") {
        ready = true
        await gate
      }
      if (name === "steering" && turns === 2) {
        ready = true
        await gate
        return response({ action: "inspect", browser: "fixture", tab })
      }
      if (name === "text-only" && turns === 2) return response({ action: "screenshot", browser: "fixture", tab })
      if (name === "stale-capture") {
        if (turns === 2) return response({ action: "screenshot", browser: "fixture", tab })
        if (turns === 3) {
          assert.equal(latest?.viewValid, true, JSON.stringify(latest))
          view = latest?.view
          return response({ action: "screenshot", browser: "fixture", tab })
        }
        if (turns === 4) return response({ action: "click", browser: "fixture", tab, view, x: 1, y: 1 })
      }
      if (name === "lost-result" || name === "provider-retry") {
        if (turns === 2) return response({ action: "inspect", browser: "fixture", tab })
        if (turns === 3) {
          const elements = latest?.elements
          assert(Array.isArray(elements))
          const button = elements.find((item) => item.tag === "button")
          assert(button)
          return response({ action: "click", browser: "fixture", tab, ref: button.ref })
        }
        if (turns === 4) {
          if (name === "provider-retry")
            return new Response("Intentional retryable provider failure after confirmed click", { status: 503 })
          assert.equal(latest?.outcome, "unknown", JSON.stringify(latest))
          operation = latest?.operation
          assert.equal(typeof operation, "string")
          return response({ action: "status", browser: "fixture", operation })
        }
      }
      return response()
    },
    async finish(artifacts: string, transcript: unknown, exit: string, effects: unknown[] = []) {
      const allDispatch = (await native()).slice(before)
      const shutdownSession =
        name === "shutdown" ? allDispatch.find((item) => item.method === "createTab")?.session : undefined
      const dispatch = shutdownSession ? allDispatch.filter((item) => item.session === shutdownSession) : allDispatch
      const counts = Object.fromEntries(
        [...new Set(dispatch.map((item) => item.cdp ?? item.method))].map((method) => [
          method,
          dispatch.filter((item) => (item.cdp ?? item.method) === method).length,
        ]),
      )
      const serialized = JSON.stringify(transcript)
      const report = {
        name,
        exit,
        turns,
        counts,
        dispatch,
        allDispatch,
        transcript,
        results,
        requests,
        effects,
        passed: false,
      }
      await writeFile(`${artifacts}/lifecycle-${name}.json`, JSON.stringify(report, null, 2), { mode: 0o600 })
      if (name === "duplicate-delivery" && exit === "Failure") {
        assert.equal(dispatch.length, 0, "Rejected duplicate input must not dispatch native work")
        assert(serialized.includes("Provider stream failed"))
        assert(!serialized.includes('"status":"pending"') && !serialized.includes('"status":"running"'))
        await writeFile(
          `${artifacts}/lifecycle-${name}.json`,
          JSON.stringify(
            {
              ...report,
              passed: true,
              disposition: "Explicit rejection before native dispatch, with durable pending input settled",
            },
            null,
            2,
          ),
          { mode: 0o600 },
        )
        return
      }
      assert.equal(
        counts.createTab ?? 0,
        name === "copied-alias" || name === "fork-alias" || name === "subagent-alias" ? 0 : 1,
      )
      assert.equal(counts["Input.insertText"] ?? 0, 0)
      assert.equal(counts["Input.dispatchMouseEvent"] ?? 0, name === "lost-result" || name === "provider-retry" ? 2 : 0)
      assert.equal(
        new Set(dispatch.flatMap((item) => (item.turn && item.cdp !== "Target.getTargets" ? [item.turn] : []))).size,
        1,
        "One runtime execution must own one browser turn",
      )
      assert(
        serialized.includes(
          name === "denied-keep" || name === "lost-result"
            ? "Browser cleanup: cleanup_unconfirmed"
            : "Browser cleanup: confirmed",
        ),
        "Missing awaited cleanup transcript",
      )
      if (name === "retained-provider-failure") {
        assert.equal(counts.finalizeTabs, 1)
        assert.equal(counts.turnEnded ?? 0, 0)
      } else if (name === "denied-keep" || name === "lost-result") {
        assert.equal(counts.finalizeTabs ?? 0, 0)
        assert.equal(counts.turnEnded ?? 0, 0, "Denied keep must not destructively fall back to an empty keep list")
      } else assert.equal(counts.turnEnded, 1)
      if (name === "tool-failure" || name === "copied-alias" || name === "fork-alias" || name === "subagent-alias")
        assert(
          results.some((item) => item.outcome === "not_dispatched"),
          "Alias failure was not projected to provider",
        )
      if (name.includes("provider-failure"))
        assert(serialized.toLowerCase().includes("error") || exit === "Failure", "Primary provider error missing")
      if (name === "steering")
        assert(
          JSON.stringify(requests.at(-1)).includes("LIFECYCLE_STEER_SENTINEL"),
          "Steering not promoted into provider history",
        )
      if (name === "text-only") {
        assert.equal(counts["Page.captureScreenshot"] ?? 0, 0)
        assert(results.some((item) => item.code === "unsupported_modality" && item.outcome === "not_dispatched"))
      }
      if (name === "stale-capture") {
        assert.equal(counts["Page.captureScreenshot"], 2)
        assert(results.some((item) => item.code === "stale_handle" && item.outcome === "not_dispatched"))
      }
      if (name === "lost-result") {
        assert.deepEqual(JSON.parse(await readFile(`${directory}/native-fault-dropped.json`, "utf8")), {
          responseDropped: true,
          nativeReplyWasError: false,
        })
        assert(
          results.some(
            (item) => item.action === "status" && item.operation === operation && item.outcome === "unknown",
          ),
        )
        assert.equal(dispatch.filter((item) => item.inputType === "mousePressed").length, 1)
        assert.equal(dispatch.filter((item) => item.inputType === "mouseReleased").length, 1)
      }
      if (name === "lost-result" || name === "provider-retry") {
        const clicks = effects.filter(
          (item) => item && typeof item === "object" && "kind" in item && item.kind === "click",
        )
        assert.equal(clicks.length, 1, "Exactly one trusted submit in this scenario, with no automatic replay")
        const click = clicks.at(-1)
        assert(
          click &&
            typeof click === "object" &&
            "clicks" in click &&
            click.clicks === 1 &&
            "trusted" in click &&
            click.trusted === true,
        )
      }
      if (name === "provider-retry") assert.equal(turns, 5, "The provider must actually retry after the injected 503")
      if (name === "admission-retry")
        assert.equal(turns, 2, "Exact prompt retry and concurrent resume must not execute another provider turn")
      await writeFile(`${artifacts}/lifecycle-${name}.json`, JSON.stringify({ ...report, passed: true }, null, 2), {
        mode: 0o600,
      })
    },
  }
}
