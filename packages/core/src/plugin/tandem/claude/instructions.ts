export * as ClaudeInstructions from "./instructions.js"

import type { Instructions } from "../../../instructions/index.js"
import { ClaudePresentation } from "./presentation.js"
import { BashSearch } from "../bash-search/plugin.js"

/** Presentation-only renderers: stored source values/hashes and frozen updates remain v2-owned. */
export function present(sources: Instructions.List, shellSearch: boolean): Instructions.List {
  return sources.map((source) => {
    const render = (text: string | undefined) => {
      if (text === undefined) return text
      if (source.key === "core/skill-guidance") text = text
        .replace(/<available_skills>\n([\s\S]*?)\n<\/available_skills>/g, "Available skills (invoke by ID):\n$1")
        .replace(/\s*<skill>\s*<id>([\s\S]*?)<\/id>\s*<name>([\s\S]*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<\/skill>/g,
          (_match, id: string, name: string, description: string) => `\n- ${name}: ${description}${id === name ? "" : ` (ID: ${id})`}`)
      if (source.key === "core/environment") text = text.replace("Here is some useful information about the environment you are running in:", "Environment context you are running in:")
      // Only harness-owned guidance is rewritten. File instructions and arbitrary prose are not.
      if (source.key === "core/skill-guidance") text = ClaudePresentation.references(text)
      if (source.key === "core/codemode") text = ClaudePresentation.executeReferences(text)
      return shellSearch && source.key.startsWith("core/") ? BashSearch.stripGuidance(text) : text
    }
    return { ...source, initial: (value) => render(source.initial(value)), changed: (before, after) => render(source.changed(before, after)), removed: (before) => render(source.removed(before)) }
  })
}
