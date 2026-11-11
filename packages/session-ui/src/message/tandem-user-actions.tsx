import { Show, type ComponentProps, type JSX } from "solid-js"
import { useI18n } from "@opencode/ui/context/i18n"
import { Tooltip } from "@opencode/ui/tooltip"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { createCopyFeedback } from "../components/copy"
import type { MessageAction } from "./action-machine"
import "./tandem-user-actions.css"

function ActionButton(props: {
  icon: ComponentProps<typeof Icon>["name"]
  label: JSX.Element & string
  disabled?: boolean
  onClick: () => void
}) {
  return (
    <Tooltip appearance="compact" value={props.label} placement="top" gutter={4}>
      <IconButton
        icon={<Icon name={props.icon} size="small" />}
        size="small"
        variant="ghost-muted"
        disabled={props.disabled}
        onMouseDown={(event: MouseEvent) => event.preventDefault()}
        onClick={(event: MouseEvent) => {
          event.stopPropagation()
          props.onClick()
        }}
        aria-label={props.label}
      />
    </Tooltip>
  )
}

/**
 * Tandem keeps a prompt's actions as buttons at the end of its meta line, with the time it was sent, where upstream
 * moved them into a chevron menu on the bubble. The chevron is hidden wherever this line shows (tandem-user-actions.css).
 * The actions run through the caller's action machine, like the menu's.
 */
export function TandemUserActions(props: {
  /** When the prompt was sent, as the menu words it. A steer still waiting has none. */
  sent?: string
  created: number
  /** The meta line has labels before the time, so a dot sets the time apart. */
  separated: boolean
  /** A pending steer is moved to the queue or deleted rather than reverted, forked or copied from. */
  pending: boolean
  revert: boolean
  /** The newest delivered prompt, whose revert undoes the last turn. */
  latest?: boolean
  disabled: Record<MessageAction, boolean>
  text: string
  request: (action: MessageAction) => void
}) {
  const i18n = useI18n()
  const copy = createCopyFeedback()

  return (
    <>
      <Show when={props.sent}>
        {(sent) => (
          <span data-slot="user-message-meta-tail">
            {props.separated ? "\u00B7" : ""}
            <time dateTime={new Date(props.created).toISOString()}>{sent()}</time>
          </span>
        )}
      </Show>
      <span data-slot="tandem-user-actions">
        <Show
          when={props.pending}
          fallback={
            <>
              <Show when={props.revert}>
                <ActionButton
                  icon={props.latest ? "outline-undo" : "reset"}
                  label={props.latest ? i18n.t("ui.message.undoMessage") : i18n.t("ui.message.revertMessage")}
                  disabled={props.disabled.revert}
                  onClick={() => props.request("revert")}
                />
              </Show>
              <ActionButton
                icon="fork"
                label={i18n.t("ui.message.forkMessage")}
                disabled={props.disabled.fork}
                onClick={() => props.request("fork")}
              />
            </>
          }
        >
          <ActionButton
            icon="bullet-list"
            label={i18n.t("ui.message.moveToQueue")}
            disabled={props.disabled.queue}
            onClick={() => props.request("queue")}
          />
          <ActionButton
            icon="outline-trash"
            label={i18n.t("ui.message.deletePending")}
            disabled={props.disabled.remove}
            onClick={() => props.request("remove")}
          />
        </Show>
        <ActionButton
          icon={copy.copied() ? "check" : "outline-copy"}
          label={copy.copied() ? i18n.t("ui.message.copied") : i18n.t("ui.message.copyMessage")}
          disabled={!props.text}
          onClick={() => copy.copy(props.text)}
        />
      </span>
    </>
  )
}
