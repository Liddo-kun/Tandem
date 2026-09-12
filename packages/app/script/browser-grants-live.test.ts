import { test } from "bun:test"
import { expect } from "@playwright/test"
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises"

const connection = process.env.CLIENT_CONNECTION
test.skipIf(!connection)(
  "V2 saved browser grants are listed and revoked through real settings UI",
  async () => {
    const original = JSON.parse(await readFile(connection!, "utf8"))
    const root = await mkdtemp("/tmp/tandem/browser-grants-ui-")
    const projectName = `grants-${root.split("/").pop()}`
    const directory = `${root}/${projectName}`
    await mkdir(directory)
    for (const args of [
      ["init"],
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.test", "commit", "--allow-empty", "-m", root],
    ]) {
      const child = Bun.spawn(["git", ...args], { cwd: directory, stdout: "ignore", stderr: "pipe" })
      const error = await new Response(child.stderr).text()
      if (await child.exited) throw new Error(error)
    }
    const headers = {
      authorization: `Basic ${Buffer.from(`${original.username}:${original.password}`).toString("base64")}`,
      "content-type": "application/json",
    }
    const api = async (pathname: string, body?: unknown) => {
      const response = await Bun.fetch(new URL(pathname, original.backend), {
        headers,
        method: body === undefined ? "GET" : "POST",
        body: body === undefined ? undefined : JSON.stringify(body),
      })
      expect(response.ok).toBe(true)
      if (response.status === 204) return
      return response.json()
    }
    const session = (await api("/api/session", { location: { directory } })).data
    expect(session.projectID).not.toBe("global")
    const fixture = {
      ...original,
      root,
      directory,
      sessionID: session.id,
      ui: `${new URL(original.ui).origin}/${Buffer.from(directory).toString("base64url")}/session/${session.id}`,
    }
    const file = `${root}/connection.json`
    await writeFile(file, JSON.stringify(fixture), { mode: 0o600 })
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, `${import.meta.dir}/browser-live-client.ts`, file, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const stdout = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      if (await child.exited) throw new Error(error)
      return stdout
    }
    const resource = ["fixture", "read", "https://grant-ui.example.test", "https://frame.example.test"]
      .map((value) => Buffer.from(value).toString("hex"))
      .join(":")
    const ask = async () =>
      api(`/api/session/${session.id}/permission`, {
        action: "browser",
        resources: [resource],
        save: [resource],
        metadata: { browser: "Fixture", capability: "read", origin: "https://grant-ui.example.test" },
      })
    if (process.env.CLIENT_ELECTRON === "1") {
      // Configure only this isolated desktop profile through its real native persistence API.
      const script = `(async()=>{const key=(await window.api.storeKeys('opencode.global.dat')).find(x=>x==='server');const state=JSON.parse(await window.api.storeGet('opencode.global.dat',key));state.projects[${JSON.stringify(original.backend.replace(/\/$/, ""))}]=[{worktree:${JSON.stringify(directory)},expanded:true}];await window.api.storeSet('opencode.global.dat','server',JSON.stringify(state));localStorage.clear();return true})()`
      await run("eval", script)
      await run("reload")
      await run(
        "wait",
        `document.querySelector('[aria-label="Recent sessions"]')?.textContent.includes(${JSON.stringify(projectName)})`,
      )
      await run("select", `New session ${projectName}`)
      expect(
        await run("eval", "location.protocol === 'oc:' && typeof window.api?.awaitInitialization === 'function'"),
      ).toContain("true")
    } else await run("open")
    await run("wait", "!!document.querySelector('h1')")
    expect((await ask()).data.effect).toBe("ask")
    await run("wait", "[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Allow always')")
    await run("decide", "Allow always")
    const saved = (await api(`/api/permission/saved?projectID=${session.projectID}`)).data
    expect(saved).toHaveLength(1)
    await run("press", "Control+,")
    await run("grant-tab")
    await run(
      "wait",
      "document.querySelector('[data-component=browser-grants]')?.textContent.includes('fixture / read')",
    )
    const text = await run("eval", "document.querySelector('[data-component=browser-grants]').textContent")
    expect(text).toContain("https://grant-ui.example.test")
    expect(text).toContain("Frame origin: https://frame.example.test")
    expect(text).not.toContain(resource)
    await run("screenshot", "saved-browser-grants")
    await run("decide", "Remove grant")
    await run(
      "wait",
      "document.querySelector('[data-component=browser-grants]')?.textContent.includes('No saved browser grants for this project.')",
    )
    expect((await api(`/api/permission/saved?projectID=${session.projectID}`)).data).toEqual([])
    await run("screenshot", "saved-browser-grants-removed")
    await run("press", "Escape")
    expect((await ask()).data.effect).toBe("ask")
    await run("wait", "[...document.querySelectorAll('button')].some(x=>x.textContent.trim()==='Allow once')")
    await run("screenshot", "permission-after-ui-revocation")
    await run("decide", "Dismiss")
    await writeFile(
      `${root}/result.json`,
      JSON.stringify({
        platform: process.env.CLIENT_ELECTRON === "1" ? "Electron actual wrapper" : "web",
        projectID: session.projectID,
        sessionID: session.id,
        grantRemovedThroughUI: true,
        promptedAgain: true,
      }),
      { mode: 0o600 },
    )
    console.log(`Private grant UI evidence: ${root}`)
  },
  120000,
)
