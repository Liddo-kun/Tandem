// Tandem-owned (not in upstream): when opencode.session_start creates a session, open it as a
// background tab right after the starting session's tab. Only windows with that tab open react.
import { createEffect, createRoot, onCleanup, untrack } from "solid-js"
import { ServerConnection } from "@/runtime/server/registry"
import { useGlobal } from "@/runtime/server/runtime"
import { findSessionTab, tabKey, useTabs } from "@/shell/tabs/tabs"

export function TandemSessionStartTabs() {
  const global = useGlobal()
  const tabs = useTabs()
  const handled = new Set<string>()

  const place = (server: ServerConnection.Key, originID: string, sessionID: string) => {
    const added = tabs.addSessionTab({ server, sessionId: sessionID })
    // addSessionTab inserts in a transition; move the tab once, when it is in the store.
    createRoot((dispose) => {
      let done = false
      const finish = () => {
        if (done) return
        done = true
        clearTimeout(timeout)
        queueMicrotask(dispose)
      }
      const timeout = setTimeout(finish, 5000)
      createEffect(() => {
        const keys = tabs.store.map(tabKey)
        if (done || !keys.includes(tabKey(added))) return
        finish()
        untrack(() => {
          const origin = findSessionTab(tabs.store, server, originID)
          if (!origin) return
          const rest = keys.filter((key) => key !== tabKey(added))
          rest.splice(rest.indexOf(tabKey(origin)) + 1, 0, tabKey(added))
          tabs.reorder(rest)
        })
      })
    })
  }

  createEffect(() => {
    for (const conn of global.servers.list()) {
      const server = ServerConnection.key(conn)
      const ctx = global.serverCtx(server)
      if (!ctx) continue
      onCleanup(
        ctx.sdk.event.listen((event) => {
          // Children inherit their parent's metadata; only the started session itself counts.
          if (event.type !== "session.created" || event.data.parentID) return
          const startedBy = event.data.metadata?.tandemStartedBy
          const originID =
            startedBy && typeof startedBy === "object" && "sessionID" in startedBy ? startedBy.sessionID : undefined
          if (typeof originID !== "string" || handled.has(event.data.sessionID)) return
          handled.add(event.data.sessionID)
          if (!findSessionTab(tabs.store, server, originID)) return
          place(server, originID, event.data.sessionID)
        }),
      )
    }
  })

  return null
}
