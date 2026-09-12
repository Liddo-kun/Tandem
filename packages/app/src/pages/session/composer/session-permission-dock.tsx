import { For, Show } from "solid-js"
import type { PermissionRequest } from "@opencode-ai/sdk/v2"
import { Button } from "@opencode-ai/ui/button"
import { DockPrompt } from "@opencode-ai/session-ui/dock-prompt"
import { Icon } from "@opencode-ai/ui/icon"
import { useLanguage } from "@/context/language"

// UPSTREAM-DIVERGENCE: request-local dismissal and bounded browser origin/tab details replace opaque grant patterns.
export function SessionPermissionDock(props: {
  request: PermissionRequest
  responding: boolean
  onDecide: (response: "once" | "always" | "reject" | "dismiss") => void
}) {
  const language = useLanguage()

  const toolDescription = () => {
    const key = `settings.permissions.tool.${props.request.permission}.description`
    const value = language.t(key as Parameters<typeof language.t>[0])
    if (value === key) return ""
    return value
  }

  const metadata = (key: string) => {
    const value = props.request.metadata?.[key]
    return typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 256) : ""
  }

  return (
    <DockPrompt
      kind="permission"
      header={
        <div data-slot="permission-row" data-variant="header">
          <span data-slot="permission-icon">
            <Icon name="warning" size="normal" />
          </span>
          <div data-slot="permission-header-title">{language.t("notification.permission.title")}</div>
        </div>
      }
      footer={[
        <div />,
        <div data-slot="permission-footer-actions">
          <Button variant="ghost" size="normal" onClick={() => props.onDecide("dismiss")} disabled={props.responding}>
            {language.t("common.dismiss")}
          </Button>
          <Button variant="ghost" size="normal" onClick={() => props.onDecide("reject")} disabled={props.responding}>
            {language.t("ui.permission.deny")}
          </Button>
          <Button
            variant="secondary"
            size="normal"
            onClick={() => props.onDecide("always")}
            disabled={props.responding}
          >
            {language.t("ui.permission.allowAlways")}
          </Button>
          <Button variant="primary" size="normal" onClick={() => props.onDecide("once")} disabled={props.responding}>
            {language.t("ui.permission.allowOnce")}
          </Button>
        </div>,
      ]}
    >
      <Show when={toolDescription()}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-hint">{toolDescription()}</div>
        </div>
      </Show>

      <Show when={props.request.permission === "browser"}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <code class="text-12-regular text-text-base break-all">
              {[metadata("browser"), metadata("capability")].filter(Boolean).join(" / ")}
            </code>
            <Show when={metadata("origin")}>
              <code class="text-12-regular text-text-base break-all">{metadata("origin")}</code>
            </Show>
            <Show when={metadata("tabTitle")}>
              <code class="text-12-regular text-text-base break-all">{metadata("tabTitle")}</code>
            </Show>
            <Show when={metadata("tabScope")}>
              <code class="text-12-regular text-text-base break-all">{metadata("tabScope")}</code>
            </Show>
          </div>
        </div>
      </Show>

      <Show when={props.request.permission !== "browser" && props.request.patterns.length > 0}>
        <div data-slot="permission-row">
          <span data-slot="permission-spacer" aria-hidden="true" />
          <div data-slot="permission-patterns">
            <For each={props.request.patterns}>
              {(pattern) => <code class="text-12-regular text-text-base break-all">{pattern}</code>}
            </For>
          </div>
        </div>
      </Show>
    </DockPrompt>
  )
}
