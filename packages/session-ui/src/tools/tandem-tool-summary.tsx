// Tandem-owned (not in upstream): Tandem v1's compact tool summaries in v2's font and size.
// Rows read `● Name(subject)` with an optional `└ preview` line. Renderers mark each row's wrapper
// with its state for the dot; tandem-tool-summary.css draws the dot, parentheses and branch.
import { createMemo, Show } from "solid-js"
import stripAnsi from "strip-ansi"
import type { SessionMessageAssistantTool } from "@opencode/client/promise"
import { getFilename } from "@opencode/util/path"
import { useI18n } from "@opencode/ui/context/i18n"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import type { ApplyPatchFile } from "../components/apply-patch-file"
import { currentToolMetadata, executeToolFailed, shellResultFailed } from "../message/current-tool-state"

type ToolState = { name: string; status?: string; metadata: Record<string, unknown> }

function failed(tool: ToolState) {
  return (
    tool.status === "error" ||
    (tool.name === "execute" && executeToolFailed(tool.metadata)) ||
    (tool.name === "shell" && tool.status === "completed" && shellResultFailed(tool.metadata))
  )
}

/** Running while any tool is pending, then failed if any failed, else succeeded. */
export function toolDotState(tools: ToolState[]) {
  if (tools.some((tool) => tool.status === "streaming" || tool.status === "running")) return "running"
  if (tools.some(failed)) return "error"
  if (tools.length > 0 && tools.every((tool) => tool.status === "completed")) return "success"
  return "neutral"
}

export function toolPartsDotState(parts: SessionMessageAssistantTool[]) {
  return toolDotState(
    parts.map((part) => ({ name: part.name, status: part.state.status, metadata: currentToolMetadata(part) })),
  )
}

/** First nonempty line of tool output, without terminal escapes. */
export function firstLine(value: unknown) {
  if (typeof value !== "string") return undefined
  return stripAnsi(value)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
}

export function ToolPreview(props: { text?: string }) {
  return (
    <Show when={props.text}>
      {(text) => (
        <div data-slot="tandem-tool-preview">
          <span data-slot="tandem-tool-branch" aria-hidden="true" />
          <span data-slot="tandem-tool-preview-text" dir="auto">
            {text()}
          </span>
        </div>
      )}
    </Show>
  )
}

/** Header for one file of a patch, edit or write: `● Patch(path)` and `└ Updated name with 1 addition`. */
export function PatchSummary(props: {
  title: string
  path: string
  file: Pick<ApplyPatchFile, "path" | "type" | "additions" | "deletions">
  pending: boolean
}) {
  const i18n = useI18n()

  const preview = createMemo(() => {
    const { type, additions, deletions } = props.file
    const file = getFilename(props.file.path)
    if (type === "add") return i18n.plural("ui.tool.summary.created", additions, { file, count: additions })
    if (type === "delete") return i18n.t("ui.tool.summary.deleted", { file })
    const changes = [
      additions ? i18n.plural("ui.tool.summary.additions", additions, { count: additions }) : "",
      deletions ? i18n.plural("ui.tool.summary.removals", deletions, { count: deletions }) : "",
    ].filter(Boolean)
    const summary =
      changes.length === 2
        ? i18n.t("ui.tool.summary.both", { first: changes[0], second: changes[1] })
        : (changes[0] ?? i18n.t("ui.tool.summary.noChanges"))
    return i18n.t("ui.tool.summary.updated", { file, changes: summary })
  })

  return (
    <div data-tandem-tool-state={props.pending ? "running" : "success"} data-tandem-patch-summary="">
      <div data-component="tool-trigger">
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={props.title} active={props.pending} />
            </span>
            <span data-slot="basic-tool-tool-subtitle">
              <bdi dir="ltr">{props.path}</bdi>
            </span>
          </div>
          <Show when={!props.pending}>
            <ToolPreview text={preview()} />
          </Show>
        </div>
      </div>
    </div>
  )
}
