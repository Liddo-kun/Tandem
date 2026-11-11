// Tandem-owned (not in upstream): the lifecycle of the cold-cache send dialog.

/** How to send a prompt on a cold prompt cache; `undefined` cancels. */
export type ColdSendChoice = "send" | "trim" | "compact" | undefined

export type ColdSendState =
  | { readonly type: "idle" }
  /** The dialog is open. */
  | { readonly type: "asking"; readonly send: () => void }
  /** The session is being marked for trimming, or compacted; the prompt goes out after, and stays a draft on failure. */
  | { readonly type: "preparing"; readonly step: "trim" | "compact"; readonly send: () => void }

export type ColdSendEvent =
  | { readonly type: "requested"; readonly send: () => void }
  | { readonly type: "chosen"; readonly choice: ColdSendChoice }
  | { readonly type: "prepared"; readonly step: "trim" | "compact"; readonly ok: boolean }
  | { readonly type: "disposed" }

export type ColdSendEffect =
  | { readonly type: "ask" }
  | { readonly type: "trim" }
  | { readonly type: "compact" }
  | { readonly type: "send"; readonly send: () => void }
  | { readonly type: "failed"; readonly step: "trim" | "compact" }

export const COLD_SEND_IDLE: ColdSendState = { type: "idle" }

const stay = (state: ColdSendState) => ({ state, effects: [] as ColdSendEffect[] })

export function transitionColdSend(
  state: ColdSendState,
  event: ColdSendEvent,
): { state: ColdSendState; effects: ColdSendEffect[] } {
  if (event.type === "disposed") return state.type === "idle" ? stay(state) : stay(COLD_SEND_IDLE)

  if (event.type === "requested") {
    // A second Enter while the dialog is open or the session is being prepared is the same request.
    if (state.type !== "idle") return stay(state)

    return { state: { type: "asking", send: event.send }, effects: [{ type: "ask" }] }
  }

  if (event.type === "chosen") {
    if (state.type !== "asking") return stay(state)

    if (event.choice === undefined) return stay(COLD_SEND_IDLE)

    if (event.choice === "send") return { state: COLD_SEND_IDLE, effects: [{ type: "send", send: state.send }] }

    return { state: { type: "preparing", step: event.choice, send: state.send }, effects: [{ type: event.choice }] }
  }

  if (state.type !== "preparing" || state.step !== event.step) return stay(state)

  return {
    state: COLD_SEND_IDLE,
    effects: [event.ok ? { type: "send", send: state.send } : { type: "failed", step: event.step }],
  }
}
