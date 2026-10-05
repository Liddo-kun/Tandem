// Tandem-owned (not in upstream): browser webfetch tool display.
import { createMemo, For, Show } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import { TextShimmer } from "@opencode/ui/text-shimmer"
import { BasicTool } from "../components/basic-tool"
import { Markdown } from "../components/markdown"
import type { ToolProps } from "./tool-renderer"

export function WebFetchRenderer(props: ToolProps) {
  const i18n = useI18n()
  const pending = () => props.status === "streaming" || props.status === "running"
  const url = createMemo(() => {
    const value = props.metadata.url ?? props.input.url
    if (typeof value !== "string" || !/^https?:\/\//i.test(value)) return ""
    return value
  })
  const answer = createMemo(() => typeof props.metadata.answer === "string" ? props.metadata.answer : props.output ?? "")
  const preview = createMemo(() => answer().replace(/\s+/g, " ").slice(0, 220))
  const paths = createMemo(() => Array.isArray(props.metadata.paths) ? props.metadata.paths.filter((value): value is string => typeof value === "string") : [])
  return (
    <BasicTool
      {...props}
      icon="window-cursor"
      hasContent={!!answer()}
      defer={props.deferContent}
      trigger={
        <div style={{ "min-width": "0", "line-height": "var(--line-height-compact)" }}>
          <div data-slot="basic-tool-tool-info-main">
            <TextShimmer text={i18n.t("ui.tool.webfetch")} active={pending()} />
            <Show when={url()}>
              <a class="webfetch-link" href={url()} target="_blank" rel="noopener noreferrer" onClick={(event) => event.stopPropagation()}>
                <bdi dir="ltr" style={{ "overflow-wrap": "anywhere" }}>{url()}</bdi>
              </a>
            </Show>
          </div>
          <Show when={!pending() && preview()}>
            <div dir="auto" style={{ "font-size": "13px", "line-height": "var(--line-height-compact)", "overflow-wrap": "anywhere" }}>{preview()}</div>
          </Show>
        </div>
      }
    >
      <Show when={answer()}><Markdown text={answer()} /></Show>
      <For each={paths()}>{(file) => <div><bdi dir="ltr"><code style={{ "overflow-wrap": "anywhere" }}>{file}</code></bdi></div>}</For>
    </BasicTool>
  )
}
