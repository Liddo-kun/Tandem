import { spawn } from "node:child_process"
import { chmod, mkdir, mkdtemp, readdir, rm } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { Effect } from "effect"
import { BrowserToolOwner } from "@tandem/chrome-bridge/tools"
import { EXTENSION_ORIGIN } from "../../../chrome-bridge/src/client"
import { MAX_READ_BYTES, MAX_WRITE_BYTES, RpcPeer } from "../../../chrome-bridge/src/native"

type Params = { session_id?: string; tabId?: number; method?: string; keep?: { tabId: number; status: string }[] }

/** Real native host and private Unix IPC; the synthetic extension only supplies tab lifecycle replies. */
export const browserFixture = Effect.gen(function* () {
  const directory = yield* Effect.promise(async () => {
    await mkdir("/tmp/tandem/browser-runtime-tests", { recursive: true, mode: 0o700 })
    const directory = await mkdtemp("/tmp/tandem/browser-runtime-tests/run-")
    await chmod(directory, 0o700)
    return directory
  })
  const calls: { method: string; params: Params }[] = []
  const tabs = new Map<number, { id: number; url: string; attached: boolean; session?: string; agent?: boolean }>()
  let next = 10
  const child = spawn(
    process.execPath,
    [fileURLToPath(new URL("../../../chrome-bridge/src/host.ts", import.meta.url)), EXTENSION_ORIGIN],
    {
      cwd: directory,
      env: { HOME: directory, LANG: "C.UTF-8", TANDEM_CHROME_BRIDGE_RUN_DIR: directory, TMPDIR: directory },
      stdio: ["pipe", "pipe", "pipe"],
    },
  )
  child.stderr.resume()
  const exited = new Promise((resolve) => child.once("exit", resolve))
  const peer = new RpcPeer(child.stdout, child.stdin, {
    maxRead: MAX_WRITE_BYTES,
    maxWrite: MAX_READ_BYTES,
    onRequest: async (method, input) => {
      const params = input as Params
      calls.push({ method, params })
      if (method === "getUserTabs")
        return [...tabs.values()].map((tab) => ({ id: tab.id, url: tab.url, title: "Runtime fixture" }))
      if (method === "createTab") {
        const id = next++
        tabs.set(id, { id, url: "about:blank", attached: false, session: params.session_id, agent: true })
        return { id }
      }
      if (method === "attach") {
        const tab = tabs.get(params.tabId ?? -1)
        if (!tab) throw new Error("Missing fixture tab")
        tab.attached = true
        return
      }
      if (method === "claimUserTab") {
        const tab = tabs.get(params.tabId ?? -1)
        if (!tab) throw new Error("Missing fixture tab")
        tab.session = params.session_id
        return { id: tab.id }
      }
      if (method === "finalizeTabs" || method === "turnEnded") {
        for (const tab of tabs.values()) {
          if (tab.session !== params.session_id) continue
          const keep = params.keep?.find((item) => item.tabId === tab.id)
          if (!keep && tab.agent) tabs.delete(tab.id)
          else {
            tab.attached = false
            if (keep?.status !== "handoff") tab.session = undefined
          }
        }
        return
      }
      if (method === "executeCdp" && params.method === "Target.getTargets")
        return {
          targetInfos: [...tabs.values()].map((tab) => ({
            id: `target-${tab.id}`,
            tabId: tab.id,
            type: "page",
            attached: tab.attached,
            url: tab.url,
          })),
        }
      if (method === "getInfo") return { version: "runtime-fixture" }
      throw new Error("Unsupported fixture method")
    },
  })
  yield* Effect.addFinalizer(() =>
    Effect.promise(async () => {
      peer.close()
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM")
      await Promise.race([exited, Bun.sleep(500)])
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL")
      await exited
      await rm(directory, { recursive: true, force: true })
    }),
  )
  yield* Effect.promise(async () => {
    const deadline = Date.now() + 5000
    while (!(await readdir(directory)).some((name) => /^host-.*\.json$/.test(name))) {
      if (Date.now() >= deadline) throw new Error("Browser host fixture did not start")
      await Bun.sleep(5)
    }
  })
  const connections = [{ id: "fixture", label: "Runtime fixture", directory }]
  const owner = new BrowserToolOwner({ connections })
  yield* Effect.addFinalizer(() => Effect.promise(() => owner.close()).pipe(Effect.asVoid))
  return { owner, directory, calls, tabs, connections }
})
