import { expect, mock, test } from "bun:test"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { createComponent } from "solid-js"
import h from "solid-js/h"
import { render } from "solid-js/web"

Reflect.set(globalThis, "React", { createElement: h })

mock.module("@/context/language", () => ({
  useLanguage: () => ({
    t: (key: string) =>
      ({
        "notification.permission.title": "Permission required",
        "common.dismiss": "Dismiss",
        "ui.permission.deny": "Deny",
        "ui.permission.allowAlways": "Allow always",
        "ui.permission.allowOnce": "Allow once",
      })[key] ?? key,
  }),
}))

test("renders bounded browser context instead of opaque policy resources and exposes every decision", async () => {
  const { SessionPermissionDock } = await import("./session-permission-dock")
  const root = document.createElement("div")
  const decisions: string[] = []
  const request = {
    id: "per_browser",
    sessionID: "ses_browser",
    permission: "browser",
    patterns: ["62726f77736572:opaque-policy-resource"],
    always: [],
    metadata: {
      browser: "Fixture Chromium",
      capability: "read",
      origin: "https://example.com",
      tabTitle: "Quarterly\nReport",
      tabScope: "tab-7",
    },
  } as PermissionRequest

  const dispose = render(
    () =>
      createComponent(SessionPermissionDock, {
        request,
        responding: false,
        onDecide: (decision) => decisions.push(decision),
      }),
    root,
  )

  expect(root.textContent).toContain("Fixture Chromium / read")
  expect(root.textContent).toContain("https://example.com")
  expect(root.textContent).toContain("Quarterly Report")
  expect(root.textContent).toContain("tab-7")
  expect(root.textContent).not.toContain("opaque-policy-resource")

  const buttons = Array.from(root.querySelectorAll("button"))
  for (const label of ["Dismiss", "Deny", "Allow always", "Allow once"]) {
    const button = buttons.find((item) => item.textContent?.trim() === label)
    expect(button).toBeDefined()
    button?.click()
  }
  expect(decisions).toEqual(["dismiss", "reject", "always", "once"])
  dispose()
})
