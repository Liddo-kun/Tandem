import assert from "node:assert/strict"
import { createRequire } from "node:module"
import { readFile, writeFile } from "node:fs/promises"
import { join } from "node:path"
const { directory, binary, uiURL, artifacts, task, session, password, installedHost } = JSON.parse(
  await readFile(process.argv[2]!, "utf8"),
)
const require = createRequire(new URL("../../app/package.json", import.meta.url))
const { chromium } = require("@playwright/test")
const headers = {
  authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
  "content-type": "application/json",
}
const api = async (path: string, body?: unknown) => {
  const response = await fetch(uiURL + path.replace(/^\//, ""), {
    headers,
    method: body === undefined ? "GET" : "POST",
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  assert(response.ok, `${path}: ${response.status} ${text}`)
  return response.status === 204 ? undefined : JSON.parse(text)
}
async function wait<T>(read: () => Promise<T | undefined>, label: string, timeout = 45000): Promise<T> {
  const until = Date.now() + timeout
  while (Date.now() < until) {
    const value = await read()
    if (value !== undefined) return value
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(label)
}
let client: any
let page: any
const clientErrors: string[] = []
try {
  client = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox"] })
  page = await client.newPage({ viewport: { width: 1280, height: 900 } })
  page.on("requestfailed", (request: any) =>
    clientErrors.push(JSON.stringify({ path: new URL(request.url()).pathname, failure: request.failure() })),
  )
  page.on("console", (message: any) => {
    if (message.type() === "error") clientErrors.push(message.text())
  })
  page.on("pageerror", (error: Error) => clientErrors.push(error.stack ?? error.message))
  page.on("response", async (response: any) => {
    if (response.status() >= 400)
      clientErrors.push(
        JSON.stringify({
          path: new URL(response.url()).pathname,
          status: response.status(),
          body: (await response.text().catch(() => "")).slice(0, 3000),
        }),
      )
  })
  console.error("packaged client: navigating")
  const route = `${Buffer.from(artifacts).toString("base64url")}/session/${session.id}`
  await page.goto(`${uiURL}${route}?auth_token=${Buffer.from(`opencode:${password}`).toString("base64")}`)
  console.error("packaged client: admitting task")
  await api(`/api/session/${session.id}/prompt`, { prompt: { text: task } })
  let approvals = 0
  const transcript = await wait(
    async () => {
      const pending = (await api(`/api/session/${session.id}/permission`)).data
      if (pending.length) {
        console.error("packaged client: approval", approvals + 1)
        await page.getByRole("button", { name: "Allow always", exact: true }).click({ timeout: 15000 })
        approvals++
      }
      const context = (await api(`/api/session/${session.id}/context`)).data
      return JSON.stringify(context).includes("Fixture complete; one submission.") &&
        JSON.stringify(context).includes("Browser cleanup: confirmed")
        ? context
        : undefined
    },
    "Joined packaged task did not finish",
    90000,
  )
  assert(approvals > 0)
  await page.locator("[data-component=browser-capture] img").waitFor({ timeout: 15000 })
  await wait(
    async () =>
      (await page
        .locator("[data-component=browser-capture] img")
        .evaluate((image: { naturalWidth: number }) => image.naturalWidth > 0))
        ? true
        : undefined,
    "Packaged client PNG not decoded",
  )
  await page.screenshot({ path: join(directory, "packaged-web.png") })
  assert.equal((await api("/phase4/effects")).clicks, 1)
  const grants = (await api("/api/permission/saved")).data
  assert(grants.length > 0)
  await page.keyboard.press("Control+,")
  await page.getByRole("tab", { name: "Browser grants", exact: true }).click()
  for (const [index] of grants.entries()) {
    await page.getByRole("button", { name: "Remove grant", exact: true }).first().click()
    await wait(
      async () => ((await api("/api/permission/saved")).data.length === grants.length - index - 1 ? true : undefined),
      "UI grant removal did not persist",
    )
  }
  assert.equal((await api("/api/permission/saved")).data.length, 0)
  await page.keyboard.press("Escape")
  // A second fresh fixture provider turn uses the same browser binding and
  // origin. It creates no mutation before the restored approval boundary.
  await api("/phase4/revoke", {})
  await api(`/api/session/${session.id}/prompt`, {
    prompt: { text: "Verify revoked browser grant asks again; do not repeat input or submit." },
  })
  await page.getByRole("button", { name: "Allow once", exact: true }).waitFor({ timeout: 30000 })
  assert((await api(`/api/session/${session.id}/permission`)).data.length > 0)
  await api(`/api/session/${session.id}/interrupt`, {})
  await wait(
    async () => ((await api(`/api/session/${session.id}/permission`)).data.length === 0 ? true : undefined),
    "Stop left a pending approval",
  )
  assert.equal((await api("/phase4/effects")).clicks, 1)
  await writeFile(
    join(directory, "packaged-session-report.json"),
    JSON.stringify(
      {
        passed: true,
        binary,
        installedHost: installedHost,
        client: "built web distribution",
        provider: "scripted HTTP provider; actual PNG projection asserted by reused session fixture",
        approvals,
        revokedGrants: grants.length,
        revokedThroughSettings: true,
        askedAgain: true,
        stopClearedApproval: true,
        clicks: 1,
      },
      null,
      2,
    ),
    { mode: 0o600 },
  )
} catch (error) {
  if (page) {
    await page
      .getByText("Error Details", { exact: true })
      .click({ timeout: 1000 })
      .catch(() => {})
    await writeFile(
      join(directory, "packaged-client-errors.json"),
      JSON.stringify({
        clientErrors,
        details: await page
          .locator("textarea")
          .evaluateAll((nodes: Array<{ value: string }>) => nodes.map((node) => node.value)),
      }),
    )
    await page.screenshot({ path: join(directory, "packaged-failure.png") }).catch(() => {})
    await writeFile(
      join(directory, "packaged-failure.txt"),
      await page
        .locator("body")
        .innerText()
        .catch(() => ""),
    )
  }
  throw error
} finally {
  await client?.close()
}
