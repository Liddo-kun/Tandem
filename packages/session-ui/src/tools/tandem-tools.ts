// Tandem-owned (not in upstream): register imagegen and browser-webfetch chat cards,
// and link sessions started from an Execute call.
import { getTool, type registerTool } from "./tool-renderer"
import { ImagegenRenderer } from "./imagegen"
import { withStartedSessions } from "./tandem-session-start"
import { WebFetchRenderer } from "./webfetch"

export function registerTandemTools(register: typeof registerTool) {
  // The upstream registry is last-registration-wins; call after its built-in cards.
  register({ name: "webfetch", render: WebFetchRenderer })
  register({ name: "imagegen", render: ImagegenRenderer })
  const execute = getTool("execute")
  if (execute) register({ name: "execute", render: withStartedSessions(execute) })
}
