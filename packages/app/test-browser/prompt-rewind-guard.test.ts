import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createPromptInputV2Controller } from "@opencode-ai/session-ui/v2/prompt-input/interaction"
import type { PromptInputV2PersistedState } from "@opencode-ai/session-ui/v2/prompt-input/types"

test("pending rewind disables v2 send without losing the restored draft", () => {
  createRoot((dispose) => {
    const store = createStore<PromptInputV2PersistedState>({
      prompt: [{ type: "text", content: "replacement", start: 0, end: 11 }],
      cursor: 11,
      context: { items: [] },
    })
    const [state, setState] = createStore({ pending: true, sends: 0 })
    const controller = createPromptInputV2Controller({
      store,
      commands: () => [],
      context: () => [],
      searchContextFiles: () => [],
      view: {
        submit: {
          stopping: () => false,
          disabled: () => state.pending,
          onSubmit: () => setState("sends", (count) => count + 1),
          onStop: () => undefined,
        },
      },
    })
    try {
      expect(controller.canSubmit()).toBe(false)
      controller.submit()
      expect(state.sends).toBe(0)
      expect(store[0].prompt).toEqual([{ type: "text", content: "replacement", start: 0, end: 11 }])

      setState("pending", false)
      expect(controller.canSubmit()).toBe(true)
      controller.submit()
      expect(state.sends).toBe(1)
    } finally {
      dispose()
    }
  })
})
