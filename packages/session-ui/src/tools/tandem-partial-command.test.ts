import { describe, expect, test } from "bun:test"
import { partialShellCommand } from "./tandem-partial-command"

describe("partial shell command", () => {
  test("is undefined before the command starts", () => {
    for (const raw of ["", "{", '{"comm', '{"command"', '{"command":', '{"command": "'])
      expect(partialShellCommand(raw)).toBeUndefined()
  })

  test("grows with the input", () => {
    const full = JSON.stringify({ command: "cat > a.py <<'EOF'\nprint(\"hi\\n\")\tπ 😀\nEOF", timeout: 5000 })
    const command = "cat > a.py <<'EOF'\nprint(\"hi\\n\")\tπ 😀\nEOF"
    let previous = ""

    for (let length = 0; length <= full.length; length++) {
      const partial = partialShellCommand(full.slice(0, length)) ?? ""

      expect(command.startsWith(partial)).toBe(true)
      expect(partial.length).toBeGreaterThanOrEqual(previous.length)
      previous = partial
    }
    expect(previous).toBe(command)
  })

  test("decodes unicode escapes and waits for both halves of a surrogate pair", () => {
    expect(partialShellCommand('{"command":"a\\u00e9')).toBe("aé")
    expect(partialShellCommand('{"command":"a\\u00')).toBe("a")
    expect(partialShellCommand('{"command":"a\\ud83d')).toBe("a")
    expect(partialShellCommand('{"command":"a\\ud83d\\ude00')).toBe("a😀")
  })

  test("reads a command that follows other fields", () => {
    const head = '{"description":"say \\"hi\\"","timeout":5000,"background":false,"env":{"A":["}",1]},"command":"echo'

    expect(partialShellCommand(head)).toBe("echo")
    expect(partialShellCommand('{"timeout":50')).toBeUndefined()
    expect(partialShellCommand('{"description":"echo')).toBeUndefined()
  })

  test("ignores input that is not an object with a string command", () => {
    for (const raw of ['"command"', "[1", '{"command":12', '{"command":{"a":"b'])
      expect(partialShellCommand(raw)).toBeUndefined()
  })
})
