import { describe, expect, test } from "bun:test"
import { browserToolSummary } from "./basic-tool"

describe("browserToolSummary", () => {
  test("only includes allowlisted browser descriptors regardless of input order", () => {
    const summary = browserToolSummary(
      {
        text: "typed secret",
        url: "https://example.com/?token=secret",
        page: "untrusted page body",
        action: "type",
        ref: "ref_raw-id",
        browser: "work",
        tab: "tab_alias",
        operation: "operation_alias",
      },
      {
        outcome: "unknown",
        code: "cleanup_unconfirmed",
        body: "metadata page body",
        id: "raw protocol id",
      },
    )

    expect(summary).toEqual({
      subject: "type",
      preview: "browser=work tab=tab_alias operation=operation_alias outcome=unknown code=cleanup_unconfirmed",
      failed: true,
    })
    expect(JSON.stringify(summary)).not.toContain("secret")
    expect(JSON.stringify(summary)).not.toContain("page body")
    expect(JSON.stringify(summary)).not.toContain("raw protocol id")
  })
  test("bounds malformed alias fields instead of echoing URL queries", () => {
    const summary = browserToolSummary(
      { action: "inspect", browser: "https://example.com/?token=secret", tab: "x".repeat(1000) },
      {},
    )
    expect(summary.subject).toBe("inspect")
    expect(summary.preview).toBeUndefined()
  })
})
