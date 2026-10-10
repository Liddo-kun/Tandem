// Tandem-owned (not in upstream): Android Backspace over read-only mentions.
// An Android keyboard cannot delete a contenteditable=false mention directly before the caret, and the caret
// can then land inside the mention, where nothing is editable. A zero-width gap after each mention gives
// Backspace an editable character; deleting the gap removes the whole mention. The editor's parser and
// cursor ignore the gap.
const GAP = "\u200B"

const isGap = (node: Node | null): node is Text => node instanceof Text && node.data.startsWith(GAP)

const mentionAt = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>("[data-mention]")

// Called synchronously while the editor renders or parses, so the keyboard never sees a stale caret offset.
export function ensureMentionGaps(editor: HTMLElement) {
  for (const mention of editor.querySelectorAll("[data-mention]")) {
    if (!isGap(mention.nextSibling)) mention.after(GAP)
  }
}

export function installNativeMentions(editor: HTMLElement) {
  let composing = false

  const onBeforeInput = (event: InputEvent) => {
    if (event.inputType !== "deleteContentBackward" || event.isComposing || composing || !event.cancelable) return
    const selection = window.getSelection()
    const target = event.getTargetRanges()[0] ?? (selection?.rangeCount ? selection.getRangeAt(0) : undefined)
    if (!target || !editor.contains(target.startContainer) || !editor.contains(target.endContainer)) return
    const range = document.createRange()
    range.setStart(target.startContainer, target.startOffset)
    range.setEnd(target.endContainer, target.endOffset)
    const inside = mentionAt(target.startContainer)
    let mention: Node | null | undefined = inside
    if (!mention) {
      // Only a deletion of the gap itself (or nothing) reaches back to the mention.
      if (range.toString().replaceAll(GAP, "")) return
      const node = target.startContainer
      if (node instanceof Text && node.data.slice(0, target.startOffset).replaceAll(GAP, "")) return
      mention = node instanceof Text ? node.previousSibling : node.childNodes[target.startOffset - 1]
      while (mention instanceof Text && !mention.data.replaceAll(GAP, "")) mention = mention.previousSibling
    }
    if (!(mention instanceof HTMLElement) || !mention.dataset.mention || !editor.contains(mention)) return
    event.preventDefault()
    range.setStartBefore(mention)
    if (inside && isGap(inside.nextSibling)) range.setEnd(inside.nextSibling, 1)
    else if (inside) range.setEndAfter(inside)
    range.deleteContents()
    selection?.removeAllRanges()
    selection?.addRange(range)
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }))
  }

  // Keeps a collapsed caret out of a mention and from between a mention and its gap.
  const onSelectionChange = () => {
    const selection = window.getSelection()
    const node = selection?.anchorNode
    if (composing || !selection?.isCollapsed || !node || !editor.contains(node)) return
    const offset = selection.anchorOffset
    const mention =
      mentionAt(node) ?? (node instanceof Text ? (offset === 0 ? node.previousSibling : null) : node.childNodes[offset - 1])
    if (mention instanceof HTMLElement && mention.dataset.mention && isGap(mention.nextSibling)) {
      selection.collapse(mention.nextSibling, 1)
    }
  }

  const onCompositionStart = () => {
    composing = true
  }
  const onCompositionEnd = () => {
    composing = false
  }

  editor.addEventListener("beforeinput", onBeforeInput)
  editor.addEventListener("compositionstart", onCompositionStart)
  editor.addEventListener("compositionend", onCompositionEnd)
  document.addEventListener("selectionchange", onSelectionChange)

  return () => {
    editor.removeEventListener("beforeinput", onBeforeInput)
    editor.removeEventListener("compositionstart", onCompositionStart)
    editor.removeEventListener("compositionend", onCompositionEnd)
    document.removeEventListener("selectionchange", onSelectionChange)
  }
}
