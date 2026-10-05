// Tandem-owned (not in upstream): navigator-first clipboard with fallback delegation.
/** Browser clipboard first, with a selection-preserving fallback for plain-HTTP LAN clients. */
export async function writeClipboardText(text: string, native?: (text: string) => Promise<void>): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return
    }
  } catch {
    // Permission or secure-context restrictions must not disable the copy action.
  }
  const body = typeof document === "undefined" ? undefined : document.body
  if (body) {
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    const selection = window.getSelection()
    const anchor = selection?.anchorNode
    const focus = selection?.focusNode
    const anchorOffset = selection?.anchorOffset ?? 0
    const focusOffset = selection?.focusOffset ?? 0
    const field = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : undefined
    const fieldSelection = field ? [field.selectionStart, field.selectionEnd, field.selectionDirection] as const : undefined
    const textarea = document.createElement("textarea")
    textarea.value = text
    textarea.readOnly = true
    textarea.tabIndex = -1
    textarea.setAttribute("aria-hidden", "true")
    textarea.style.cssText = "position:fixed;top:0;left:0;width:1px;height:1px;opacity:0;pointer-events:none"
    // Keep the temporary control inside a modal's focus boundary when copying from a dialog.
    const parent = active?.closest('[role="dialog"]') ?? body
    parent.appendChild(textarea)
    try {
      textarea.select()
      if (document.execCommand("copy")) return
    } catch {
      // The optional desktop native writer remains available if browser copying fails.
    } finally {
      textarea.remove()
      active?.focus({ preventScroll: true })
      if (anchor?.isConnected && focus?.isConnected) {
        selection?.setBaseAndExtent(anchor, anchorOffset, focus, focusOffset)
      }
      if (field && fieldSelection && fieldSelection[0] !== null && fieldSelection[1] !== null) {
        field.setSelectionRange(fieldSelection[0], fieldSelection[1], fieldSelection[2] ?? undefined)
      }
    }
  }
  if (native) return native(text)
  throw new DOMException(undefined, "NotAllowedError")
}
