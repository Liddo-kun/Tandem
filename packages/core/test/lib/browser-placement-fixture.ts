import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"

export type PlacementPlan = {
  mode: "retry" | "hold" | "foreign" | "create" | "task"
  alias?: string
  tab?: string
  ready: boolean
  attempts: { hash: string; status: number; body: unknown }[]
  results: Record<string, unknown>[]
  release: () => void
}

export async function browserPlacementFixture(directory: string) {
  assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
  const artifacts = `${directory}/placement`
  await mkdir(artifacts, { mode: 0o700 })
  const plans = new Map<string, PlacementPlan>()
  const effects: unknown[] = []
  const errors: string[] = []
  const commands: unknown[] = []
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request): Promise<Response> {
      const path = new URL(request.url).pathname
      if (path === "/page")
        return new Response(
          `<!doctype html><button>Submit once</button><output>0</output><script>let n=0;document.querySelector('button').onclick=e=>{document.querySelector('output').textContent=String(++n);fetch('/effect',{method:'POST',body:JSON.stringify({trusted:e.isTrusted,clicks:n})})}</script>`,
          { headers: { "content-type": "text/html" } },
        )
      if (path === "/effect") {
        effects.push(await request.json())
        return new Response("ok")
      }
      if (path !== "/v1/chat/completions") return new Response("not found", { status: 404 })
      try {
        const id = request.headers.get("x-session-id")
        assert(id, "Production runner session header missing")
        const plan = plans.get(id)
        assert(plan, `Unexpected session ${id}`)
        const body = await request.json()
        const visit = (value: unknown): void => {
          if (typeof value === "string") {
            try {
              const parsed = JSON.parse(value)
              if (parsed?.action && parsed?.outcome) plan.results.push(parsed)
            } catch {
              /* Ordinary prompt text. */
            }
          } else if (Array.isArray(value)) value.forEach(visit)
          else if (value && typeof value === "object") Object.values(value).forEach(visit)
        }
        visit(body)
        const latest = plan.results.at(-1)
        if (typeof latest?.tab === "string") plan.tab = latest.tab
        const turn = plan.attempts.length + 1
        const status = plan.mode === "retry" && turn === 4 ? 503 : 200
        plan.attempts.push({ hash: createHash("sha256").update(JSON.stringify(body)).digest("hex"), status, body })
        await writeFile(
          `${artifacts}/${id}-provider.json`,
          JSON.stringify({ mode: plan.mode, attempts: plan.attempts, results: plan.results }, null, 2),
          { mode: 0o600 },
        )
        if (status === 503)
          return new Response("Intentional retryable failure after confirmed browser click", {
            status,
            headers: { "retry-after-ms": "25" },
          })
        let input: Record<string, unknown> | undefined
        let tool = "browser"
        if (turn === 1) {
          if (plan.mode === "task") {
            tool = "task"
            input = {
              description: "Inspect parent browser alias",
              subagent_type: "general",
              prompt: `Inspect browser fixture tab ${plan.alias}; do not create tabs`,
            }
          } else
            input =
              plan.mode === "foreign"
                ? { action: "inspect", browser: "fixture", tab: plan.alias }
                : {
                    action: "create",
                    browser: "fixture",
                    ...(plan.mode === "retry" ? { url: `${server.url}page` } : {}),
                  }
        } else if (plan.mode === "retry" && turn === 2) input = { action: "inspect", browser: "fixture", tab: plan.tab }
        else if (plan.mode === "retry" && turn === 3) {
          assert(Array.isArray(latest?.elements))
          const button = latest.elements.find((item) => item.tag === "button")
          assert(button)
          input = { action: "click", browser: "fixture", tab: plan.tab, ref: button.ref }
        } else if (plan.mode === "hold") {
          plan.ready = true
          await gates.get(id)
        }
        const delta = input
          ? {
              tool_calls: [
                {
                  index: 0,
                  id: `placement-${turn}`,
                  type: "function",
                  function: { name: tool, arguments: JSON.stringify(input) },
                },
              ],
            }
          : { content: "Placement fixture finished without browser replay." }
        const chunk = (delta: unknown, finish_reason: string | null) => ({
          id: "placement-fixture",
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
      } catch (error) {
        errors.push(String(error))
        await writeFile(`${artifacts}/provider-errors.json`, JSON.stringify(errors))
        return new Response("Fixture assertion failed", { status: 400 })
      }
    },
  })
  const gates = new Map<string, Promise<void>>()
  for (const project of ["a", "b"]) {
    const path = `${artifacts}/${project}`
    await mkdir(path, { mode: 0o700 })
    await writeFile(
      `${path}/opencode.json`,
      JSON.stringify({
        snapshots: false,
        providers: {
          fixture: {
            name: "Local placement fixture",
            api: { type: "aisdk", package: "@ai-sdk/openai-compatible", url: `${server.url}v1`, settings: {} },
            models: {
              fixture: {
                name: "Fixture",
                capabilities: { tools: true, input: ["text", "image"], output: ["text"] },
                limit: { context: 100000, output: 10000 },
              },
            },
          },
        },
        agents: {
          allowed: {
            mode: "primary",
            permissions: [
              { action: "*", resource: "*", effect: "deny" },
              { action: "browser", resource: "*", effect: "allow" },
            ],
          },
          unapproved: { mode: "primary", permissions: [{ action: "*", resource: "*", effect: "allow" }] },
        },
      }),
      { mode: 0o600 },
    )
    for (const args of [
      ["git", "init", path],
      [
        "git",
        "-C",
        path,
        "-c",
        "user.name=Fixture",
        "-c",
        "user.email=fixture@invalid",
        "-c",
        "commit.gpgsign=false",
        "commit",
        "--allow-empty",
        "-m",
        `Isolated placement project ${project}`,
      ],
    ]) {
      const child = Bun.spawn(["timeout", "10s", ...args], { stdout: "ignore", stderr: "pipe" })
      const code = await child.exited
      commands.push({ args, code })
      assert.equal(code, 0, await new Response(child.stderr).text())
    }
  }
  return {
    directory,
    artifacts,
    commands,
    effects,
    errors,
    plan(id: string, mode: PlacementPlan["mode"], alias?: string) {
      let release = () => {}
      gates.set(
        id,
        new Promise<void>((resolve) => {
          release = resolve
        }),
      )
      const plan: PlacementPlan = { mode, alias, ready: false, attempts: [], results: [], release }
      plans.set(id, plan)
      return plan
    },
    async native() {
      const text = await readFile(`${directory}/native-dispatch.jsonl`, "utf8").catch(() => "")
      return text.trim()
        ? text
            .trim()
            .split("\n")
            .map((line) => JSON.parse(line))
        : []
    },
    close() {
      for (const plan of plans.values()) plan.release()
      server.stop(true)
    },
  }
}
