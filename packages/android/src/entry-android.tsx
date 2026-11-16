// @refresh reload
// Tandem-owned (not in upstream): Android platform adapter for the shared app.
import { render } from "solid-js/web"
import { createStore } from "solid-js/store"
import { onCleanup, onMount } from "solid-js"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import { openUrl } from "@tauri-apps/plugin-opener"
import { allowMarkdownLinkProtocol } from "@opencode/session-ui/markdown-cache"
import { AppBaseProviders, AppInterface, createBrowserDraftStore, PlatformProvider, type Platform } from "@opencode/app"
import { desktopZoomLevels, nextDesktopZoomLevel, type DesktopZoomLevel } from "@opencode/app/desktop-menu"
import { bridge } from "./bridge"
import { createServerDiscovery } from "./discovery"
import { createTauriStorage } from "./storage"
import { androidViewport } from "./viewport"
import { isTaobaoItemUrl } from "./taobao"
import "./android.css"
import pkg from "../package.json"

const root = document.getElementById("root")
// Page zoom uses the shared app's zoom levels and its Appearance setting, and is saved here, per device.
const ZOOM_KEY = "tandem.android.zoom"
const nearestZoomLevel = (value: number) =>
  desktopZoomLevels.reduce<DesktopZoomLevel>((best, level) => (Math.abs(level - value) < Math.abs(best - value) ? level : best), 1)
const savedZoomLevel = () => {
  const saved = Number(localStorage.getItem(ZOOM_KEY))
  return desktopZoomLevels.find((level) => level === saved)
}
allowMarkdownLinkProtocol("taobao", isTaobaoItemUrl)

function App() {
  const [state, setState] = createStore<{ zoom: DesktopZoomLevel }>({ zoom: savedZoomLevel() ?? 1 })
  const viewport = androidViewport(() => state.zoom)
  const setZoomLevel = async (level: DesktopZoomLevel) => {
    localStorage.setItem(ZOOM_KEY, String(level))
    setState("zoom", level)
    root?.style.setProperty("zoom", String(level))
    viewport.sync()
  }
  root?.style.setProperty("zoom", String(state.zoom))
  // Once: carry over the zoom the earlier 80–150% slider saved in the app settings, at the nearest level.
  if (savedZoomLevel() === undefined)
    void Promise.resolve(createTauriStorage().getItem("settings.v3"))
      .then((raw) => {
        const scale = typeof raw === "string" ? JSON.parse(raw)?.appearance?.displayScale : undefined
        if (typeof scale === "number" && savedZoomLevel() === undefined) return setZoomLevel(nearestZoomLevel(scale))
      })
      .catch(() => undefined)
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
    storage: createTauriStorage,
    draftStore: createBrowserDraftStore(),
    webviewZoom: () => state.zoom,
    zoomLevel: () => state.zoom,
    setZoomLevel,
    ...createServerDiscovery(),
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
    // The volume keys step through the zoom levels.
    const hardwareZoom = (event: Event) => {
      const direction = event instanceof CustomEvent ? event.detail?.direction : undefined
      if (direction === 1 || direction === -1) void setZoomLevel(nextDesktopZoomLevel(state.zoom, direction === 1 ? "in" : "out"))
    }
    window.addEventListener("opencode:hardware-zoom", hardwareZoom)
    onCleanup(() => window.removeEventListener("opencode:hardware-zoom", hardwareZoom))
    // The WebView's own visibilitychange already wakes the stream client on resume.
    const stopResume = bridge.on("resume", () => viewport.sync())
    onCleanup(stop)
    onCleanup(stopResume)
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
