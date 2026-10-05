// @refresh reload
// Tandem-owned (not in upstream): Android platform adapter for the shared app.
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { onCleanup, onMount } from "solid-js"
import { impactFeedback, notificationFeedback } from "@tauri-apps/plugin-haptics"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Store } from "@tauri-apps/plugin-store"
import { allowMarkdownLinkProtocol } from "@opencode/session-ui/markdown-cache"
import { AppBaseProviders, AppInterface, createBrowserDraftStore, PlatformProvider, ServerConnection, type Platform } from "@opencode/app"
import { bridge } from "./bridge"
import { createServerDiscovery } from "./discovery"
import { createTauriStorage } from "./storage"
import { androidViewport } from "./viewport"
import { isTaobaoItemUrl } from "./taobao"
import "./android.css"
import pkg from "../package.json"

const settings = Store.load("opencode.settings.dat")
const root = document.getElementById("root")
allowMarkdownLinkProtocol("taobao", isTaobaoItemUrl)

function App() {
  const [state, setState] = createStore({ zoom: 1 })
  const viewport = androidViewport(() => state.zoom)
  const platform: Platform = {
    platform: "android",
    os: "android",
    version: pkg.version,
    openExternal: (url) => {
      if (/^taobao:/i.test(url) && !isTaobaoItemUrl(url)) return
      void openUrl(url).catch(console.error)
    },
    openBrowser: async (url) => openUrl(url).then(() => true, () => false),
    restart: async () => window.location.reload(),
    notify: async (title, description) => {
      const granted = await isPermissionGranted()
      if (!granted && await requestPermission() !== "granted") return
      sendNotification({ title, body: description ?? "" })
    },
    haptic: (style) => {
      if (style === "success" || style === "warning" || style === "error") {
        void notificationFeedback(style).catch(console.error)
        return
      }
      void impactFeedback(style).catch(console.error)
    },
    share: async (data) => await bridge.sendAsync<boolean>("share", data) ?? false,
    storage: createTauriStorage,
    draftStore: createBrowserDraftStore(),
    getDefaultServer: async () => {
      const value = await (await settings).get<string>("defaultServerUrl")
      return value ? ServerConnection.Key.make(value) : null
    },
    setDefaultServer: async (key) => {
      const store = await settings
      if (key) await store.set("defaultServerUrl", key)
      if (!key) await store.delete("defaultServerUrl")
      await store.save()
    },
    webviewZoom: () => state.zoom,
    setWebviewZoom: (scale) => {
      const percent = Number.isFinite(scale) ? Math.round(scale * 50) * 2 : 100
      setState("zoom", Math.min(150, Math.max(80, percent)) / 100)
      root?.style.setProperty("zoom", String(state.zoom))
      viewport.sync()
    },
    ...createServerDiscovery(),
    onResume: (callback) => bridge.on("resume", callback),
    serverSetup: {
      serve: `tandem serve --hostname 0.0.0.0 --port ${import.meta.env.TANDEM_ANDROID_NAME === "Tandem V2" ? "4098" : "4097"}`,
    },
  }

  onMount(() => {
    document.documentElement.dataset.platform = "android"
    document.title = import.meta.env.TANDEM_ANDROID_NAME ?? "Tandem"
    const stop = viewport.start()
    const openLink = (event: MouseEvent) => {
      if (event.defaultPrevented || !(event.target instanceof Element)) return
      const link = event.target.closest<HTMLAnchorElement>("a[href]")
      if (!link || (!link.classList.contains("external-link") && !isTaobaoItemUrl(link.href))) return
      event.preventDefault()
      platform.openExternal(link.href)
    }
    document.addEventListener("click", openLink)
    const stopResume = platform.onResume?.(() => {
      viewport.sync()
      // Feed the lifecycle signals the v2 stream client already understands.
      window.dispatchEvent(new Event("pageshow"))
      document.dispatchEvent(new Event("visibilitychange"))
    })
    onCleanup(stop)
    onCleanup(() => stopResume?.())
    onCleanup(() => document.removeEventListener("click", openLink))
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <AppInterface />
      </AppBaseProviders>
    </PlatformProvider>
  )
}

if (root instanceof HTMLElement && root.dataset.opencodeMounted === undefined) {
  root.dataset.opencodeMounted = ""
  render(() => <App />, root)
}
