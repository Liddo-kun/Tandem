export type Outcome = "not_dispatched" | "confirmed" | "unknown"

const messages: Record<string, string> = {
  browser_unavailable: "The configured browser host is unavailable. Check native registration and whether the configured Chromium is running",
  browser_required: "Select a browser from browsers, or supply a current execution-owned tab alias",
  ambiguous_browser: "Ambiguous native hosts; select an explicit hostId",
  controller_busy: "Native host already has a controller or is cleaning up",
  protocol_error: "Invalid bridge contract; rebuild and reprepare the native host",
  deadline_exceeded: "Browser operation timed out",
  cancelled: "Browser operation cancelled",
  disconnected: "Browser connection disconnected",
  operation_uncertain: "Session has an unresolved operation; inspect operation status",
  cleanup_unconfirmed:
    "Previous browser cleanup is unresolved. Tabs remain protected; do not replay input or take over their leases",
  resource_limit: "Browser resource limit reached",
  result_too_large: "Browser result exceeds the configured limit",
  stale_handle: "This tab, reference, or operation alias is no longer valid for this execution. Refresh element refs with inspect; this alone does not mean the browser disconnected",
  operation_required: "Supply the operation alias returned by the failed browser call. Status checks an operation, not the browser connection",
  element_stale: "The referenced DOM node was removed or its document changed. Inspect the same tab for a current target; no reconnection is indicated",
  element_unavailable: "The original browser locator found no actionable element. Inspect the current page and choose the visible target",
  element_ambiguous: "The original browser locator matched multiple elements. Use the observed role/name or a more specific selector",
  document_changed: "The document navigated. Inspect the same tab before further input; the browser is still connected",
  document_context_lost: "Execution context was destroyed; inspect the current document before further input",
  debugger_unattached: "Debugger unattached",
  view_expired: "The viewport changed since this observation. Inspect or capture again before coordinate input",
  unsupported_frame_selection: "Inspect the top-level tab; the original snapshot includes embedded frames. Use a returned ref or a frame-traversing selector",
  capture_failed: "The original browser capture failed. This is a capture error, not proof of disconnection; inspect the tab and report persistent capture failure",
  engine_error: "The original browser command failed. Inspect the page and current input values before retrying; earlier input may already have taken effect",
  native_error: "The extension rejected a native browser command. The connection may still be healthy; inspect state before retrying input",
  permission_denied: "Browser operation was not authorized",
  permission_cancelled: "Browser authorization was cancelled",
  unsupported: "Browser operation is not supported",
  tab_owned: "Tab is owned by another session",
  target_changed: "Browser target changed; inspect it again before acting",
}

export class BrowserError extends Error {
  readonly code: string
  readonly operationId: string
  readonly outcome: Outcome
  readonly diagnosticCode?: number

  constructor(code: string, operationId: string, outcome: Outcome, _message?: string, diagnosticCode?: number) {
    super(messages[code] ?? "Browser operation failed")
    this.name = "BrowserError"
    this.code = /^[a-z_]{1,64}$/.test(code) ? code : "protocol_error"
    this.operationId = /^[a-zA-Z0-9:_-]{1,128}$/.test(operationId) ? operationId : ""
    this.outcome = outcome
    if (Number.isSafeInteger(diagnosticCode)) this.diagnosticCode = diagnosticCode
  }
}
