import { lazy, Show, Suspense } from "solid-js"
import { createStore } from "solid-js/store"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode/ui/button"
import { TextInput } from "@opencode/ui/text-input"
import { Wordmark } from "@opencode/ui/wordmark"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform } from "@/runtime/platform/platform"
import { useCheckServerHealth } from "@/runtime/server/health"
// UPSTREAM-DIVERGENCE: Tandem pairing command.
import { Brand } from "@opencode/util/brand"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { bareServerAddress, serverAddress, type Pairing } from "./pairing"
import { useRedeemPairing } from "./redeem"
import { isMixedContent } from "./browser"
import { cameraHint, createCameraAvailability } from "./camera"
import { ConnectMethodSwitch, type ConnectMethod } from "./method"
// UPSTREAM-DIVERGENCE: Owned native LAN discovery controls.
import { NativeServerDiscovery } from "./native-discovery"
import "./screen.css"

const PairingScanner = lazy(() => import("./scanner").then((module) => ({ default: module.PairingScanner })))

export function ConnectServerScreen(props: { url?: string } = {}) {
  const language = useLanguage()
  const platform = usePlatform()
  const servers = useServers()
  const check = useCheckServerHealth()
  const redeem = useRedeemPairing()
  const camera = createCameraAvailability()

  const [state, setState] = createStore<{
    method: ConnectMethod
    link: string
    url: string
    password: string
    error: string
    scanning: boolean
  }>({
    method: "link",
    link: "",
    url: props.url ?? "",
    password: "",
    error: "",
    scanning: false,
  })

  // A pairing token works on every address of its server. Signing in again to the server that signed out keeps its
  // address (e.g. localhost) even when the link names another one (e.g. 127.0.0.1 from opencode pair).
  const target = async (pairing: Pairing) => {
    if (!props.url || props.url === pairing.url) return pairing
    const http = { url: props.url, password: pairing.password }

    return (await check(http)).healthy ? http : pairing
  }

  const connect = async (http: ServerConnection.HttpBase) => {
    const result = await check(http)

    if (!result.healthy) {
      // UPSTREAM-DIVERGENCE: Distinguish reachable credential-required servers from offline servers.
      setState("error", result.unauthorized ? language.t("server.connect.credentialsRequired") : connectionError(http.url))

      return
    }

    // UPSTREAM-DIVERGENCE: Require v2 and save the successful connection as Android's default.
    if (platform.platform === "android" && !result.version?.startsWith("2.")) {
      setState("error", language.t("server.connect.v2Required"))
      return
    }
    if (platform.platform === "android") await platform.setDefaultServer?.(ServerConnection.Key.make(http.url))

    // Signing in again keeps the name the user gave this server.
    const existing = servers.list.find(
      (server): server is ServerConnection.Http => server.type === "http" && server.http.url === http.url,
    )

    servers.add(existing ? { ...existing, http } : { type: "http", http })
  }

  const connectionError = (url: string) =>
    language.t(
      platform.platform === "web" && isMixedContent(location.href, url)
        ? "server.connect.mixedContent"
        : "server.connect.failed",
    )

  const request = useMutation(() => ({
    mutationFn: async () => {
      if (state.method === "link") {
        const redeemed = await redeem(state.link)

        if (redeemed && "error" in redeemed) return void setState("error", redeemed.error)

        if (redeemed) return connect(await target(redeemed.pairing))
        // A server address typed here belongs to the password form.
        const address = bareServerAddress(state.link)

        if (address) return void setState({ method: "password", url: address, link: "", error: "" })

        return void setState("error", language.t("server.connect.link.invalid"))
      }

      // A pairing link pasted into the address field still pairs.
      const redeemed = await redeem(state.url)

      if (redeemed && "error" in redeemed) return void setState("error", redeemed.error)

      if (redeemed) return connect(await target(redeemed.pairing))
      const url = serverAddress(state.url)

      if (!url) return void setState("error", language.t("server.connect.address.invalid"))

      await connect({ url, password: state.password || undefined })
    },
    onError: () => setState("error", connectionError(state.method === "link" ? state.link : state.url)),
  }))

  const submit = () => {
    if (request.isPending) return
    setState("error", "")
    request.mutate()
  }

  return (
    <main data-component="connect-server" aria-labelledby="server-connect-title">
      <div class="server-connect-content">
        {/* UPSTREAM-DIVERGENCE: Tandem product accessible label. */}
        <div class="server-connect-brand" role="img" aria-label={language.t("desktop.menu.app")}>
          <Wordmark />
        </div>
        <header>
          <h1 id="server-connect-title">{language.t("server.connect.title")}</h1>
          <p>
            {language.t(state.method === "link" ? "server.connect.description.pairing" : "server.connect.description")}
          </p>
        </header>
        <Show
          when={!state.scanning}
          fallback={
            <Suspense fallback={<p role="status">{language.t("server.connect.camera.starting")}</p>}>
              <PairingScanner
                redeem={redeem}
                onCancel={() => {
                  setState("scanning", false)
                  void camera.refetch()
                }}
                onScan={(link) => {
                  setState({ method: "link", link, error: "", scanning: false })
                  request.mutate()
                }}
              />
            </Suspense>
          }
        >
          {/* UPSTREAM-DIVERGENCE: Native LAN discovery in the shared connection screen; a found address goes to the password form. */}
          <NativeServerDiscovery
            disabled={request.isPending}
            onSelect={(url) => setState({ method: "password", url, error: "" })}
          />
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit()
            }}
          >
            <Show
              when={state.method === "password"}
              fallback={
                <div class="server-connect-field">
                  <label for="server-connect-link">{language.t("server.connect.link")}</label>
                  <TextInput
                    id="server-connect-link"
                    name="link"
                    dir="ltr"
                    type="text"
                    inputMode="url"
                    autocapitalize="off"
                    spellcheck={false}
                    required
                    appearance="large"
                    placeholder={language.t("server.connect.link.placeholder")}
                    value={state.link}
                    disabled={request.isPending}
                    aria-describedby={state.error ? "server-connect-error" : undefined}
                    onInput={(event) => setState({ link: event.currentTarget.value, error: "" })}
                  />
                </div>
              }
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
                  aria-describedby="server-connect-password-hint"
                  onInput={(event) => setState({ password: event.currentTarget.value, error: "" })}
                />
                <p id="server-connect-password-hint" class="server-connect-hint">
                  {language.t("server.connect.password.hint")}
                </p>
              </div>
            </Show>
            <Show when={state.error}>
              <p id="server-connect-error" class="server-connect-error" role="alert">
                {state.error}
              </p>
            </Show>
            <Button
              type="submit"
              variant="contrast"
              size="large"
              disabled={request.isPending || !(state.method === "link" ? state.link : state.url).trim()}
            >
              {language.t(request.isPending ? "dialog.server.add.checking" : "server.connect.button")}
            </Button>
          </form>
          <Show when={state.method === "link" && platform.platform === "web"}>
            <Show
              when={camera.available.latest || camera.available.loading}
              fallback={<p>{language.t(cameraHint())}</p>}
            >
              <Button
                variant="neutral"
                size="large"
                disabled={request.isPending || !camera.available.latest}
                onClick={() => setState("scanning", true)}
              >
                {language.t("server.connect.scan")}
              </Button>
            </Show>
          </Show>
          <ConnectMethodSwitch
            method={state.method}
            disabled={request.isPending}
            onChange={(method) => setState({ method, error: "" })}
          />
          <Show when={state.method === "link"}>
            <footer>
              <p>{language.t("server.connect.pair.link")}</p>
              {/* UPSTREAM-DIVERGENCE: Tandem pairing command. */}
              <code dir="ltr">{`${Brand.command} pair`}</code>
            </footer>
          </Show>
        </Show>
      </div>
    </main>
  )
}
