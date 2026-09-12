import { test } from "bun:test"
import { expect } from "@playwright/test"
import { readFile, writeFile } from "node:fs/promises"

const connection = process.env.CLIENT_CONNECTION
test.skipIf(!connection)(
  "real V2 app permission replies, cancellation, saved grants and authenticated PNG",
  async () => {
    const fixture = JSON.parse(await readFile(connection!, "utf8"))
    const run = async (...args: string[]) => {
      const child = Bun.spawn([process.execPath, `${import.meta.dir}/browser-live-client.ts`, connection!, ...args], {
        stdout: "pipe",
        stderr: "pipe",
      })
      const output = await new Response(child.stdout).text()
      const error = await new Response(child.stderr).text()
      expect(await child.exited, error).toBe(0)
      return output
    }
    const headers = {
      authorization: `Basic ${Buffer.from(`${fixture.username}:${fixture.password}`).toString("base64")}`,
      "content-type": "application/json",
    }
    const api = async (url: string, init: RequestInit = {}) => {
      const response = await Bun.fetch(new URL(url, fixture.backend), { ...init, headers })
      expect(response.ok).toBe(true)
      return response.status === 204 ? undefined : response.json()
    }
    const pending = async () => (await api(`/api/session/${fixture.sessionID}/permission`)).data
    const button = (label: string) =>
      `[...document.querySelectorAll('button')].find(x=>x.textContent.trim()===${JSON.stringify(label)})`
    const ask = async (capability: string) => {
      const result = JSON.parse(await run("ask", capability))
      await run("wait", `!!(${button("Allow once")})`)
      expect((await pending()).some((item: { id: string }) => item.id === result.id)).toBe(true)
      return result.id
    }
    const decide = async (label: string) => {
      await run("decide", label)
      await run("wait", `!(${button("Allow once")})`)
      expect(await pending()).toEqual([])
    }
    if (process.env.CLIENT_ELECTRON === "1") {
      expect(
        await run("eval", "location.protocol === 'oc:' && typeof window.api?.awaitInitialization === 'function'"),
      ).toContain("true")
    } else await run("open")
    await run("wait", "!!document.querySelector('[data-component=browser-capture] img')?.naturalWidth")
    const image = JSON.parse(
      await run(
        "eval",
        "JSON.stringify([...document.querySelectorAll('[data-component=browser-capture] img')].map(x=>({blob:x.src.startsWith('blob:'),width:x.naturalWidth,height:x.naturalHeight})))",
      ),
    )
    // agent-browser renders eval strings as JSON strings.
    const images = typeof image === "string" ? JSON.parse(image) : image
    const capture = JSON.parse(await readFile(`${fixture.root}/capture.json`, "utf8"))
    expect(images).toEqual([{ blob: true, width: capture.width, height: capture.height }])
    const imagePath = `/api/browser-media/${fixture.sessionID}/${capture.uri.split(":")[1]}`
    expect((await Bun.fetch(new URL(imagePath, fixture.backend))).status).toBe(401)
    expect(
      (await Bun.fetch(new URL(imagePath.replace(fixture.sessionID, "ses_foreign"), fixture.backend), { headers }))
        .status,
    ).toBe(404)
    const png = await Bun.fetch(new URL(imagePath, fixture.backend), { headers })
    expect(png.status).toBe(200)
    expect(png.headers.get("content-type")).toContain("image/png")
    expect(png.headers.get("cache-control")).toBe("no-store")
    await run("screenshot", "web-authenticated-image")
    const once = await ask("read-once")
    await run("screenshot", "web-permission-once")
    await decide("Allow once")
    expect((await api("/api/permission/saved")).data).toEqual([])
    const dismissed = await ask("read-dismiss")
    await decide("Dismiss")
    const denied = await ask("read-deny")
    await decide("Deny")
    const always = await ask("read-saved")
    await decide("Allow always")
    const saved = (await api("/api/permission/saved")).data
    expect(saved).toHaveLength(1)
    expect(saved[0].action).toBe("browser")
    const remembered = JSON.parse(await run("ask", "read-saved")).id
    await expect
      .poll(async () => {
        const status = JSON.parse(await run("status"))
        return status.requests.find((item: { id: string }) => item.id === remembered)?.result
      })
      .toEqual({ allowed: true })
    expect(await pending()).toEqual([])
    await api(`/api/permission/saved/${saved[0].id}`, { method: "DELETE" })
    expect((await api("/api/permission/saved")).data).toEqual([])
    const revoked = await ask("read-saved")
    await decide("Dismiss")
    const cancelled = await ask("read-cancel")
    await run("cancel", cancelled)
    await run("wait", `!(${button("Allow once")})`)
    expect(await pending()).toEqual([])
    const late = await Bun.fetch(
      new URL(`/api/session/${fixture.sessionID}/permission/${cancelled}/reply`, fixture.backend),
      { method: "POST", headers, body: JSON.stringify({ reply: "once" }) },
    )
    expect(late.status).toBe(404)
    await run("screenshot", "web-after-cancellation")
    const status = JSON.parse(await run("status"))
    const result = (id: string) => status.requests.find((item: { id: string }) => item.id === id)?.result
    for (const id of [once, always, remembered]) expect(result(id)).toEqual({ allowed: true })
    for (const id of [dismissed, revoked]) expect(result(id).error).toBe("PermissionV2.DismissedError")
    expect(result(denied).error).toBe("PermissionV2.DeclinedError")
    expect(result(cancelled).message).toContain("interrupted")
    await writeFile(
      `${fixture.root}/acceptance.json`,
      JSON.stringify({
        platform:
          process.env.CLIENT_ELECTRON === "1"
            ? "Ubuntu ARM64 Electron actual wrapper"
            : "Ubuntu ARM64 Chromium agent-browser",
        once,
        cancelled,
        lateReply: late.status,
        authenticatedPNG: true,
        savedGrantUI: false,
        savedGrantAPI: true,
        results: status,
      }),
      { mode: 0o600 },
    )
  },
  180000,
)
