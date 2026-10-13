export * as ClaudeInstructions from "./instructions.js"

import type { Schema } from "effect"
import type { Instructions } from "../../../instructions/index.js"
import { ClaudePresentation } from "./presentation.js"
import { BashSearch } from "../bash-search/plugin.js"

const ENVIRONMENT = /^(?:Here is some useful information about the environment you are running in:|The environment you are running in is now:)\n<env>\n[\s\S]*?\n<\/env>/m

/** The stored `<env>` block as Claude Code's environment fields. */
const entries = (env: string) => {
  const lines = env.split("\n").slice(1, -1).map((line) => line.trim())
  const field = (label: string) => lines.find((line) => line.startsWith(`${label}: `))?.slice(label.length + 2)
  return lines.flatMap((line) => {
    if (line.startsWith("Working directory: ")) return [`Primary working directory: ${field("Working directory")}`]
    if (line.startsWith("Is directory a git repo: ")) return [`Is a git repository: ${field("Is directory a git repo") === "yes"}`]
    // Claude Code has no project-root field, so it is kept only when it differs.
    if (line.startsWith("Workspace root folder: ") && field("Workspace root folder") === field("Working directory")) return []
    return [line]
  })
}

/** Claude Code 2.1.291's `# Environment` section, and `# Environment update` with changed fields only. */
const environment = (text: string, current: Schema.Json, previous?: Schema.Json) => {
  if (typeof current !== "string") return text
  const after = entries(current)
  const before = typeof previous === "string" ? entries(previous) : undefined
  const changed = before && after.filter((line) => !before.includes(line)).map((line) => {
    const label = line.slice(0, line.indexOf(": ") + 2)
    const old = before.find((entry) => entry.startsWith(label))
    return old ? `${line} (was ${old.slice(label.length)})` : line
  })
  const [heading, items] = changed?.length
    ? [["# Environment update"], changed]
    : [["# Environment", "You have been invoked in the following environment: "], after]
  return text.replace(ENVIRONMENT, () => [...heading, ...items.map((line) => ` - ${line}`)].join("\n"))
}

/** Presentation-only renderers: stored source values/hashes and frozen updates remain v2-owned. */
export function present(sources: Instructions.List, shellSearch: boolean): Instructions.List {
  return sources.map((source) => {
    const render = (text: string | undefined, current?: Schema.Json, previous?: Schema.Json) => {
      if (text === undefined) return text
      if (source.key === "core/environment" && current !== undefined) text = environment(text, current, previous)
      if (source.key === "core/skill-guidance") text = text
        .replace(/<available_skills>\n([\s\S]*?)\n<\/available_skills>/g, "Available skills (invoke by ID):\n$1")
        .replace(/\s*<skill>\s*<id>([\s\S]*?)<\/id>\s*<name>([\s\S]*?)<\/name>\s*<description>([\s\S]*?)<\/description>\s*<\/skill>/g,
          (_match, id: string, name: string, description: string) => `\n- ${name}: ${description}${id === name ? "" : ` (ID: ${id})`}`)
      // Only harness-owned guidance is rewritten. File instructions and arbitrary prose are not.
      if (source.key === "core/skill-guidance") text = ClaudePresentation.references(text)
      if (source.key === "core/codemode") text = ClaudePresentation.executeReferences(text)
      return shellSearch && source.key.startsWith("core/") ? BashSearch.stripGuidance(text) : text
    }
    return { ...source, initial: (value) => render(source.initial(value), value), changed: (before, after) => render(source.changed(before, after), after, before), removed: (before) => render(source.removed(before)) }
  })
}
