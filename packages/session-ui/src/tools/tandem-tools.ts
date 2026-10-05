// Tandem-owned (not in upstream): register imagegen and browser-webfetch chat cards.
import type { registerTool } from "./tool-renderer"
import { ImagegenRenderer } from "./imagegen"
import { WebFetchRenderer } from "./webfetch"

export function registerTandemTools(register: typeof registerTool) {
  // The upstream registry is last-registration-wins; call after its built-in cards.
  register({ name: "webfetch", render: WebFetchRenderer })
  register({ name: "imagegen", render: ImagegenRenderer })
}
