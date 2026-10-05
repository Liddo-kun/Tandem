import { lazy, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Wordmark } from "@opencode/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCheckServerHealth } from "@/runtime/server/health"
// UPSTREAM-DIVERGENCE: Persist the Android default-server connection key.
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { pairingLink, redeemPairingLink, serverAddress } from "./pairing"
import { isMixedContent } from "./browser"
import { createCameraAvailability } from "./camera"
// UPSTREAM-DIVERGENCE: Owned native LAN discovery controls.
import { NativeServerDiscovery } from "./native-discovery"
import "./screen.css"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

export function ConnectServerScreen(props: { url?: string } = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const check = useCheckServerHealth()
  const camera = createCameraAvailability()
  const [state, setState] = createStore({ url: props.url ?? "", password: "", error: "", scanning: false })
  const connectionError = () =>
    language.t(
      platform.platform === "web" && isMixedContent(location.href, state.url)
        ? "server.connect.mixedContent"
        : "server.connect.failed",
    )
  const request = useMutation(() => ({
    mutationFn: async () => {
      const link = pairingLink(state.url)
      if (link) {
        const redeemed = await redeemPairingLink(link)
        if (!redeemed) {
          setState("error", language.t("server.connect.link.expired"))
          return
        }
        // Keep the token in the form so a failed connection check can retry without the spent code.
        setState({ url: link.url, password: redeemed.password })
      }
      const url = serverAddress(state.url)
      if (!url) {
        setState("error", language.t("server.connect.address.invalid"))
        return
      }
      const http = { url, password: state.password || undefined }
      const result = await check(http)
      if (!result.healthy) {
        // UPSTREAM-DIVERGENCE: Distinguish reachable credential-required servers from offline servers.
        setState("error", result.unauthorized ? language.t("server.connect.credentialsRequired") : connectionError())
        return
      }
      // UPSTREAM-DIVERGENCE: Require v2 and save the successful connection as Android's default.
      if (platform.platform === "android" && !result.version?.startsWith("2.")) {
        setState("error", language.t("server.connect.v2Required"))
        return
      }
      if (platform.platform === "android") await platform.setDefaultServer?.(ServerConnection.Key.make(url))
      servers.add({ type: "http", http })
    },
    onError: () => setState("error", connectionError()),
  }))

  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div class="server-connect-content">
        {/* UPSTREAM-DIVERGENCE: Tandem product accessible label. */}
        <div class="server-connect-brand" role="img" aria-label={language.t("desktop.menu.app")}>
          <Wordmark />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>{language.t("server.connect.description")}</p>
        </header>
        <Show
          when={!state.scanning}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                onCancel={() => {
                  setState("scanning", false)
                  void camera.refetch()
                }}
                onScan={(pairing) => {
                  setState({ url: pairing.url, password: pairing.password, error: "", scanning: false })
                  request.mutate()
                }}
              />
            </Suspense>
          }
        >
          {/* UPSTREAM-DIVERGENCE: Native LAN discovery in the shared connection screen. */}
          <NativeServerDiscovery
            disabled={request.isPending}
            onSelect={(url) => setState({ url, error: "" })}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (request.isPending) return
              setState("error", "")
              request.mutate()
            }}
          >
            <div class="server-connect-field">
              <label for="server-connect-url">{language.t("dialog.server.add.url")}</label>
              <TextInput
                id="server-connect-url"
                name="server"
                dir="ltr"
                type="text"
                inputMode="url"
                autocomplete="url"
                autocapitalize="off"
                spellcheck={false}
                required
                appearance="large"
                placeholder={language.t("dialog.server.add.placeholder")}
                value={state.url}
                disabled={request.isPending}
                aria-describedby={state.error ? "server-connect-error" : undefined}
                onInput={(event) => setState({ url: event.currentTarget.value, error: "" })}
              />
            </div>
            <div class="server-connect-field">
              <label for="server-connect-password">{language.t("dialog.server.add.password")}</label>
              <TextInput
                id="server-connect-password"
                name="password"
                type="password"
                autocomplete="current-password"
                appearance="large"
                value={state.password}
                disabled={request.isPending}
                onInput={(event) => setState({ password: event.currentTarget.value, error: "" })}
              />
            </div>
            <Show when={state.error}>
              <p id="server-connect-error" class="server-connect-error" role="alert">
                {state.error}
              </p>
            </Show>
            <Button type="submit" variant="contrast" size="large" disabled={request.isPending || !state.url.trim()}>
              {language.t(request.isPending ? "dialog.server.add.checking" : "server.connect.button")}
            </Button>
          </form>
          <Show when={platform.platform === "web"}>
            <Button
              variant="neutral"
              size="large"
              disabled={request.isPending || !camera.available.latest}
              aria-describedby={
                !camera.available.latest && !camera.available.loading ? "server-connect-camera-unavailable" : undefined
              }
              onClick={() => setState("scanning", true)}
            >
              {language.t("server.connect.scan")}
            </Button>
            <Show when={!camera.available.latest && !camera.available.loading}>
              <p id="server-connect-camera-unavailable">
                {language.t(
                  window.isSecureContext ? "server.connect.camera.unavailable" : "server.connect.camera.insecure",
                )}
              </p>
            </Show>
          </Show>
          <footer>
            {/* UPSTREAM-DIVERGENCE: Native v2/password/pairing help and Tandem CLI command. */}
            <Show when={platform.serverSetup}>
              {(setup) => <>
                <p>{language.t("server.connect.v2Help")}</p>
                <p>{language.t("server.connect.passwordHelp")}</p>
                <p>{language.t("server.connect.pairingHelp")}</p>
                <code dir="ltr">{setup().serve}</code>
              </>}
            </Show>
            <Show when={!platform.serverSetup || platform.serverSetup.pair}>
              <p>{language.t("server.connect.pair.description")}</p>
              <code dir="ltr">{platform.serverSetup?.pair ?? "tandem pair"}</code>
            </Show>
          </footer>
        </Show>
      </div>
    </main>
  )
}
