// Tandem-owned (not in upstream): register imagegen and browser-webfetch chat cards,
// and link sessions started from an Execute call.
import type { ToolRegistry } from "./tool-renderer"
import { ImagegenRenderer } from "./imagegen"
import { withStartedSessions } from "./tandem-session-start"
import { WebFetchRenderer } from "./webfetch"

export function registerTandemTools(registry: typeof ToolRegistry) {
  // The upstream registry is last-registration-wins; call after its built-in cards.
  registry.register({ name: "webfetch", render: WebFetchRenderer })
  registry.register({ name: "imagegen", render: ImagegenRenderer })
  const execute = registry.render("execute")

  if (execute) registry.register({ name: "execute", render: withStartedSessions(execute) })
}
