import type { JSX } from "solid-js"
import { Show } from "solid-js"
import { Tabs } from "@opencode-ai/ui/tabs"
import { useLanguage } from "@/context/language"

export type MessageTimelineMobileTabsConfig = {
  value: "session" | "changes"
  changesLabel: string
  onChange: (value: "session" | "changes") => void
}

export function MessageTimelineMobileTabs(props: {
  tabs?: MessageTimelineMobileTabsConfig
  title: string
  actions: () => JSX.Element
}) {
  const language = useLanguage()

  return (
    <Show when={props.tabs} keyed>
      {(tabs) => (
        <Tabs value={tabs.value} class="h-auto shrink-0">
          <Tabs.List class="!h-9 !px-2 !py-1 !bg-background-stronger">
            <Tabs.Trigger
              value="session"
              class="!w-[65%] !max-w-none !h-full text-13-medium"
              classes={{ button: "flex-1 !h-full !px-2 !py-0 min-w-0" }}
              closeButton={
                <div class="flex items-center gap-3 pl-1" onPointerDown={(event) => event.stopPropagation()}>
                  {props.actions()}
                </div>
              }
              onClick={() => tabs.onChange("session")}
            >
              <span class="min-w-0 truncate text-center">
                <span class="text-text-weak">{language.t("session.tab.session")}: </span>
                {props.title}
              </span>
            </Tabs.Trigger>
            <Tabs.Trigger
              value="changes"
              class="!w-[35%] !max-w-none !h-full !border-r-0 text-13-medium"
              classes={{ button: "w-full !h-full !px-2 !py-0" }}
              onClick={() => tabs.onChange("changes")}
            >
              {tabs.changesLabel}
            </Tabs.Trigger>
          </Tabs.List>
        </Tabs>
      )}
    </Show>
  )
}
