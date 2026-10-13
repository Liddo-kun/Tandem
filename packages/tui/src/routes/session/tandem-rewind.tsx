// Tandem-owned (not in upstream): Claude Code-style rewind confirmation and per-prompt file-change counts.
import type { SessionMessageInfo } from "@opencode/client"
import { createMemo, createResource, For, Show } from "solid-js"
import { useClient } from "../../context/client"
import { useData } from "../../context/data"
import { useTheme } from "../../context/theme"
import { useDialog } from "../../ui/dialog"
import { DialogSelect } from "../../ui/dialog-select"

// Previewed rows; the rest are counted.
const PREVIEW = 8

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
function tandemRewindRange(
  messages: readonly SessionMessageInfo[],
  messageID: string,
  pending: readonly { file: string }[] = [],
) {
  const files = pending.map((file) => file.file)
  const index = messages.findIndex((message) => message.id === messageID)
  if (index === -1) return { files, shared: false }
  const last = messages.findLastIndex((message) => message.type === "assistant" && !!message.snapshot?.start)
  const to = messages.slice(0, last).findLast((message) => message.type === "user")
  return {
    files: [...new Set([...collect(messages.slice(index + 1)), ...files])],
    to: last > index && to?.id !== messageID ? to?.id : undefined,
    shared: shared(messages, index),
  }
}

/** How many files each prompt's turn changed, up to the next prompt. */
export function tandemTurnFileCounts(messages: readonly SessionMessageInfo[]) {
  const result = new Map<string, number>()
  let start = -1
  const close = (end: number) => {
    const prompt = messages[start]
    const count = prompt ? collect(messages.slice(start + 1, end)).length : 0
    if (prompt && count) result.set(prompt.id, count)
  }
  messages.forEach((message, index) => {
    if (message.type !== "user") return
    close(index)
    start = index
  })
  close(messages.length)
  return result
}

export function tandemFilesChanged(count: number) {
  return `${count} file${count === 1 ? "" : "s"} changed`
}

function DialogTandemRewind(props: { sessionID: string; messageID: string; onSelect: (files: boolean) => void }) {
  const dialog = useDialog()
  const theme = useTheme()
  const client = useClient()
  const data = useData()
  const range = createMemo(() =>
    tandemRewindRange(
      data.session.message.list(props.sessionID),
      props.messageID,
      data.session.get(props.sessionID)?.revert?.files,
    ),
  )
  const files = () => range().files
  // Line counts arrive after the dialog opens; without them the paths still show. A failed request yields no counts,
  // so every file is then marked unknown.
  const [diffs] = createResource(
    () => (!range().shared && files().length > 0 ? (range().to ?? "") : false),
    (to) =>
      client.api.session
        .diff({ sessionID: props.sessionID, from: props.messageID, to: to || undefined, context: 0 })
        .then((diffs) => new Map(diffs.map((diff) => [diff.file, diff])))
        .catch(() => new Map()),
  )
  // Files `session.diff` cannot count: all of them for a shared turn, else the ones it does not return.
  const unknown = (file: string) => range().shared || (diffs() !== undefined && !diffs()!.has(file))
  const options = () =>
    files().length
      ? [
          {
            title: "Conversation and files",
            value: true,
            description: `restore ${files().length} file${files().length === 1 ? "" : "s"}`,
          },
          { title: "Conversation only", value: false, description: "leave files as they are" },
        ]
      : [{ title: "Rewind", value: true, description: "no file changes recorded since this prompt" }]

  return (
    <DialogSelect
      title="Rewind to this prompt"
      options={options()}
      renderFilter={false}
      onSelect={(option) => {
        props.onSelect(option.value)
        dialog.clear()
      }}
      footer={
        <box flexDirection="column" paddingBottom={1}>
          <Show when={files().length}>
            <For each={files().slice(0, PREVIEW)}>
              {(file) => (
                <box flexDirection="row" gap={1}>
                  <text fg={theme.text.base}>{file}</text>
                  <Show
                    when={!unknown(file)}
                    fallback={
                      <>
                        <text fg={theme.diff.text.added}>+?</text>
                        <text fg={theme.diff.text.removed}>-?</text>
                      </>
                    }
                  >
                    <Show when={diffs()?.get(file)?.additions}>
                      {(count) => <text fg={theme.diff.text.added}>+{count()}</text>}
                    </Show>
                    <Show when={diffs()?.get(file)?.deletions}>
                      {(count) => <text fg={theme.diff.text.removed}>-{count()}</text>}
                    </Show>
                  </Show>
                </box>
              )}
            </For>
            <Show when={files().length > PREVIEW}>
              <text fg={theme.text.muted}>and {files().length - PREVIEW} more</text>
            </Show>
            <Show when={files().some(unknown)}>
              <text fg={theme.text.muted}>Files marked ? changed by an unknown number of lines.</text>
            </Show>
          </Show>
          <text fg={theme.text.muted}>
            {files().length ? "Restoring files overwrites any later edits to them, including yours. " : ""}
            Files outside the session's folder or ignored by Git, untracked files over 2 MB, and effects such as commits
            are not saved, so a rewind cannot bring them back.
          </text>
        </box>
      }
    />
  )
}

/**
 * Stops the agent, then asks how to rewind to a prompt, like Claude Code. Stopping first lets the preview include the
 * files the last step changed. Resolves `true` to restore files too, `false` for the conversation only, and `undefined`
 * when cancelled. Without recorded file changes there is only one choice.
 */
export function useTandemRewindConfirm() {
  const dialog = useDialog()
  const client = useClient()

  return async (sessionID: string, messageID: string) => {
    await client.api.session.interrupt({ sessionID })
    await client.api.session.wait({ sessionID })
    return new Promise<boolean | undefined>((resolve) =>
      dialog.replace(
        () => <DialogTandemRewind sessionID={sessionID} messageID={messageID} onSelect={resolve} />,
        () => resolve(undefined),
      ),
    )
  }
}
