import { expect, test } from "bun:test"
import { browserGrantScope } from "./browser-grant"

const resource = (...parts: string[]) => parts.map((part) => Buffer.from(part).toString("hex")).join(":")

test("decodes exact browser resources without inventing wildcard or tab scope", () => {
  expect(browserGrantScope(resource("fixture", "read", "https://example.com", "https://frame.example.com"))).toEqual({
    browser: "fixture",
    capability: "read",
    origin: "https://example.com",
    frame: "https://frame.example.com",
  })
  expect(browserGrantScope(resource("fixture", "discovery", "browser", "browser"))?.origin).toBe("browser")
  expect(browserGrantScope(resource("fixture", "site", "https://example.com", "https://example.com"))?.capability).toBe("site")
})

test("does not summarize wildcard, malformed, claim, credential-bearing or unsafe resources as exact grants", () => {
  for (const value of [
    "*",
    "opaque",
    "ff:ff:ff:ff",
    resource("*", "read", "https://example.com", "https://example.com"),
    resource("fixture", "claim", "https://example.com", "https://example.com") + ":operation",
    resource("fixture", "read", "https://user:password@example.com", "https://example.com"),
    resource("fixture", "read", "https://example.com/path?secret=1", "https://example.com"),
    resource("fixture", "read", "https://*.example.com", "https://*.example.com"),
    resource("fixture\u202e", "read", "https://example.com", "https://example.com"),
    resource("fixture", "input", "browser", "browser"),
    "ab".repeat(20000),
  ])
    expect(browserGrantScope(value)).toBeUndefined()
})
