import { expect, test } from "bun:test"
import { ClaudeClearThinking } from "@opencode/core/plugin/tandem/claude/clear-thinking"

const body = (value: Record<string, unknown>) => JSON.stringify({ model: "claude-fable-5-2", messages: [], ...value })
const clear = { type: "clear_thinking_20251015", keep: "all" }
const compact = { type: "compact_20260112", pause_after_compaction: true }

test("adds the keep-all thinking edit and its beta when thinking is on", () => {
  for (const type of ["enabled", "adaptive"]) {
    const next = ClaudeClearThinking.rewrite(
      body({ thinking: { type } }),
      "interleaved-thinking-2025-05-14,thinking-binding-controls-2026-08-01",
    )
    expect(next?.body).toBe(body({ thinking: { type }, context_management: { edits: [clear] } }))
    expect(next?.betas).toBe(
      "interleaved-thinking-2025-05-14,context-management-2025-06-27,thinking-binding-controls-2026-08-01",
    )
  }
})

test("puts the edit ahead of compaction edits without moving context_management", () => {
  const next = ClaudeClearThinking.rewrite(
    body({ thinking: { type: "adaptive" }, context_management: { edits: [compact] }, speed: "fast" }),
    "interleaved-thinking-2025-05-14,compact-2026-01-12",
  )
  expect(next?.body).toBe(
    body({ thinking: { type: "adaptive" }, context_management: { edits: [clear, compact] }, speed: "fast" }),
  )
  expect(next?.betas).toBe("interleaved-thinking-2025-05-14,context-management-2025-06-27,compact-2026-01-12")
})

test("leaves requests alone when thinking is off, the model is not Claude, or the edit is already there", () => {
  expect(ClaudeClearThinking.rewrite(body({ thinking: { type: "disabled" } }), "interleaved-thinking-2025-05-14")).toBeUndefined()
  expect(ClaudeClearThinking.rewrite(body({}), null)).toBeUndefined()
  expect(ClaudeClearThinking.rewrite(body({ model: "other", thinking: { type: "adaptive" } }), null)).toBeUndefined()
  expect(
    ClaudeClearThinking.rewrite(
      body({ thinking: { type: "adaptive" }, context_management: { edits: [clear] } }),
      "interleaved-thinking-2025-05-14,context-management-2025-06-27",
    ),
  ).toBeUndefined()
  expect(ClaudeClearThinking.rewrite("not json", null)).toBeUndefined()
})

test("drops the edit when the final thinking mode is off", () => {
  const next = ClaudeClearThinking.rewrite(
    body({ thinking: { type: "disabled" }, context_management: { edits: [clear, compact] } }),
    "interleaved-thinking-2025-05-14",
  )
  expect(next?.body).toBe(body({ thinking: { type: "disabled" }, context_management: { edits: [compact] } }))
  expect(ClaudeClearThinking.rewrite(body({ thinking: { type: "disabled" }, context_management: { edits: [clear] } }), null)?.body).toBe(
    body({ thinking: { type: "disabled" } }),
  )
})
