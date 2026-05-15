import { createEffect, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode-ai/ui/button"
import { Icon } from "@opencode-ai/ui/icon"
import { TextField } from "@opencode-ai/ui/text-field"
import { bridge } from "./bridge"

type ScanResult = { host: string; port: number; url: string }
type ServerConfig = { url: string; displayName?: string; username?: string; password?: string }

async function checkHealth(url: string, username?: string, password?: string) {
  const result = await bridge.sendAsync<{ healthy: boolean }>("checkHealth", { url, username, password })
  return result?.healthy === true
}

function normalizeServerUrl(input: string) {
  const trimmed = input.trim()
  if (!trimmed) return
  const withProtocol = /^https?:\/\//.test(trimmed) ? trimmed : `http://${trimmed}`
  return withProtocol.replace(/\/+$/, "")
}

function CopyBlock(props: { code: string }) {
  const [store, setStore] = createStore({ copied: false })

  const copy = () => {
    navigator.clipboard
      .writeText(props.code)
      .then(() => {
        setStore("copied", true)
        setTimeout(() => setStore("copied", false), 2000)
      })
      .catch(() => {})
  }

  return (
    <div class="relative group w-full">
      <pre class="bg-surface-raised-base text-text-secondary-base text-14-regular px-4 py-3 rounded-md overflow-x-auto">
        <code>{props.code}</code>
      </pre>
      <button
        type="button"
        class="absolute top-2 right-2 p-1.5 rounded-sm bg-surface-base hover:bg-surface-base-hover transition-colors"
        onClick={copy}
      >
        <Icon name={store.copied ? "check" : "copy"} size="small" />
      </button>
    </div>
  )
}

export function Onboarding(props: { onComplete: (server: ServerConfig) => void }) {
  const [store, setStore] = createStore({
    step: 0,
    scanning: false,
    servers: [] as ScanResult[],
    selected: null as string | null,
    manualUrl: "",
    manualName: "",
    manualUsername: "",
    manualPassword: "",
    manualStatus: undefined as boolean | undefined,
    selectedHealthy: undefined as boolean | undefined,
  })
  let healthTimer: ReturnType<typeof setTimeout> | undefined

  const stopScanResult = bridge.on("scanResult", (payload) => {
    const result = payload as ScanResult
    if (!result?.url) return
    setStore("servers", (prev) => (prev.some((server) => server.url === result.url) ? prev : [...prev, result]))
  })
  const stopScanComplete = bridge.on("scanComplete", () => {
    setStore("scanning", false)
  })

  onCleanup(() => {
    stopScanResult()
    stopScanComplete()
    if (healthTimer) clearTimeout(healthTimer)
    void bridge.sendAsync("cancelScan")
  })

  const startScan = () => {
    setStore({ scanning: true, servers: [], selected: null, selectedHealthy: undefined })
    void bridge.sendAsync("scanNetwork")
  }

  const selectServer = async (url: string) => {
    setStore({ selected: url, selectedHealthy: undefined })
    const healthy = await checkHealth(url, store.manualUsername, store.manualPassword)
    if (store.selected === url) setStore("selectedHealthy", healthy)
  }

  createEffect(() => {
    const raw = store.manualUrl
    const username = store.manualUsername
    const password = store.manualPassword
    const url = raw.trim()
    setStore("manualStatus", undefined)
    if (healthTimer) clearTimeout(healthTimer)
    if (!url) return
    healthTimer = setTimeout(async () => {
      const normalized = normalizeServerUrl(url)
      if (!normalized) return
      const healthy = await checkHealth(normalized, username, password)
      if (store.manualUrl.trim() === url) setStore("manualStatus", healthy)
    }, 500)
  })

  const connectUrl = () => {
    if (store.selected && store.selectedHealthy) return store.selected
    if (store.manualStatus) return normalizeServerUrl(store.manualUrl)
    return null
  }

  const connect = () => {
    const url = connectUrl()
    if (!url) return
    props.onComplete({
      url,
      displayName: store.manualName.trim() || undefined,
      username: store.manualUsername.trim() || undefined,
      password: store.manualPassword.trim() || undefined,
    })
  }

  return (
    <div class="flex flex-col items-center justify-center min-h-screen px-6 py-12 bg-background-base">
      <Show when={store.step === 0}>
        <div class="flex flex-col items-center text-center max-w-sm w-full gap-6">
          <div class="flex size-20 items-center justify-center rounded-2xl bg-surface-raised-base text-text-strong text-2xl font-semibold">
            OC
          </div>
          <div class="flex flex-col gap-2">
            <h1 class="text-2xl font-semibold text-text-strong">Welcome to OpenCode</h1>
            <p class="text-text-weak text-14-regular leading-relaxed">
              Connect this iOS app to an OpenCode server running on your development machine.
            </p>
          </div>
          <Button variant="primary" size="large" class="w-full mt-4" onClick={() => setStore("step", 1)}>
            Get Started
          </Button>
        </div>
      </Show>

      <Show when={store.step === 1}>
        <div class="flex flex-col items-center max-w-sm w-full gap-6">
          <StepIndicator current={1} total={3} />
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-xl font-semibold text-text-strong">Install OpenCode</h2>
            <p class="text-text-weak text-14-regular leading-relaxed">
              Install the OpenCode CLI on your development machine.
            </p>
          </div>
          <a href="https://opencode.ai/" class="external-link flex items-center justify-center gap-2 w-full px-4 py-3 rounded-md bg-surface-raised-base text-text-strong text-14-regular hover:bg-surface-base-hover transition-colors">
            <span>opencode.ai</span>
            <Icon name="square-arrow-top-right" size="small" />
          </a>
          <div class="flex gap-3 w-full mt-2">
            <Button variant="secondary" size="large" class="flex-1" onClick={() => setStore("step", 0)}>
              Back
            </Button>
            <Button variant="primary" size="large" class="flex-1" onClick={() => setStore("step", 2)}>
              Next
            </Button>
          </div>
        </div>
      </Show>

      <Show when={store.step === 2}>
        <div class="flex flex-col items-center max-w-sm w-full gap-6">
          <StepIndicator current={2} total={3} />
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-xl font-semibold text-text-strong">Start the Server</h2>
            <p class="text-text-weak text-14-regular leading-relaxed">
              Run this command in a project directory on your development machine.
            </p>
          </div>
          <CopyBlock code="opencode web --hostname 0.0.0.0" />
          <div class="flex gap-3 w-full mt-2">
            <Button variant="secondary" size="large" class="flex-1" onClick={() => setStore("step", 1)}>
              Back
            </Button>
            <Button variant="primary" size="large" class="flex-1" onClick={() => setStore("step", 3)}>
              Next
            </Button>
          </div>
        </div>
      </Show>

      <Show when={store.step === 3}>
        <div class="flex flex-col items-center max-w-sm w-full gap-5">
          <StepIndicator current={3} total={3} />
          <div class="flex flex-col gap-2 text-center">
            <h2 class="text-xl font-semibold text-text-strong">Connect</h2>
            <p class="text-text-weak text-14-regular leading-relaxed">
              Scan your network to find your server, or enter the address manually.
            </p>
          </div>

          <Button variant="secondary" size="large" class="w-full" icon="magnifying-glass" onClick={startScan} disabled={store.scanning}>
            {store.scanning ? "Scanning..." : "Scan Network"}
          </Button>

          <Show when={store.scanning}>
            <p class="text-text-dimmed text-12-regular animate-pulse">Scanning your network...</p>
          </Show>

          <Show when={store.servers.length > 0}>
            <div class="w-full rounded-md bg-surface-raised-base overflow-hidden">
              <For each={store.servers}>
                {(server) => {
                  const isSelected = () => store.selected === server.url
                  return (
                    <button
                      type="button"
                      class="w-full flex items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-surface-base-hover"
                      classList={{ "bg-surface-base-active": isSelected() }}
                      onClick={() => void selectServer(server.url)}
                    >
                      <div
                        classList={{
                          "size-2 rounded-full shrink-0": true,
                          "bg-icon-success-base": isSelected() && store.selectedHealthy === true,
                          "bg-icon-critical-base": isSelected() && store.selectedHealthy === false,
                          "bg-border-weak-base": !isSelected() || store.selectedHealthy === undefined,
                        }}
                      />
                      <div class="flex flex-col min-w-0 flex-1">
                        <span class="text-14-regular text-text-strong truncate">{server.host}</span>
                        <span class="text-12-regular text-text-dimmed truncate">{server.url}</span>
                      </div>
                      <Show when={isSelected()}>
                        <Icon name="check" size="small" class="text-icon-success-base shrink-0" />
                      </Show>
                    </button>
                  )
                }}
              </For>
            </div>
          </Show>

          <div class="w-full flex items-center gap-3">
            <div class="flex-1 h-px bg-border-weak-base" />
            <span class="text-text-dimmed text-12-regular">or enter manually</span>
            <div class="flex-1 h-px bg-border-weak-base" />
          </div>

          <div class="w-full flex items-center gap-2">
            <div
              classList={{
                "size-2 rounded-full shrink-0": true,
                "bg-icon-success-base": store.manualStatus === true,
                "bg-icon-critical-base": store.manualStatus === false,
                "bg-border-weak-base": store.manualStatus === undefined,
              }}
            />
            <div class="flex-1">
              <TextField
                hideLabel
                label="Server URL"
                placeholder="http://192.168.1.100:4096"
                value={store.manualUrl}
                onChange={(value) => setStore("manualUrl", value)}
              />
            </div>
          </div>

          <div class="w-full">
            <TextField
              hideLabel
              label="Display Name"
              placeholder="My Server"
              value={store.manualName}
              onChange={(value) => setStore("manualName", value)}
            />
          </div>

          <div class="w-full grid grid-cols-2 gap-2">
            <TextField
              hideLabel
              label="Username"
              placeholder="opencode"
              value={store.manualUsername}
              onChange={(value) => setStore("manualUsername", value)}
            />
            <TextField
              hideLabel
              label="Password"
              type="password"
              placeholder="password"
              value={store.manualPassword}
              onChange={(value) => setStore("manualPassword", value)}
            />
          </div>

          <div class="flex gap-3 w-full mt-2">
            <Button variant="secondary" size="large" class="flex-1" onClick={() => setStore("step", 2)}>
              Back
            </Button>
            <Button variant="primary" size="large" class="flex-1" disabled={!connectUrl()} onClick={connect}>
              Connect
            </Button>
          </div>
        </div>
      </Show>
    </div>
  )
}

function StepIndicator(props: { current: number; total: number }) {
  return (
    <div class="flex items-center gap-2 mb-2">
      {Array.from({ length: props.total }, (_, i) => (
        <div
          classList={{
            "h-1 rounded-full transition-all": true,
            "w-8 bg-icon-strong-base": i + 1 === props.current,
            "w-4 bg-border-weak-base": i + 1 !== props.current,
          }}
        />
      ))}
    </div>
  )
}
