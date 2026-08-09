// @refresh reload
import { render } from "solid-js/web"
import { createResource, createSignal, onCleanup, onMount, Show } from "solid-js"
import { AppBaseProviders, AppInterface, PlatformProvider, ServerConnection, type Platform } from "@opencode-ai/app"
import { allowMarkdownLinkProtocol } from "@opencode-ai/session-ui/markdown-cache"
import { impactFeedback, notificationFeedback } from "@tauri-apps/plugin-haptics"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import { openUrl } from "@tauri-apps/plugin-opener"
import { Store } from "@tauri-apps/plugin-store"
import { bridge } from "./bridge"
import { createTauriStorage } from "./storage"
import { Onboarding } from "./onboarding"
import pkg from "../package.json"

allowMarkdownLinkProtocol("taobao")

const SETTINGS_STORE = "opencode.settings.dat"
const DEFAULT_SERVER_URL_KEY = "defaultServerUrl"
const DEFAULT_SERVER_DISPLAY_NAME_KEY = "defaultServerDisplayName"
const DEFAULT_SERVER_USERNAME_KEY = "defaultServerUsername"
const DEFAULT_SERVER_PASSWORD_KEY = "defaultServerPassword"
const settingsStore = Store.load(SETTINGS_STORE)
type ServerConfig = { url: string; displayName?: string; username?: string; password?: string }

const normalizeServerUrl = (input: string) => {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

const getDefaultServerConfig = async (): Promise<ServerConfig | null> => {
  const store = await settingsStore
  const url = await store.get(DEFAULT_SERVER_URL_KEY).catch(() => null)
  if (typeof url !== "string") return null
  const displayName = await store.get(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => null)
  const username = await store.get(DEFAULT_SERVER_USERNAME_KEY).catch(() => null)
  const password = await store.get(DEFAULT_SERVER_PASSWORD_KEY).catch(() => null)
  return {
    url,
    displayName: typeof displayName === "string" ? displayName : undefined,
    username: typeof username === "string" ? username : undefined,
    password: typeof password === "string" ? password : undefined,
  }
}

const getDefaultServer = async () => {
  const config = await getDefaultServerConfig()
  return config ? ServerConnection.Key.make(config.url) : null
}

const setDefaultServer = async (url: ServerConnection.Key | null) => {
  const store = await settingsStore
  if (url) {
    await store.set(DEFAULT_SERVER_URL_KEY, url).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_USERNAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_PASSWORD_KEY).catch(() => undefined)
  } else {
    await store.delete(DEFAULT_SERVER_URL_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_USERNAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_PASSWORD_KEY).catch(() => undefined)
  }
  await store.save().catch(() => undefined)
}

const setDefaultServerConfig = async (config: ServerConfig | null) => {
  const store = await settingsStore
  if (!config) {
    await store.delete(DEFAULT_SERVER_URL_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_USERNAME_KEY).catch(() => undefined)
    await store.delete(DEFAULT_SERVER_PASSWORD_KEY).catch(() => undefined)
    await store.save().catch(() => undefined)
    return
  }
  await store.set(DEFAULT_SERVER_URL_KEY, config.url).catch(() => undefined)
  if (config.displayName) await store.set(DEFAULT_SERVER_DISPLAY_NAME_KEY, config.displayName).catch(() => undefined)
  else await store.delete(DEFAULT_SERVER_DISPLAY_NAME_KEY).catch(() => undefined)
  if (config.username) await store.set(DEFAULT_SERVER_USERNAME_KEY, config.username).catch(() => undefined)
  else await store.delete(DEFAULT_SERVER_USERNAME_KEY).catch(() => undefined)
  if (config.password) await store.set(DEFAULT_SERVER_PASSWORD_KEY, config.password).catch(() => undefined)
  else await store.delete(DEFAULT_SERVER_PASSWORD_KEY).catch(() => undefined)
  await store.save().catch(() => undefined)
}

const root = document.getElementById("root")
if (import.meta.env.DEV && !(root instanceof HTMLElement)) {
  throw new Error("Root element not found")
}

let safeAreaProbe: HTMLDivElement | undefined
// getComputedStyle on the probe forces a style recalc, and visualViewport
// scroll/resize events fire continuously while the keyboard animates or pans
// the page. Cache the insets (they only change with system bars/orientation,
// which always fire a resize) and let resize invalidate the cache.
let safeAreaCache: { top: number; bottom: number } | undefined

const invalidateSafeArea = () => {
  safeAreaCache = undefined
}

const safeAreaInset = () => {
  if (safeAreaCache) return safeAreaCache
  if (!document.body) return { top: 0, bottom: 0 }
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement("div")
    safeAreaProbe.style.cssText =
      "position:fixed;inset:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom)"
    document.body.append(safeAreaProbe)
  }
  const style = getComputedStyle(safeAreaProbe)
  safeAreaCache = {
    top: Number.parseFloat(style.paddingTop) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
  }
  return safeAreaCache
}

// Only touch the CSS vars when a value actually changed so unchanged scroll
// events do not invalidate styles on the whole document.
const appliedViewportVars: Record<string, string> = {}
const setViewportVar = (name: string, value: string) => {
  if (appliedViewportVars[name] === value) return
  appliedViewportVars[name] = value
  document.documentElement.style.setProperty(name, value)
}

const syncAndroidViewport = (zoom: number) => {
  const height = window.visualViewport?.height ?? window.innerHeight
  const safeArea = safeAreaInset()
  setViewportVar("--android-viewport-height", `${height / zoom}px`)
  setViewportVar("--android-safe-area-top", `${safeArea.top / zoom}px`)
  setViewportVar("--android-safe-area-bottom", `${safeArea.bottom / zoom}px`)
}

const App = () => {
  const [webviewZoom, setWebviewZoomValue] = createSignal(1)

  const emitResume = () => {
    window.dispatchEvent(new Event("opencode:resume"))
  }

  const setWebviewZoom = (scale: number) => {
    const zoom = Number.isFinite(scale) && scale > 0 ? scale : 1
    setWebviewZoomValue(zoom)
    root?.style.setProperty("zoom", `${zoom}`)
    syncAndroidViewport(zoom)
  }

  const platform: Platform = {
    platform: "android",
    os: "android",
    version: pkg.version,
    openExternal: (url: string) => {
      void openUrl(url).catch(() => undefined)
    },
    notify: async (title: string, description?: string) => {
      const granted = await isPermissionGranted().catch(() => false)
      const permission = granted ? "granted" : await requestPermission().catch(() => "denied")
      if (permission !== "granted") return
      await Promise.resolve()
        .then(() =>
          sendNotification({
            title,
            body: description ?? "",
          }),
        )
        .catch(() => undefined)
    },
    restart: async () => window.location.reload(),
    webviewZoom,
    setWebviewZoom,
    haptic: (style: "light" | "medium" | "heavy" | "success" | "warning" | "error") => {
      if (style === "success" || style === "warning" || style === "error") {
        void notificationFeedback(style).catch(() => undefined)
        return
      }
      void impactFeedback(style).catch(() => undefined)
    },
    share: async (data: { text?: string; url?: string }) => {
      const result = await bridge.sendAsync<boolean>("share", data)
      return result ?? false
    },
    getDefaultServer,
    setDefaultServer,
    storage: (name?: string) => createTauriStorage(name),
  }

  const [defaultServer] = createResource(async () => {
    const result = await getDefaultServerConfig().catch(() => null)
    return result ?? null
  })

  const [completedServer, setCompletedServer] = createSignal<ServerConfig | null>(null)

  const handleOnboardingComplete = async (server: ServerConfig) => {
    const normalized = normalizeServerUrl(server.url)
    if (!normalized) return
    const config = {
      url: normalized,
      displayName: server.displayName,
      username: server.username,
      password: server.password,
    }
    await setDefaultServerConfig(config)
    setCompletedServer(config)
  }

  onMount(() => {
    document.documentElement.dataset.platform = "android"

    const syncViewport = () => syncAndroidViewport(webviewZoom())
    const onResize = () => {
      invalidateSafeArea()
      syncViewport()
    }
    syncViewport()

    const handleClick = (event: MouseEvent) => {
      const link = (event.target as HTMLElement | null)?.closest("a.external-link") as HTMLAnchorElement | null
      if (!link?.href) return
      event.preventDefault()
      platform.openExternal(link.href)
    }

    const onVisible = () => {
      if (document.visibilityState !== "visible") return
      emitResume()
    }

    document.addEventListener("click", handleClick)
    window.addEventListener("resize", onResize)
    window.visualViewport?.addEventListener("resize", onResize)
    window.visualViewport?.addEventListener("scroll", syncViewport)
    document.addEventListener("visibilitychange", onVisible)
    onCleanup(() => {
      document.removeEventListener("click", handleClick)
      window.removeEventListener("resize", onResize)
      window.visualViewport?.removeEventListener("resize", onResize)
      window.visualViewport?.removeEventListener("scroll", syncViewport)
      document.removeEventListener("visibilitychange", onVisible)
    })
  })

  return (
    <PlatformProvider value={platform}>
      <AppBaseProviders>
        <Show when={!defaultServer.loading}>
          <Show
            when={defaultServer() ?? completedServer()}
            fallback={<Onboarding onComplete={handleOnboardingComplete} />}
          >
            {(server) => {
              const conn = (): ServerConnection.Http => ({
                type: "http",
                displayName: server().displayName,
                http: {
                  url: server().url,
                  username: server().username,
                  password: server().password,
                },
              })
              return <AppInterface defaultServer={ServerConnection.key(conn())} servers={[conn()]} />
            }}
          </Show>
        </Show>
      </AppBaseProviders>
    </PlatformProvider>
  )
}

if (root instanceof HTMLElement) {
  render(() => <App />, root)
}
