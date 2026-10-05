// Tandem-owned (not in upstream): model-facing Read, shell, and patch usage guidance.
export * as ToolGuidancePlugin from "./plugin.js"

import { define } from "@opencode/plugin/effect/plugin"
import type { SessionHooks } from "@opencode/plugin/effect/session"
import { Effect } from "effect"

export const Plugin = define({
  id: "tandem.tool-guidance",
  effect: Effect.fn("ToolGuidancePlugin.Plugin")(function* (ctx) {
    yield* ctx.tool.transform((editor) => {
      editor.update("read", (tool) => {
        tool.description =
          "Read the contents of a file or directory using path. Supports text files, images, and PDFs. Images and PDFs are presented directly to the model. Each text line is prefixed by its 1-based line number as <line>: <content>; the prefix is not part of the file content. Directory entries are returned one per line. When you know the needed section, use offset (1-based) and limit rather than reading the entire file. Use an available search tool to locate specific content or unknown filenames; otherwise use the available shell. Do not reread a file solely to verify your own successful edit; the editing tool reports failures."
      })
      editor.update("shell", (tool) => {
        tool.description = shellGuidance(tool.description)
      })
      editor.update("patch", (tool) => {
        tool.description = tool.description.replace(
          "Use the `patch` tool to edit files.",
          "The `patch` tool combines file creation, editing, deletion, and rename/move operations. Supply the patch in `patchText`.",
        )
      })
    }).pipe(Effect.orDie)

    // Upstream refreshes shell wording with the selected shell in these hooks.
    // Run afterward, before Claude's request-local name/description presentation.
    const hook = (event: SessionHooks["context"]) =>
      Effect.sync(() => {
        const tool = event.tools.shell
        if (tool) tool.description = shellGuidance(tool.description)
      })
    yield* ctx.session.hook("context", hook)
    yield* ctx.session.hook("compaction", hook)
    yield* ctx.session.hook("generate", hook)
  }),
})

function shellGuidance(description: string) {
  return description
    .replace(
      "Prefer dedicated tools over shell commands when possible.",
      [
        "Prefer available dedicated tools, but use the shell when explicitly requested, necessary, or more efficient for repetitive work.",
        "Use workdir instead of changing directories inside the command.",
        "For Bash-compatible shells, chain dependent commands with &&; use ; only when the later command should run regardless of failure. For PowerShell, check success explicitly before running dependent commands; do not assume && is supported.",
        "Do not chain commands with decorative echo or printf separators.",
      ].join(" "),
    )
    .replace(
      "Rely on automatic truncation unless filtering the output is more useful.",
      "Limit long output with a focused filter or bounded preview when useful, retaining full logs in the runtime scratch directory when needed for diagnosis.",
    )
}
