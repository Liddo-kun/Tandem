import { expect, test } from "bun:test"

test("public package exposes the controller without raw transport or page evaluation", async () => {
  const api = await import("@tandem/chrome-bridge")
  expect(Object.keys(api).sort()).toEqual(["BrowserController", "BrowserError", "CONTROLLER_LIMITS"])
  for (const path of [
    "@tandem/chrome-bridge/src/client",
    "@tandem/chrome-bridge/src/page",
    "@tandem/chrome-bridge/src/native",
  ]) {
    await expect(import(path)).rejects.toBeDefined()
  }
})
