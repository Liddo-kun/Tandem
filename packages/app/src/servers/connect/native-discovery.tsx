// Tandem-owned (not in upstream): native LAN server discovery controls.
import { For, Show, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { usePlatform } from "@/runtime/platform/platform"
import { useLanguage } from "@/runtime/i18n/language"

export function NativeServerDiscovery(props: { onSelect: (url: string) => void; disabled?: boolean }) {
  const platform = usePlatform()
  const language = useLanguage()
  const [state, setState] = createStore({
    busy: false,
    failed: false,
    servers: [] as Array<{ url: string; authenticationRequired: boolean }>,
  })
  let active = true
  onCleanup(() => {
    active = false
    if (state.busy) void platform.cancelServerDiscovery?.()
  })
  const scan = async () => {
    if (state.busy) return
    setState({ busy: true, failed: false, servers: [] })
    await platform.discoverServers?.((server) => {
      if (!active || state.servers.some((item) => item.url === server.url)) return
      setState("servers", (items) => [...items, server])
    }).catch(() => { if (active) setState("failed", true) })
    if (active) setState("busy", false)
  }
  return (
    <Show when={platform.discoverServers}>
      <div class="flex flex-col gap-2">
        <Button variant="neutral" disabled={props.disabled || state.busy} onClick={() => void scan()}>
          {language.t(state.busy ? "server.connect.discovery.busy" : "server.connect.discovery.start")}
        </Button>
        <Show when={state.busy}>
          <Button variant="neutral" onClick={() => void platform.cancelServerDiscovery?.()}>
            {language.t("common.cancel")}
          </Button>
        </Show>
        <p>{language.t("server.connect.discovery.help")}</p>
        <Show when={state.failed}><p role="alert">{language.t("server.connect.discovery.failed")}</p></Show>
        <For each={state.servers}>
          {(server) => (
            <Button variant="neutral" disabled={props.disabled} onClick={() => props.onSelect(server.url)}>
              <bdi dir="ltr">{server.url}</bdi>
              <Show when={server.authenticationRequired}>
                <span>{language.t("server.connect.discovery.credentials")}</span>
              </Show>
            </Button>
          )}
        </For>
      </div>
    </Show>
  )
}
