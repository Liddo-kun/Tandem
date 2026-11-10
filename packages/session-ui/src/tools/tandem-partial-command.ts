// Tandem-owned (not in upstream): reads the shell command out of tool input JSON the model is still writing,
// so the row can show the command as it grows instead of waiting for the input to be complete.

const ESCAPES: Record<string, string> = { '"': '"', "\\": "\\", "/": "/", b: "\b", f: "\f", n: "\n", r: "\r", t: "\t" }

function skipSpace(raw: string, index: number) {
  while (index < raw.length && " \t\n\r".includes(raw[index]!)) index++

  return index
}

/** Decodes the JSON string opening at `index`, stopping at whatever has arrived so far. */
function readString(raw: string, index: number) {
  let value = ""
  let cursor = index + 1

  while (cursor < raw.length) {
    const char = raw[cursor]!

    if (char === '"') return { value, end: cursor + 1, complete: true }

    if (char !== "\\") {
      value += char
      cursor++
      continue
    }
    const escape = raw[cursor + 1]

    if (escape === undefined) break

    if (escape !== "u") {
      value += ESCAPES[escape] ?? escape
      cursor += 2
      continue
    }
    const hex = raw.slice(cursor + 2, cursor + 6)

    if (!/^[0-9a-fA-F]{4}$/.test(hex)) break
    value += String.fromCharCode(Number.parseInt(hex, 16))
    cursor += 6
  }

  // Half of a surrogate pair is not a character yet.
  return { value: value.replace(/[\uD800-\uDBFF]$/, ""), end: cursor, complete: false }
}

/** The index after the complete JSON value at `index`, or undefined while it is still arriving. */
function skipValue(raw: string, index: number) {
  const first = raw[index]

  if (first === '"') {
    const string = readString(raw, index)

    return string.complete ? string.end : undefined
  }

  if (first !== "{" && first !== "[") {
    let cursor = index

    while (cursor < raw.length && !",}] \t\n\r".includes(raw[cursor]!)) cursor++

    // A number or literal is only known to be whole once something follows it.
    return cursor < raw.length && cursor > index ? cursor : undefined
  }
  let depth = 0
  let cursor = index

  while (cursor < raw.length) {
    const char = raw[cursor]!

    if (char === '"') {
      const string = readString(raw, cursor)

      if (!string.complete) return undefined
      cursor = string.end
      continue
    }

    if (char === "{" || char === "[") depth++

    if ((char === "}" || char === "]") && --depth === 0) return cursor + 1
    cursor++
  }

  return undefined
}

/** The `command` written so far in a shell tool's unfinished input JSON, or undefined before it starts. */
export function partialShellCommand(raw: string) {
  let index = skipSpace(raw, 0)

  if (raw[index] !== "{") return undefined
  index = skipSpace(raw, index + 1)

  while (raw[index] === '"') {
    const key = readString(raw, index)

    if (!key.complete) return undefined
    index = skipSpace(raw, key.end)

    if (raw[index] !== ":") return undefined
    index = skipSpace(raw, index + 1)

    if (key.value === "command") return raw[index] === '"' ? readString(raw, index).value || undefined : undefined
    const end = skipValue(raw, index)

    if (end === undefined) return undefined
    index = skipSpace(raw, end)

    if (raw[index] !== ",") return undefined
    index = skipSpace(raw, index + 1)
  }

  return undefined
}
