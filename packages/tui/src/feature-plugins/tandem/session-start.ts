// Tandem-owned (not in upstream): when opencode.session_start creates a session from the session
// shown here (or one of its open tabs), open it as a tab right after that session's tab and say so.
import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "tandem.session-start",
  setup(context) {
    const handled = new Set<string>()
    const timers = new Set<ReturnType<typeof setTimeout>>()

    const dispose = context.data.on("session.created", (event) => {
      // Children inherit their parent's metadata; only the started session itself counts.
      if (event.data.parentID) return
      const sessionID = event.data.sessionID
      const startedBy = event.data.metadata?.tandemStartedBy
      const originID =
        startedBy && typeof startedBy === "object" && "sessionID" in startedBy ? startedBy.sessionID : undefined
      if (typeof originID !== "string" || handled.has(sessionID)) return
      handled.add(sessionID)

      const origin = context.data.session.root(originID)
      const route = context.ui.router.current()
      const shown = route.type === "session" && context.data.session.root(route.sessionID) === origin
      if (!shown && !context.ui.tabs.list().some((tab) => tab.sessionID === origin)) return

      const opened = context.ui.tabs.open(sessionID)
      if (opened) {
        // Tabs are admitted asynchronously; move the new one once it is listed.
        let tries = 0
        const move = () => {
          const list = context.ui.tabs.list()
          const index = list.findIndex((tab) => tab.sessionID === origin)
          if (index !== -1 && list.some((tab) => tab.sessionID === sessionID)) {
            context.ui.tabs.move(sessionID, index + 1)
            return
          }
          if (++tries > 40) return
          const timer = setTimeout(() => {
            timers.delete(timer)
            move()
          }, 50)
          timers.add(timer)
        }
        move()
      }
      context.ui.toast.show({
        sessionID,
        title: "Session started",
        message: opened ? "Opened in a new tab." : "Running in the background.",
      })
    })

    return () => {
      dispose()
      timers.forEach(clearTimeout)
    }
  },
})
