// Tandem-owned (not in upstream): the app's pending-revert strip above the composer, like the TUI's RevertMessage.
import { createMemo, For, Show } from "solid-js"
import { Button } from "@opencode/ui/button"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { Icon } from "@opencode/ui/icon"
import { useCommand } from "@/shell/commands/command"
import { useLanguage } from "@/runtime/i18n/language"
import { useData } from "@/runtime/server/current"
import type { SessionModel } from "../model"

// Attached to the top of the composer like the queue panel, so a staged revert stays visible at any scroll position
// and redo is one tap away until the next prompt commits it.
export function TandemRevertPanel(props: { session: SessionModel }) {
  const command = useCommand()
  const data = useData()
  const language = useLanguage()
  const revert = () => props.session.data.info()?.revert
  const files = () => revert()?.files ?? []

  // Undelivered prompts behind the boundary show in the queue panel, so only reverted history counts.
  const count = createMemo(() => {
    const sessionID = props.session.identity.params.id
    const messages = props.session.history.userMessages()
    const index = messages.findIndex((message) => message.id === revert()?.messageID)

    if (!sessionID || index === -1) return 0

    return messages.slice(index).filter((message) => !data.session.input.has(sessionID, message.id)).length
  })

  return (
    <Show when={revert()}>
      <div
        data-component="tandem-revert-panel"
        class="relative z-0 -mb-3 rounded-xl bg-v2-background-bg-base px-1.5 pt-1.5 pb-[18px] shadow-[inset_0_0_0_0.5px_var(--v2-border-border-base)]"
      >
        <div class="flex min-h-8 items-center justify-between gap-2 py-1 ps-2 pe-1">
          <div class="flex min-w-0 items-start gap-2 text-[13px] font-[440] leading-[var(--line-height-compact)]">
            <Icon name="outline-undo" size="small" class="mt-px shrink-0 text-v2-text-text-muted" />
            {/* The warning wraps instead of truncating: on narrow screens it is the part that matters. */}
            <div class="flex min-w-0 flex-wrap gap-x-2">
              <span class="text-v2-text-text-base">{language.plural("session.revert.count", count())}</span>
              <span class="text-v2-text-text-muted">{language.t("session.revert.pending")}</span>
            </div>
          </div>
          <Button
            data-action="tandem-revert-redo"
            type="button"
            size="small"
            variant="ghost-faint"
            class="shrink-0 ![font-weight:530]"
            onClick={() => command.trigger("session.redo")}
          >
            {language.t("session.revert.redo")}
          </Button>
        </div>
        <Show when={files().length > 0}>
          {/* Four rows and half a row hint at more reverted files. */}
          <div
            class="flex flex-col gap-px"
            classList={{ "max-h-[116px] overflow-y-auto": files().length > 4 }}
            style={{
              "mask-image":
                files().length > 4
                  ? "linear-gradient(to bottom, transparent, black 8px, black calc(100% - 12px), transparent)"
                  : undefined,
            }}
          >
            <For each={files()}>
              {(file) => (
                <div class="flex h-6 shrink-0 items-center justify-between gap-2 ps-8 pe-2 text-[13px] font-[440] leading-[var(--line-height-compact)]">
                  <span dir="ltr" class="min-w-0 truncate text-start text-v2-text-text-muted">
                    {file.file}
                  </span>
                  <DiffChanges changes={file} class="shrink-0" />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </Show>
  )
}
