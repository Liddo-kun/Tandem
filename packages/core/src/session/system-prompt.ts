export * as SessionSystemPrompt from "./system-prompt.js"

import PROMPT from "./runner/prompt/system.txt"

export function make(tools: string[]) {
  return render(PROMPT, tools)
}

export function render(prompt: string, tools: string[]) {
  // UPSTREAM-DIVERGENCE: name only tools in the effective native catalog; Code Mode owns its own routing guidance.
  const instructions: string[] = []
  if (tools.includes("shell")) {
    instructions.push(
      "- Prefer available dedicated tools over shell commands; use the shell when explicitly requested, necessary, or more efficient for repetitive work.",
      "- Do not chain shell commands with separators like `echo \"====\";` or `printf '---'`; the output becomes noisy in a way that makes the user's side of the conversation worse.",
    )
  }
  if (tools.includes("write")) {
    instructions.push(
      `- Use the write tool to create files or completely replace their content.${tools.includes("edit") ? " Prefer the edit tool for targeted changes." : ""}`,
    )
  }
  if (tools.includes("patch")) {
    instructions.push(
      "- Use patch, the combined write/edit/delete/rename tool, for file-oriented changes. Supply patchText with Begin Patch/End Patch and Add File, Update File (optionally Move to), or Delete File sections; prefix added lines with +.",
    )
  }
  if (tools.includes("edit")) {
    instructions.push(
      "- Use the edit tool for targeted changes to existing text files. It replaces the exact text in `oldString` with `newString`, and the values must differ. By default, `oldString` must occur exactly once. If it occurs multiple times, include more surrounding context to make it unique or set `replaceAll` to true to replace every occurrence.",
    )
  }
  return prompt.replace("${OPENCODE_TOOL_GUIDANCE}", instructions.join("\n"))
}
