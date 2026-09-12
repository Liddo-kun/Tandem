import assert from "node:assert/strict"
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { spawn } from "node:child_process"

// Scripted provider pattern from original-session-acceptance.ts. HTTP is the
// only tool entrypoint; CDP is used solely to close the explicitly private browser.
const root = "/tmp/tandem/chrome-bridge/original-repair-b"
const server = "http://127.0.0.1:4107"
const browser = "original-fixture"
process.umask(0o077)
const project = await mkdtemp("/tmp/tandem/reopen-acceptance-")
type Wire = Record<string, any>
let phase = 0,
  step = 0
let lastID = "",
  session = "",
  tab = "",
  oldTab = ""
let failure: unknown
let stopping = false
let pngBytes = 0
let browserProcess: ReturnType<typeof spawn> | undefined
let browserExit: Promise<unknown> | undefined
const outcomes: Wire[] = []
const clicks: Record<string, number> = {}
const incarnations: Wire[] = []
const transcripts: Wire[] = []
let preserved: Record<string, string> = {}
let serverProcess: Wire | undefined

async function wait(check: () => Promise<boolean>, label: string, ms = 30000) {
  const until = Date.now() + ms
  while (!(await check())) {
    if (failure) throw failure
    assert(Date.now() < until, `Timed out: ${label}`)
    await Bun.sleep(100)
  }
}
async function api(path: string, body?: unknown) {
  const url = new URL(path, server)
  url.searchParams.set("directory", project)
  const response = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  })
  assert(response.ok, `${path}: HTTP ${response.status}`)
  const text = await response.text()
  return text ? JSON.parse(text) : undefined
}
async function journals() {
  return Object.fromEntries(
    await Promise.all(
      (await readdir(root))
        .filter((name) => /^journal-.*\.json$/.test(name))
        .map(async (name) => [name, await readFile(join(root, name), "utf8")]),
    ),
  )
}
async function launch() {
  // Refuse a live fixture rather than forwarding args to an existing browser.
  const processes = await readdir("/proc")
  for (const pid of processes.filter((name) => /^\d+$/.test(name))) {
    const args = await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")
    assert(!args.split("\0").includes(`--user-data-dir=${root}/home/.config/chromium`), "Fixture already running")
  }
  browserProcess = spawn(
    "timeout",
    ["--kill-after=5s", "600s", join(root, "launch-browser"), "--remote-debugging-port=0"],
    { stdio: "ignore", detached: true },
  )
  browserProcess.unref()
  browserExit = new Promise((resolve) => browserProcess!.once("exit", resolve))
  await wait(async () => {
    for (const name of (await readdir(root)).filter((name) => /^host-.*\.json$/.test(name))) {
      const data = JSON.parse(await readFile(join(root, name), "utf8"))
      const args = await readFile(`/proc/${data.parentPid}/cmdline`, "utf8").catch(() => "")
      if (!args.split("\0").includes(`--user-data-dir=${root}/home/.config/chromium`)) continue
      if (incarnations.some((item) => item.epoch === data.epoch)) continue
      assert(args.includes("--remote-debugging-port=0"))
      incarnations.push(data)
      return true
    }
    return false
  }, "private native host publication")
}
async function closeBrowser() {
  const discovery = incarnations.at(-1)!
  const args = (await readFile(`/proc/${discovery.parentPid}/cmdline`, "utf8")).split("\0")
  assert(args.includes(`--user-data-dir=${root}/home/.config/chromium`))
  const [port, path] = (await readFile(join(root, "home/.config/chromium/DevToolsActivePort"), "utf8"))
    .trim()
    .split("\n")
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`)
  await new Promise<void>((resolve, reject) => {
    socket.onopen = () => {
      socket.send(JSON.stringify({ id: 1, method: "Browser.close" }))
      resolve()
    }
    socket.onerror = () => reject(new Error("Private browser close failed"))
  })
  await Promise.race([
    browserExit,
    Bun.sleep(10000).then(() => {
      throw new Error("Browser did not exit")
    }),
  ])
  socket.close()
  await wait(async () => !(await Bun.file(`/proc/${discovery.pid}/cmdline`).exists()), "native host exit")
}
const fixture = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === "/clicked") {
      const epoch = url.searchParams.get("epoch")!
      clicks[epoch] = (clicks[epoch] ?? 0) + 1
      return new Response("ok")
    }
    const epoch = url.searchParams.get("epoch")!
    return new Response(
      `<!doctype html><title>Reopen fixture ${epoch}</title>
    <button id="click" onclick="fetch('/clicked?epoch=${epoch}');this.textContent='Clicked'">Click once</button>`,
      { headers: { "content-type": "text/html" } },
    )
  },
})
const provider = Bun.serve({
  hostname: "127.0.0.1",
  port: 0,
  async fetch(request) {
    try {
      const body = (await request.json()) as Wire
      let result: Wire | undefined
      if (step) {
        const message = body.messages?.findLast((item: Wire) => item.role === "tool" && item.tool_call_id === lastID)
        assert(message, "Missing current tool result")
        const text =
          typeof message.content === "string"
            ? message.content
            : message.content.map((item: Wire) => item.text ?? "").join("")
        result = JSON.parse(text)
        outcomes.push({ phase, step, ...result })
      }
      let input: Wire | undefined
      if (phase === 0) {
        if (result) assert(!result.code, JSON.stringify(result))
        if (step === 0) input = { action: "create", url: `${fixture.url}?epoch=${phase}` }
        if (step === 1) {
          tab = result!.tab
          input = { action: "inspect", tab }
        }
        if (step === 2) {
          assert(result!.text.includes("Click once"))
          input = { action: "click", tab, selector: "#click" }
        }
        if (step === 3) input = { action: "screenshot", tab }
        if (step === 4) {
          const image = JSON.stringify(body).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
          assert(image, "PNG did not reach provider")
          pngBytes = Buffer.from(image[1]!, "base64").length
          assert(pngBytes > 100)
          input = { action: "keep", tab, disposition: "handoff" }
        }
      } else if (phase === 1) {
        if (step === 0) input = { action: "resume" }
        if (step === 1) {
          assert.equal(result!.tabs.length, 1)
          tab = result!.tabs[0]
          input = { action: "inspect", tab }
        }
        if (step === 2) {
          assert.equal(result!.outcome, "confirmed")
          oldTab = tab
          await closeBrowser()
          input = { action: "inspect", tab }
        }
        if (step === 3) assert.equal(result!.code, "stale_handle")
      } else if (phase === 2) {
        if (step === 0) input = { action: "discover" }
        if (step === 1) assert.equal(result!.code, "browser_unavailable")
      } else if (phase === 4) {
        if (step === 0) input = { action: "inspect", tab: oldTab }
        if (step === 1) {
          assert.equal(result!.code, "stale_handle")
          input = { action: "create", url: `${fixture.url}?epoch=4` }
        }
        if (step === 2) {
          assert.equal(result!.outcome, "confirmed")
          tab = result!.tab
          assert.notEqual(tab, oldTab)
          input = { action: "inspect", tab }
        }
        if (step === 3) {
          assert(result!.text.includes("Click once"))
          input = { action: "click", tab, selector: "#click" }
        }
        if (step === 4) {
          assert.equal(result!.outcome, "confirmed")
          input = { action: "screenshot", tab }
        }
        if (step === 5) {
          const image = JSON.stringify(body).match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)
          assert(image)
          pngBytes = Buffer.from(image[1]!, "base64").length
          assert(pngBytes > 100)
          input = { action: "keep", tab, disposition: "deliverable" }
        }
        if (step === 6) assert.equal(result!.outcome, "not_dispatched")
      }
      if (input) input.browser = browser
      lastID = `reopen-${phase}-${step++}`
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
        : { role: "assistant", content: `REOPEN_DONE_${phase}` }
      return new Response(
        `data: ${JSON.stringify({ id: lastID, object: "chat.completion.chunk", created: 0, model: "fixture", choices: [{ index: 0, delta, finish_reason: input ? "tool_calls" : "stop" }] })}\n\ndata: [DONE]\n\n`,
        { headers: { "content-type": "text/event-stream" } },
      )
    } catch (error) {
      failure = error
      return Response.json({ error: { message: String(error) } }, { status: 400 })
    }
  },
})
let responder: Promise<void> | undefined
try {
  for (const pid of (await readdir("/proc")).filter((name) => /^\d+$/.test(name))) {
    const args = (await readFile(`/proc/${pid}/cmdline`, "utf8").catch(() => "")).split("\0")
    if (
      !/(?:^|\/)(?:bun|opencode)$/.test(args[0] ?? "") ||
      !args.includes("serve") ||
      args[args.indexOf("--port") + 1] !== "4107"
    )
      continue
    const env = Object.fromEntries(
      (await readFile(`/proc/${pid}/environ`, "utf8"))
        .split("\0")
        .filter((item) => item.includes("="))
        .map((item) => [item.slice(0, item.indexOf("=")), item.slice(item.indexOf("=") + 1)]),
    )
    assert.deepEqual(
      JSON.parse(env.TANDEM_CHROME_CONNECTIONS!).map((item: Wire) => ({ id: item.id, directory: item.directory })),
      [{ id: browser, directory: root }],
      "Second server must have ONLY the isolated binding",
    )
    assert.equal(env.TANDEM_BROWSER_FETCH, "0")
    assert(!serverProcess, "Ambiguous second server")
    serverProcess = { pid, args, stat: await readFile(`/proc/${pid}/stat`, "utf8") }
  }
  assert(serverProcess, "Exact isolated server4107 process not found")
  await writeFile(
    join(project, "opencode.json"),
    JSON.stringify({
      model: "reopen/fixture",
      small_model: "reopen/fixture",
      permission: { "*": "deny", browser: "ask" },
      provider: {
        reopen: {
          name: "Local reopen acceptance",
          env: [],
          npm: "@ai-sdk/openai-compatible",
          options: { baseURL: new URL("v1", provider.url).href, apiKey: "fixture" },
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
    { flag: "wx", mode: 0o600 },
  )
  await api("/global/health")
  await launch()
  session = (await api("/session", { title: "Chromium close/reopen recovery acceptance" })).id
  responder = (async () => {
    while (!stopping) {
      for (const permission of await api("/permission")) {
        if (permission.sessionID !== session) continue
        assert.equal(permission.permission, "browser")
        await api(`/permission/${permission.id}/reply`, { reply: "once" })
      }
      await Bun.sleep(100)
    }
  })().catch((error) => {
    failure = error
  })
  for (phase of [0, 1, 2, 4]) {
    step = 0
    if (phase === 4) {
      preserved = await journals()
      assert(
        Object.values(preserved).some((text) => JSON.parse(text).sessions.length > 0),
        "No historical uncertain lease",
      )
      await launch()
      assert.notEqual(incarnations[0]!.epoch, incarnations[1]!.epoch)
      assert.notEqual(incarnations[0]!.parentPid, incarnations[1]!.parentPid)
    }
    await api(`/session/${session}/prompt_async`, {
      model: { providerID: "reopen", modelID: "fixture" },
      parts: [
        {
          type: "text",
          text: `Run reopen phase ${phase} in this same chat.`,
          metadata: { tandemCorrectorDisabled: true, tandemRepromptDisabled: true },
        },
      ],
    })
    await wait(
      async () => {
        const messages = await api(`/session/${session}/message`)
        const text = JSON.stringify(messages)
        if (!text.includes(`REOPEN_DONE_${phase}`)) return false
        const status = await api("/session/status")
        if (status[session] && status[session].type !== "idle") return false
        transcripts.push({ phase, messages })
        return true
      },
      `HTTP phase ${phase}`,
      90000,
    )
    if (phase === 1) assert(JSON.stringify(transcripts.at(-1)).includes("cleanup_unconfirmed"))
    if (phase === 4) {
      const messages = transcripts.at(-1)!.messages
      const latest = JSON.stringify(messages.filter((message: Wire) => message.info?.role === "assistant").slice(-1))
      assert(latest.includes("Browser cleanup: confirmed;"), "Fresh cleanup not confirmed")
      assert(latest.includes("nativeConfirmed=true"), "Fresh native cleanup not confirmed")
      for (const [name, text] of Object.entries(preserved)) assert.equal(await readFile(join(root, name), "utf8"), text)
    }
  }
  assert.deepEqual(clicks, { "0": 1, "4": 1 })
  assert.equal(
    (await readFile(`/proc/${serverProcess.pid}/stat`, "utf8")).split(") ")[1]!.split(" ")[19],
    serverProcess.stat.split(") ")[1].split(" ")[19],
    "Server restarted during acceptance",
  )
} catch (error) {
  failure ??= error
} finally {
  stopping = true
  await responder
  if (session && failure) await api(`/session/${session}/abort`, {}).catch(() => {})
  await writeFile(
    join(project, "acceptance.json"),
    JSON.stringify(
      {
        passed: !failure,
        failure: failure ? String(failure) : undefined,
        server,
        serverProcess,
        browser,
        project,
        session,
        incarnations,
        clicks,
        pngBytes,
        preservedJournals: Object.keys(preserved),
        outcomes,
        transcripts,
      },
      null,
      2,
    ),
  )
  provider.stop(true)
  fixture.stop(true)
  console.log(
    JSON.stringify({
      passed: !failure,
      report: join(project, "acceptance.json"),
      failure: failure ? String(failure) : undefined,
    }),
  )
}
if (failure) process.exitCode = 1
