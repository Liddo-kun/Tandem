// Tandem-owned (not in upstream): when the composer context button's `cache NN%` pulse shows (tandem-composer.tsx).

/** What a pulse shows: the share of the cache a request read, or undefined when it is unknown. */
type Pulse = { readonly health: number | undefined; readonly attempt: number }

export type State = {
  readonly sessionID: string | undefined
  /**
   * The shown session's request seen running, and whether its pulse already showed from its response's start. Only
   * a request seen running pulses: one that was already complete when it first appeared, such as an old session's
   * last request loading after the session opens, does not. `id` is unknown when the response's start arrives
   * before the request is seen.
   */
  readonly running: { readonly id: string | undefined; readonly pulsed: boolean } | undefined
  readonly pulse: Pulse | undefined
  readonly attempt: number
}

export type Event =
  | { readonly type: "shown"; readonly sessionID: string | undefined }
  | { readonly type: "running"; readonly sessionID: string; readonly id: string }
  /** A request's response started, with its cache usage. */
  | { readonly type: "started"; readonly sessionID: string; readonly health: number | undefined }
  /** A request completed; `health` is undefined when it reported no usage. */
  | { readonly type: "completed"; readonly sessionID: string; readonly id: string; readonly health: number | undefined }
  | { readonly type: "faded"; readonly attempt: number }

export type Effect = { readonly type: "fade"; readonly attempt: number }

export const initial: State = { sessionID: undefined, running: undefined, pulse: undefined, attempt: 0 }

const NONE: ReadonlyArray<Effect> = []

const pulse = (state: State, health: number | undefined, running: State["running"]) => {
  const attempt = state.attempt + 1
  return { state: { ...state, running, pulse: { health, attempt }, attempt }, effects: [{ type: "fade", attempt } as const] }
}

export function transition(state: State, event: Event): { state: State; effects: ReadonlyArray<Effect> } {
  if (event.type === "shown") {
    if (event.sessionID === state.sessionID) return { state, effects: NONE }
    return { state: { ...initial, sessionID: event.sessionID, attempt: state.attempt }, effects: NONE }
  }

  if (event.type === "faded") {
    if (state.pulse?.attempt !== event.attempt) return { state, effects: NONE }
    return { state: { ...state, pulse: undefined }, effects: NONE }
  }

  if (event.sessionID !== state.sessionID) return { state, effects: NONE }

  if (event.type === "running") {
    if (state.running?.id === event.id) return { state, effects: NONE }
    const pulsed = state.running?.id === undefined && state.running?.pulsed === true
    return { state: { ...state, running: { id: event.id, pulsed } }, effects: NONE }
  }

  if (event.type === "started") return pulse(state, event.health, { id: state.running?.id, pulsed: true })

  if (state.running?.id !== event.id) return { state, effects: NONE }
  if (state.running.pulsed || event.health === undefined) return { state: { ...state, running: undefined }, effects: NONE }

  return pulse(state, event.health, undefined)
}
