// Tandem-owned (not in upstream): Claude Code-style rewind confirmation and per-prompt file-change counts.
import type { SessionMessageInfo } from "@opencode/client/promise"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { DiffChanges } from "@opencode/ui/diff-changes"
import { createMemo, createResource, For, Show, type Accessor } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { useServerSDK } from "@/runtime/server/client"

// The files the server's revert plan restores: every file recorded by an assistant step's snapshot.
function collect(messages: readonly SessionMessageInfo[]) {
  const files = new Set<string>()
  for (const message of messages) {
    if (message.type !== "assistant" || !message.snapshot?.start) continue
    for (const file of message.snapshot.files ?? []) files.add(file)
  }
  return [...files]
}

/**
 * Whether `session.diff` would count this prompt's lines from an earlier one. Like core's `SessionDiff.turn`, once a
 * session has idle markers a turn opens at the first prompt after the previous marker, so a prompt sent while the agent
 * was working shares that turn and its counts would include earlier work.
 */
function shared(messages: readonly SessionMessageInfo[], index: number) {
  if (!messages.some((message) => message.type === "idle")) return false
  return (
    messages.slice(0, index).findLast((message) => message.type === "idle" || message.type === "user")?.type === "user"
  )
}

/**
 * What rewinding to `messageID` with files restores: the files changed after it, plus those a pending revert restored,
 * which the server puts back first. `to` is the prompt whose turn made the last change, the end of the range
 * `session.diff` counts lines over.
 */
function range(messages: readonly SessionMessageInfo[], messageID: string, pending: readonly string[]) {
  const index = messages.findIndex((message) => message.id === messageID)
  if (index === -1) return { files: [...pending], shared: false }
  const last = messages.findLastIndex((message) => message.type === "assistant" && !!message.snapshot?.start)
  const to = messages.slice(0, last).findLast((message) => message.type === "user")
  return {
    files: [...new Set([...collect(messages.slice(index + 1)), ...pending])],
    to: last > index && to?.id !== messageID ? to?.id : undefined,
    shared: shared(messages, index),
  }
}

/** How many files each prompt's turn changed, up to the next prompt, built in one pass over the session. */
export function createTandemTurnFileCounts(messages: Accessor<readonly SessionMessageInfo[]>) {
  const counts = createMemo(() => {
    const result = new Map<string, number>()
    let prompt: string | undefined
    let files = new Set<string>()
    const close = () => {
      if (prompt && files.size) result.set(prompt, files.size)
    }
    for (const message of messages()) {
      if (message.type === "user") {
        close()
        prompt = message.id
        files = new Set()
        continue
      }
      if (message.type !== "assistant" || !message.snapshot?.start) continue
      for (const file of message.snapshot.files ?? []) files.add(file)
    }
    close()
    return result
  })
  return (messageID: string) => counts().get(messageID) ?? 0
}

function RewindDialog(props: {
  sessionID: string
  messageID: string
  messages: Accessor<readonly SessionMessageInfo[]>
  pending: Accessor<readonly string[]>
  choose: (files: boolean | undefined) => void
}) {
  const language = useLanguage()
  const server = useServerSDK()
  const rewind = createMemo(() => range(props.messages(), props.messageID, props.pending()))
  const files = () => rewind().files
  // Line counts arrive after the dialog opens; without them the paths still show. A failed request yields no counts,
  // so every file is then marked unknown.
  const [diffs] = createResource(
    () => (!rewind().shared && files().length > 0 ? (rewind().to ?? "") : false),
    (to) =>
      server.api.session
        .diff({ sessionID: props.sessionID, from: props.messageID, to: to || undefined, context: 0 })
        .then((diffs) => new Map(diffs.map((diff) => [diff.file, diff])))
        .catch(() => new Map()),
  )
  // Files `session.diff` cannot count: all of them for a shared turn, else the ones it does not return.
  const unknown = (file: string) => rewind().shared || (diffs() !== undefined && !diffs()!.has(file))

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("session.rewind.title")}
          description={language.t("session.rewind.description")}
        />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-2 px-4 text-[13px] leading-[var(--line-height-compact)]">
        <Show
          when={files().length > 0}
          fallback={<p class="text-v2-text-text-base">{language.t("session.rewind.noFiles")}</p>}
        >
          <p class="text-v2-text-text-base">{language.plural("session.rewind.files", files().length)}</p>
          {/* Rows keep their height and the list scrolls; flex would otherwise squeeze them into the cap. */}
          <div class="flex max-h-40 flex-col overflow-y-auto">
            <For each={files()}>
              {(file) => (
                <div class="flex h-5 shrink-0 items-center justify-between gap-2">
                  <span dir="ltr" class="min-w-0 truncate text-start text-v2-text-text-muted">
                    {file}
                  </span>
                  <Show
                    when={!unknown(file) && diffs()?.get(file)}
                    fallback={
                      <Show when={unknown(file)}>
                        {/* Styled like DiffChanges: changed, by an unknown number of lines. */}
                        <div data-component="diff-changes" data-appearance="compact" class="shrink-0">
                          <span data-slot="diff-changes-additions">+?</span>
                          <span data-slot="diff-changes-deletions">-?</span>
                        </div>
                      </Show>
                    }
                  >
                    {(diff) => <DiffChanges changes={diff()} class="shrink-0" />}
                  </Show>
                </div>
              )}
            </For>
          </div>
          <Show when={files().some(unknown)}>
            <p class="text-v2-text-text-muted">{language.t("session.rewind.unknownCounts")}</p>
          </Show>
        </Show>
        <p class="text-v2-text-text-muted">
          <Show when={files().length > 0}>{language.t("session.rewind.overwrite")} </Show>
          {language.t("session.rewind.notCovered")}
        </p>
      </DialogBody>
      <DialogFooter>
        {/* Wraps onto another row on phones rather than squeezing the labels. */}
        <div class="flex flex-wrap justify-end gap-2 [&>button]:whitespace-nowrap">
          <Button variant="ghost" onClick={() => props.choose(undefined)}>
            {language.t("common.cancel")}
          </Button>
          <Show
            when={files().length > 0}
            fallback={
              <Button variant="contrast" autofocus onClick={() => props.choose(true)}>
                {language.t("session.rewind.confirm")}
              </Button>
            }
          >
            <Button variant="neutral" onClick={() => props.choose(false)}>
              {language.t("session.rewind.conversation")}
            </Button>
            <Button variant="contrast" autofocus onClick={() => props.choose(true)}>
              {language.t("session.rewind.conversationAndFiles")}
            </Button>
          </Show>
        </div>
      </DialogFooter>
    </Dialog>
  )
}

/**
 * Asks how to rewind to a prompt. Resolves `true` to restore files too, `false` for the conversation only, and
 * `undefined` when cancelled. Without recorded file changes there is only one choice.
 */
export function useTandemRewindConfirm() {
  const dialog = useDialog()

  return (input: {
    sessionID: string
    messageID: string
    messages: Accessor<readonly SessionMessageInfo[]>
    pending: Accessor<readonly string[]>
  }) =>
    new Promise<boolean | undefined>((resolve) => {
      const choose = (value: boolean | undefined) => {
        resolve(value)
        dialog.close()
      }
      dialog.show(
        () => <RewindDialog {...input} choose={choose} />,
        () => resolve(undefined),
      )
    })
}
