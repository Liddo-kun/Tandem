// Tandem-owned (not in upstream): under an Execute row, link the sessions its
// opencode.session_start calls started. Core copies their IDs into the Execute metadata.
import { For } from "solid-js"
import { useData } from "../context/data"
import { useMarkdown } from "../context/markdown"
import type { ToolComponent, ToolProps } from "./tool-renderer"

export function withStartedSessions(Execute: ToolComponent): ToolComponent {
  return (props: ToolProps) => {
    const data = useData()
    const markdown = useMarkdown()
    const started = () => {
      const value = props.metadata.tandemStartedSessions
      return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
    }
    const title = (id: string) => data.store.session.find((session) => session.id === id)?.title

    return (
      <>
        <Execute {...props} />
        <For each={started()}>
          {(id) => (
            <button
              type="button"
              data-slot="tandem-tool-preview"
              data-tandem-session-start
              onClick={() => markdown?.openSession?.(id)}
            >
              <span data-slot="tandem-tool-branch" aria-hidden="true" />
              <span data-slot="tandem-tool-preview-text" dir="auto">
                Session started ({title(id) || id})
              </span>
            </button>
          )}
        </For>
      </>
    )
  }
}
