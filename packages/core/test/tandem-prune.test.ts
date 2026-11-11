// Tandem-owned (not in upstream): the fixed rules that shorten long tool text.
import { expect, test } from "bun:test"
import { Message, ToolResultPart } from "@opencode/ai/effect"
import { TandemPrune } from "../src/plugin/tandem/prune.js"

/** `count` numbered lines of 50 characters each, line break included. */
const lines = (count: number) => Array.from({ length: count }, (_, index) => `line ${String(index).padStart(5, "0")} ${"x".repeat(38)}`).join("\n")
const older = { newest: false, read: false }

test("a tool output up to 3,000 characters is kept whole", () => {
  const text = "x".repeat(3_000)
  expect(TandemPrune.output(text, older)).toBe(text)
  expect(TandemPrune.output(`${text}x`, older)).not.toBe(`${text}x`)
})

test("a longer tool output keeps 1,500 characters from each end, cut at line breaks, and says what it left out", () => {
  const text = lines(200)
  const cut = TandemPrune.output(text, older)
  const [head, note, tail] = cut.split(/\n(\[… .* …\])\n/)
  expect(text.startsWith(`${head}\n`)).toBe(true)
  expect(text.endsWith(`\n${tail}`)).toBe(true)
  // Whole lines only.
  expect(head.split("\n").every((line) => line.length === 49)).toBe(true)
  expect(tail.split("\n").every((line) => line.length === 49)).toBe(true)
  expect(head.length).toBeLessThanOrEqual(1_500)
  expect(head.length).toBeGreaterThan(1_400)
  expect(tail.length).toBeLessThanOrEqual(1_500)
  expect(tail.length).toBeGreaterThan(1_400)
  expect(note).toBe(`[… ${(text.length - head.length - tail.length).toLocaleString("en-US")} characters omitted …]`)
})

test("a long file read keeps only its start: the file is still on disk", () => {
  const text = lines(200)
  const cut = TandemPrune.output(text, { newest: false, read: true })
  const [head, note] = cut.split("\n[… ")
  expect(text.startsWith(`${head}\n`)).toBe(true)
  expect(note).toBe(`the remaining ${(text.length - head.length).toLocaleString("en-US")} characters of this read omitted …]`)
})

test("the newest outputs are whole up to 20,000 characters and keep 10,000 from each end beyond", () => {
  const whole = lines(400)
  expect(TandemPrune.output(whole, { newest: true, read: false })).toBe(whole)
  const cut = TandemPrune.output(lines(1_000), { newest: true, read: false })
  expect(cut.length).toBeGreaterThan(19_000)
  expect(cut.length).toBeLessThan(20_100)
})

test("a tool input over 2,000 characters keeps its first 1,000", () => {
  expect(TandemPrune.input({ content: "x".repeat(1_900) })).toBe(JSON.stringify({ content: "x".repeat(1_900) }))
  const cut = TandemPrune.input({ content: "x".repeat(5_000) })
  expect(cut).toBe(`{"content":"${"x".repeat(988)}[… 4,014 characters omitted …]`)
})

test("a cut never splits a surrogate pair", () => {
  const cut = TandemPrune.output("😀".repeat(3_000), older)
  expect(cut.isWellFormed()).toBe(true)
})

const result = (id: string, name: string, text: string) => Message.tool({ id, name, result: text, resultType: "text" })

test("the newest results are the last 60,000 characters of output", () => {
  const messages = [result("a", "bash", lines(800)), result("b", "bash", lines(800)), result("c", "bash", lines(800))]
  // "b" starts inside the allowance, 40,000 characters back; "a" starts past it.
  expect([...TandemPrune.newest(messages)].sort()).toEqual(["b", "c"])
})

test("trimming shortens tool results before the prompt and leaves everything else as it was", () => {
  const image = ToolResultPart.make({ id: "shot", name: "screenshot", resultType: "content", result: [{ type: "file", uri: "data:image/png;base64,AAAA", mime: "image/png", name: "old.png" }] })
  const messages = [
    Message.user("first"),
    Message.assistant("reply"),
    Message.tool(image),
    result("oldest", "bash", lines(2_000)),
    result("straddling", "bash", lines(2_000)),
    result("recent", "bash", lines(300)),
    result("small", "bash", "short"),
    Message.user("the prompt sent with trim"),
    result("after", "bash", lines(2_000)),
  ]
  const trimmed = TandemPrune.trim(messages, 7)

  const text = (index: number) => {
    const part = trimmed[index]?.content[0]
    return part?.type === "tool-result" ? TandemPrune.resultText(part) : ""
  }
  // Past the newest 60,000 characters: 1,500 from each end, and an attachment becomes a note.
  expect(text(3)).toContain("characters omitted to save context; run the tool again if you need it …]")
  expect(text(3).length).toBeLessThan(3_200)
  expect(text(2)).toBe("[image/png old.png removed to save context]")
  // The output the 60,000 characters reach into has the larger allowance: 10,000 from each end.
  expect(text(4).length).toBeGreaterThan(19_000)
  expect(text(4).length).toBeLessThan(20_200)
  // Within them and under 20,000: whole. Unchanged messages are the same objects.
  expect(trimmed[5]).toBe(messages[5])
  expect(trimmed[6]).toBe(messages[6])
  expect(trimmed[0]).toBe(messages[0])
  expect(trimmed[1]).toBe(messages[1])
  // From the prompt on, nothing is touched.
  expect(trimmed[7]).toBe(messages[7])
  expect(trimmed[8]).toBe(messages[8])
  // The same messages always give the same result, so the shortened prefix is cached like any other.
  expect(TandemPrune.trim(messages, 7)).toEqual(trimmed)
})
