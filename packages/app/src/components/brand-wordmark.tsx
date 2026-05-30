import { Brand } from "@opencode-ai/core/brand"

// UPSTREAM-DIVERGENCE: Tandem uses a text wordmark instead of rewriting upstream logo SVG assets.
export function BrandWordmark(props: { class?: string }) {
  return <div class={props.class}>{Brand.name}</div>
}
