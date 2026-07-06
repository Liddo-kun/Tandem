// UPSTREAM-DIVERGENCE: Tandem-only component (/compact-image, image-based context
// compaction). A compaction message carrying rendered transcript pages collapses to one
// <details> block instead of a strip of full-size images — mobile WebViews must not
// eagerly decode 30+ PNGs. Fork-owned so message-part.tsx carries only a small marked
// seam; styles live in the marked block in message-part.css (same data-slot names).
import { For } from "solid-js"
import { FilePart, Part as PartType } from "@opencode-ai/sdk/v2"
import { useI18n } from "@opencode-ai/ui/context/i18n"

/** A user message that is an image-compaction boundary: compaction part + page attachments. */
export function isImagedContext(parts: PartType[] | undefined, attachments: FilePart[]): boolean {
  return (parts?.some((p) => p.type === "compaction") ?? false) && attachments.length > 0
}

export function ImagedContextBlock(props: { pages: FilePart[]; onPreview: (url: string, alt?: string) => void }) {
  const i18n = useI18n()
  return (
    <details data-slot="user-message-imaged-context">
      <summary>Context imaged — {props.pages.length} pages</summary>
      <div data-slot="user-message-imaged-pages">
        <For each={props.pages}>
          {(file) => {
            const name = file.filename ?? i18n.t("ui.message.attachment.alt")
            return (
              <img
                data-slot="user-message-imaged-page"
                loading="lazy"
                src={file.url}
                alt={name}
                onClick={() => props.onPreview(file.url, name)}
              />
            )
          }}
        </For>
      </div>
    </details>
  )
}
