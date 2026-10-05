// Tandem-owned (not in upstream): image generation tool display.
import { createEffect, createMemo, onCleanup, onMount, Show } from "solid-js"
import { BasicTool } from "../components/basic-tool"
import { createMarkdownImages } from "../components/markdown-image"
import { createImagePreview } from "../components/image-preview"
import { useMarkdown } from "../context/markdown"
import { getFilename } from "@opencode/util/path"
import type { ToolProps } from "./tool-renderer"

export function ImagegenRenderer(props: ToolProps) {
  const path = createMemo(() => (typeof props.metadata.path === "string" ? props.metadata.path : ""))
  const revised = createMemo(() =>
    typeof props.metadata.revisedPrompt === "string" ? props.metadata.revisedPrompt : "",
  )
  return (
    <BasicTool
      {...props}
      defaultOpen={props.defaultOpen ?? true}
      icon="file"
      hasContent={!!path()}
      defer={props.deferContent}
      trigger={{ title: "imagegen", subtitle: path() ? getFilename(path()) : undefined }}
    >
      <Show when={path()}>
        <SavedImage path={path()} revised={revised()} onContentRendered={props.onContentRendered} />
      </Show>
    </BasicTool>
  )
}

function SavedImage(props: { path: string; revised: string; onContentRendered?: () => void }) {
  const markdown = useMarkdown()
  const preview = createImagePreview()
  let root: HTMLDivElement | undefined
  // Uses the same authenticated Blob reader as ordinary Markdown and Read previews.
  // No resource/Suspense boundary and no image data is added to session history.
  onMount(() => {
    if (!root || !markdown?.readImage) return
    const images = createMarkdownImages(markdown.readImage)
    createEffect(() => {
      props.path
      if (!root) return
      images.update(root)
      preview(root)
    })
    onCleanup(() => images.dispose())
  })
  return (
    <div ref={root} data-component="read-image">
      <img
        data-local-image={props.path}
        alt={getFilename(props.path)}
        onLoad={() => props.onContentRendered?.()}
        onError={() => props.onContentRendered?.()}
      />
      <div>
        <bdi dir="ltr">
          <code>{props.path}</code>
        </bdi>
      </div>
      <Show when={props.revised}>
        <div dir="auto">{props.revised}</div>
      </Show>
    </div>
  )
}
