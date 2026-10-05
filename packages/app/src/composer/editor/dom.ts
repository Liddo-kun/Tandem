function getNodeLength(node: Node): number {
  // UPSTREAM-DIVERGENCE: Android native ranges exclude the trailing caret BR.
  return getTextLength(node)
}

// UPSTREAM-DIVERGENCE: Android native delete-word ranges keep mentions atomic.
// Adapted from v1's validated mobile delete-word range handling. Mentions remain atomic.
export function getEditorText(parent: HTMLElement): string {
  const text = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "")
    if (node instanceof HTMLElement && node.tagName === "BR") return node.hasAttribute("data-caret-tail") ? "" : "\n"
    return Array.from(node.childNodes).map(text).join("")
  }
  return text(parent)
}

export function getSelectionRange(parent: HTMLElement) {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return null
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer) || !parent.contains(range.endContainer)) return null
  const offset = (node: Node, position: number) => {
    const before = document.createRange()
    before.selectNodeContents(parent)
    before.setEnd(node, position)
    return getTextLength(before.cloneContents())
  }
  return { start: offset(range.startContainer, range.startOffset), end: offset(range.endContainer, range.endOffset) }
}

export function getDeleteWordRange(value: string, range: { start: number; end: number } | null) {
  if (!value || !range) return null
  if (range.start !== range.end) return range
  const gap = (char?: string) => !!char && /\s/.test(char)
  const word = (position: number) => {
    let start = position
    let end = position
    while (start > 0 && !gap(value[start - 1])) start -= 1
    while (end < value.length && !gap(value[end])) end += 1
    return start === end ? null : { start, end }
  }
  const position = Math.max(0, Math.min(range.start, value.length))
  if (position === 0) return null
  let left = position
  while (left > 0 && gap(value[left - 1])) left -= 1
  const span = position > 0 && position < value.length && !gap(value[position - 1]) && !gap(value[position])
    ? word(position)
    : word(left)
  if (!span) return null
  let end = span.end
  while (end < value.length && gap(value[end])) end += 1
  if (end > span.end) return { start: span.start, end }
  let start = span.start
  while (start > 0 && gap(value[start - 1])) start -= 1
  return { start, end: span.end }
}

export function setSelectionRange(parent: HTMLElement, range: Range, start: number, end: number) {
  const length = getTextLength(parent)
  const from = Math.max(0, Math.min(start, length))
  const to = Math.max(from, Math.min(end, length))
  const edge = (node: Node, side: "start" | "end", position: number): boolean => {
    let remaining = position
    for (const child of Array.from(node.childNodes)) {
      const size = getNodeLength(child)
      if (remaining > size) { remaining -= size; continue }
      if (child.nodeType === Node.TEXT_NODE) {
        if (side === "start") range.setStart(child, remaining)
        if (side === "end") range.setEnd(child, remaining)
        return true
      }
      if (child instanceof HTMLElement && (child.dataset.mention || child.tagName === "BR")) {
        // Snap outward over an intersected pill instead of deleting part of its label/metadata.
        if (side === "start" && remaining < size) range.setStartBefore(child)
        if (side === "start" && remaining >= size) range.setStartAfter(child)
        if (side === "end" && remaining === 0) range.setEndBefore(child)
        if (side === "end" && remaining > 0) range.setEndAfter(child)
        return true
      }
      if (edge(child, side, remaining)) return true
    }
    return false
  }
  range.selectNodeContents(parent)
  range.collapse(false)
  edge(parent, "start", from)
  edge(parent, "end", to)
}

export function getTextLength(node: Node): number {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? "").replace(/\u200B/g, "").length
  // UPSTREAM-DIVERGENCE: The Android trailing caret BR is a line box, not authored text.
  if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR") {
    return (node as HTMLElement).hasAttribute("data-caret-tail") ? 0 : 1
  }
  let length = 0
  for (const child of Array.from(node.childNodes)) {
    length += getTextLength(child)
  }
  return length
}

export function getCursorPosition(parent: HTMLElement): number {
  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return 0
  const range = selection.getRangeAt(0)
  if (!parent.contains(range.startContainer)) return 0
  const preCaretRange = range.cloneRange()
  preCaretRange.selectNodeContents(parent)
  preCaretRange.setEnd(range.startContainer, range.startOffset)
  return getTextLength(preCaretRange.cloneContents())
}

export function setCursorPosition(parent: HTMLElement, position: number) {
  let remaining = position
  let node = parent.firstChild
  while (node) {
    const length = getNodeLength(node)
    const isText = node.nodeType === Node.TEXT_NODE
    const isPill = node.nodeType === Node.ELEMENT_NODE && !!(node as HTMLElement).dataset.mention
    const isBreak = node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).tagName === "BR"

    if (isText && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      range.setStart(node, remaining)
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    if ((isPill || isBreak) && remaining <= length) {
      const range = document.createRange()
      const selection = window.getSelection()
      if (remaining === 0) {
        range.setStartBefore(node)
      }
      if (remaining > 0 && isPill) {
        range.setStartAfter(node)
      }
      if (remaining > 0 && isBreak) {
        const next = node.nextSibling
        if (next && next.nodeType === Node.TEXT_NODE) {
          range.setStart(next, 0)
        }
        if (!next || next.nodeType !== Node.TEXT_NODE) {
          range.setStartAfter(node)
        }
      }
      range.collapse(true)
      selection?.removeAllRanges()
      selection?.addRange(range)
      return
    }

    remaining -= length
    node = node.nextSibling
  }

  const fallbackRange = document.createRange()
  const fallbackSelection = window.getSelection()
  const last = parent.lastChild
  if (last && last.nodeType === Node.TEXT_NODE) {
    const len = last.textContent ? last.textContent.length : 0
    fallbackRange.setStart(last, len)
  }
  if (!last || last.nodeType !== Node.TEXT_NODE) {
    fallbackRange.selectNodeContents(parent)
  }
  fallbackRange.collapse(false)
  fallbackSelection?.removeAllRanges()
  fallbackSelection?.addRange(fallbackRange)
}
