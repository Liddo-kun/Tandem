// Tandem-owned (not in upstream): browser webfetch tool display.
import { createMemo, For, Show } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { BasicTool } from "../components/basic-tool"
import { Markdown } from "../components/markdown"
import type { ToolProps } from "./tool-renderer"
import { firstLine, ToolPreview } from "./tandem-tool-summary"

export function WebFetchRenderer(props: ToolProps) {
  const i18n = useI18n()
  const pending = () => props.status === "streaming" || props.status === "running"
  const url = createMemo(() => {
    const value = props.metadata.url ?? props.input.url
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return ""
    return value
  })
  const answer = createMemo(() => typeof props.metadata.answer === "string" ? props.metadata.answer : props.output ?? "")
  // One plain line: drop Markdown heading marks, bold and code ticks.
  const preview = createMemo(() => firstLine(answer())?.replace(/^#+\s*/, "").replace(/\*\*|`/g, ""))
  const shotError = createMemo(() => typeof props.metadata.screenshotError === "string" ? props.metadata.screenshotError : undefined)
  const paths = createMemo(() => Array.isArray(props.metadata.paths) ? props.metadata.paths.filter((value): value is string => typeof value === "string") : [])
  return (
    <BasicTool
      {...props}
      icon="window-cursor"
      hasContent={!!answer()}
      defer={props.deferContent}
      trigger={
        <div data-slot="basic-tool-tool-info-structured">
          <div data-slot="basic-tool-tool-info-main">
            <span data-slot="basic-tool-tool-title">
              <TextShimmer text={i18n.t("ui.tool.webfetch")} active={pending()} />
            </span>
            <Show when={url()}>
              <a
                data-slot="basic-tool-tool-subtitle"
                href={url()}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(event) => event.stopPropagation()}
              >
                <bdi dir="ltr">{url()}</bdi>
              </a>
            </Show>
          </div>
          <Show when={!pending()}>
            <ToolPreview text={preview()} />
          </Show>
        </div>
      }
    >
      <Show when={answer()}><Markdown text={answer()} /></Show>
      <Show when={shotError()}>{(error) => <div>{i18n.t("ui.tool.webfetch.screenshotFailed", { error: error() })}</div>}</Show>
      <For each={paths()}>{(file) => <div><bdi dir="ltr"><code style={{ "overflow-wrap": "anywhere" }}>{file}</code></bdi></div>}</For>
    </BasicTool>
  )
}
