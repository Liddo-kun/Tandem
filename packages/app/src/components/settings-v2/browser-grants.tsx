import { createEffect, createMemo, For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { ButtonV2 } from "@opencode-ai/ui/v2/button-v2"
import { useLanguage } from "@/context/language"
import { useServerSDK } from "@/context/server-sdk"
import { useLayout } from "@/context/layout"
import { useTabs } from "@/context/tabs"
import { useServerSync } from "@/context/server-sync"
import { browserGrantScope } from "@/utils/browser-grant"
import { SettingsListV2 } from "./parts/list"
import { SettingsRowV2 } from "./parts/row"

type Grant = { id: string; projectID: string; action: string; resource: string }

export function useSettingsProject() {
  const layout = useLayout()
  const tabs = useTabs()
  const sync = useServerSync()
  const directory = createMemo(() => {
    const route = layout.route()
    if (route.type === "dir-new-sesssion") return route.dir
    if (route.type === "draft") {
      const draft = tabs.store.find((item) => item.type === "draft" && item.draftID === route.draftID)
      return draft?.type === "draft" ? draft.directory : undefined
    }
    if (route.type === "session") return sync().session.get(route.sessionId)?.directory
    return undefined
  })
  const projectID = createMemo(() => {
    const route = layout.route()
    if (route.type === "session") return sync().session.get(route.sessionId)?.projectID
    const dir = directory()
    return dir ? sync().child(dir)[0].project || undefined : undefined
  })
  return { directory, projectID }
}

export function createBrowserGrantState(input: {
  projectID: () => string | undefined
  client: () =>
    | { list: (input: { projectID: string }) => Promise<Grant[]>; remove: (input: { id: string }) => Promise<unknown> }
    | undefined
}) {
  const [state, setState] = createStore({
    grants: [] as Grant[],
    loading: false,
    removing: "",
    failed: false,
    revision: 0,
  })
  let generation = 0
  onCleanup(() => generation++)
  createEffect(() => {
    const current = ++generation
    const client = input.client()
    const projectID = input.projectID()
    state.revision
    setState({ grants: [], loading: false, failed: false, removing: "" })
    if (!client || !projectID) return
    setState("loading", true)
    void client.list({ projectID }).then(
      (grants) => {
        if (current !== generation) return
        setState({
          grants: grants.filter((grant) => grant.projectID === projectID && grant.action === "browser"),
          loading: false,
        })
      },
      () => {
        if (current === generation) setState({ failed: true, loading: false })
      },
    )
  })

  const remove = async (grant: Grant) => {
    const client = input.client()
    if (state.removing || grant.projectID !== input.projectID() || !client) return
    const current = generation
    setState({ removing: grant.id, failed: false })
    try {
      await client.remove({ id: grant.id })
      if (current === generation) setState("grants", (items) => items.filter((item) => item.id !== grant.id))
    } catch {
      if (current === generation) setState("failed", true)
    } finally {
      if (current === generation) setState("removing", "")
    }
  }
  return { state, remove, retry: () => setState("revision", (value) => value + 1) }
}

export function SettingsBrowserGrants(props: { projectID?: string; directory?: string }) {
  const language = useLanguage()
  const sdk = useServerSDK()
  const { state, remove, retry } = createBrowserGrantState({
    projectID: () => props.projectID,
    client: () => (sdk().protocolKind() === "v2" ? sdk().currentApi.permission.saved : undefined),
  })

  return (
    <section class="contents" aria-label={language.t("settings.browserGrants.title")}>
      <div class="settings-v2-tab-header">
        <h2 class="settings-v2-tab-title">{language.t("settings.browserGrants.title")}</h2>
      </div>
      <div class="settings-v2-tab-body" data-component="browser-grants">
        <Show when={props.projectID} fallback={<p>{language.t("sidebar.empty.description")}</p>}>
          <p class="text-14-regular text-text-weak mb-4 break-all">{props.directory}</p>
          <p class="text-14-regular text-text-weak mb-4">{language.t("settings.browserGrants.description")}</p>
          <Show when={state.failed}>
            <p role="alert" class="text-14-regular mb-4">
              {language.t("settings.browserGrants.error")}
            </p>
            <ButtonV2 onClick={retry}>{language.t("settings.browserGrants.retry")}</ButtonV2>
          </Show>
          <Show when={!state.loading} fallback={<p>{language.t("common.loading")}</p>}>
            <Show
              when={state.grants.length}
              fallback={
                <Show when={!state.failed}>
                  <p>{language.t("settings.browserGrants.empty")}</p>
                </Show>
              }
            >
              <SettingsListV2>
                <For each={state.grants}>
                  {(grant) => {
                    const scope = browserGrantScope(grant.resource)
                    return (
                      <SettingsRowV2
                        title={
                          scope
                            ? language.t("settings.browserGrants.scope", scope)
                            : language.t("settings.browserGrants.unknown")
                        }
                        description={
                          scope ? (
                            <span>
                              {scope.origin}
                              <Show when={scope.frame !== scope.origin}>
                                <br />
                                {language.t("settings.browserGrants.frame", { origin: scope.frame })}
                              </Show>
                            </span>
                          ) : (
                            language.t("settings.browserGrants.unknownDescription")
                          )
                        }
                      >
                        <ButtonV2 disabled={!!state.removing} onClick={() => void remove(grant)}>
                          {language.t("settings.browserGrants.remove")}
                        </ButtonV2>
                      </SettingsRowV2>
                    )
                  }}
                </For>
              </SettingsListV2>
            </Show>
          </Show>
        </Show>
      </div>
    </section>
  )
}
