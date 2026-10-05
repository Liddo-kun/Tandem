// Tandem-owned (not in upstream): cancellation-safe native LAN discovery adapter.
import { addPluginListener } from "@tauri-apps/api/core"
import { bridge } from "./bridge"

type Server = { url: string; authenticationRequired: boolean }

export function createServerDiscovery() {
  let current: { cancelled: boolean; started: boolean; cancellation?: Promise<unknown> } | undefined
  let pending = Promise.resolve()

  return {
    discoverServers(onServer: (server: Server) => void) {
      const scan = { cancelled: false, started: false, cancellation: undefined as Promise<unknown> | undefined }
      current = scan
      // Only one set of native event listeners may own the untagged scan events.
      const result = pending.then(async () => {
        if (scan.cancelled) return
        const started = await addPluginListener("mobile-bridge", "scanStarted", () => {
          scan.started = true
          if (scan.cancelled) scan.cancellation ??= bridge.sendAsync("cancelScan")
        })
        try {
          if (scan.cancelled) return
          const listener = await addPluginListener<Server>("mobile-bridge", "scanResult", (server) => {
            if (!scan.cancelled) onServer(server)
          })
          try {
            // Cancellation during listener setup must not launch a new scan.
            if (scan.cancelled) return
            const servers = await bridge.sendAsync<Server[]>("scanNetwork")
            if (!servers && !scan.cancelled) throw new Error("Native discovery failed")
          } finally {
            await listener.unregister()
          }
        } finally {
          // Drain cancellation before the next scan can reset the native flag.
          await scan.cancellation
          await started.unregister()
        }
      }).finally(() => {
        if (current === scan) current = undefined
      })
      pending = result.catch(() => undefined)
      return result
    },
    async cancelServerDiscovery() {
      if (!current) return
      current.cancelled = true
      // Native scanNetwork resets its cancellation flag. Wait for its start event
      // before sending cancel, rather than having that reset erase an early cancel.
      if (current.started) await (current.cancellation ??= bridge.sendAsync("cancelScan"))
    },
  }
}
