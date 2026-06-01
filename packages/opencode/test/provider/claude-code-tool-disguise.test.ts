import { describe, expect, test } from "bun:test"
import { ClaudeCodeToolDisguise } from "@/provider/claude-code-tool-disguise"

async function readStream<T>(stream: ReadableStream<T>): Promise<T[]> {
  const reader = stream.getReader()
  const result: T[] = []
  while (true) {
    const { done, value } = await reader.read()
    if (done) return result
    result.push(value)
  }
}

describe("ClaudeCodeToolDisguise", () => {
  test("round-trips known, unknown, StructuredOutput, and MCP tool names", () => {
    expect(ClaudeCodeToolDisguise.toClaudeCodeToolName("bash")).toBe("Bash")
    expect(ClaudeCodeToolDisguise.fromClaudeCodeToolName("TodoWrite")).toBe("todowrite")
    expect(ClaudeCodeToolDisguise.toClaudeCodeToolName("StructuredOutput")).toBe("StructuredOutput")
    expect(ClaudeCodeToolDisguise.fromClaudeCodeToolName("StructuredOutput")).toBe("StructuredOutput")
    expect(ClaudeCodeToolDisguise.toClaudeCodeToolName("customTool")).toBe("CustomTool")
    expect(ClaudeCodeToolDisguise.fromClaudeCodeToolName("CustomTool")).toBe("customTool")
    expect(ClaudeCodeToolDisguise.fromClaudeCodeToolName("mcp_TodoWrite")).toBe("todowrite")
  })

  test("renames function tools and edit/read/write input schemas", () => {
    const providerTool = { type: "provider", id: "anthropic.web_search", name: "web_search", args: {} }
    const result = ClaudeCodeToolDisguise.toolsToClaudeCode([
      {
        type: "function",
        name: "edit",
        description: "Use filePath, oldString, newString, and replaceAll.",
        inputSchema: {
          type: "object",
          properties: {
            filePath: { type: "string", description: "The filePath to edit" },
            oldString: { type: "string", description: "The oldString to replace" },
            newString: { type: "string", description: "The newString replacement" },
            replaceAll: { type: "boolean", description: "Whether to replaceAll matches" },
          },
          required: ["filePath", "oldString", "newString"],
        },
      },
      { type: "function", name: "bash", inputSchema: { type: "object", properties: {} } },
      providerTool,
    ] as any[]) as any[]

    expect(result[0].name).toBe("Edit")
    expect(result[0].description).toBe("Use file_path, old_string, new_string, and replace_all.")
    expect(Object.keys(result[0].inputSchema.properties)).toEqual([
      "file_path",
      "old_string",
      "new_string",
      "replace_all",
    ])
    expect(result[0].inputSchema.properties.file_path.description).toBe("The file_path to edit")
    expect(result[0].inputSchema.required).toEqual(["file_path", "old_string", "new_string"])
    expect(result[1].name).toBe("Bash")
    expect(result[2]).toBe(providerTool)
  })

  test("renames historical prompt tool parts without touching text or reasoning", () => {
    const prompt = [
      {
        role: "assistant",
        content: [
          { type: "reasoning", text: "quoted old_string is signed reasoning" },
          { type: "text", text: "visible file_path stays literal" },
          {
            type: "tool-call",
            toolCallId: "toolu_1",
            toolName: "edit",
            input: { filePath: "a.ts", oldString: "before", newString: "after", replaceAll: true },
          },
        ],
      },
      {
        role: "tool",
        content: [{ type: "tool-result", toolCallId: "toolu_1", toolName: "edit", output: { type: "text", value: "ok" } }],
      },
    ] as any

    const result = ClaudeCodeToolDisguise.promptToClaudeCode(prompt) as any[]

    expect(result[0].content[0]).toEqual({ type: "reasoning", text: "quoted old_string is signed reasoning" })
    expect(result[0].content[1]).toEqual({ type: "text", text: "visible file_path stays literal" })
    expect(result[0].content[2]).toMatchObject({
      type: "tool-call",
      toolName: "Edit",
      input: { file_path: "a.ts", old_string: "before", new_string: "after", replace_all: true },
    })
    expect(result[1].content[0]).toMatchObject({ type: "tool-result", toolName: "Edit" })
  })

  test("maps Claude Code tool calls back to opencode inputs", () => {
    expect(
      ClaudeCodeToolDisguise.toolCallFromClaudeCode(
        "Edit",
        JSON.stringify({ file_path: "a.ts", old_string: "before", new_string: "after", replace_all: true }),
      ),
    ).toEqual({
      toolName: "edit",
      input: JSON.stringify({ filePath: "a.ts", oldString: "before", newString: "after", replaceAll: true }),
    })

    expect(ClaudeCodeToolDisguise.toolCallFromClaudeCode("Read", "{")).toEqual({ toolName: "read", input: "{" })
  })

  test("stream response transform leaves text and reasoning untouched", async () => {
    const parts = [
      { type: "reasoning-delta", id: "r1", delta: 'quoted "old_string" stays signed' },
      { type: "text-delta", id: "t1", delta: 'visible "file_path" stays literal' },
      { type: "tool-input-start", id: "toolu_1", toolName: "Edit" },
      {
        type: "tool-call",
        toolCallId: "toolu_1",
        toolName: "Edit",
        input: JSON.stringify({ file_path: "a.ts", old_string: "before", new_string: "after" }),
      },
    ] as any[]
    const stream = new ReadableStream({
      start(controller) {
        for (const part of parts) controller.enqueue(part)
        controller.close()
      },
    })

    const result = await readStream(stream.pipeThrough(ClaudeCodeToolDisguise.responseTransform()))

    expect(result[0]).toEqual(parts[0])
    expect(result[1]).toEqual(parts[1])
    expect(result[2]).toMatchObject({ type: "tool-input-start", toolName: "edit" })
    expect(result[3]).toMatchObject({
      type: "tool-call",
      toolName: "edit",
      input: JSON.stringify({ filePath: "a.ts", oldString: "before", newString: "after" }),
    })
  })
})
