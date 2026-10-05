// Tandem-owned (not in upstream): Tandem SVG wordmark with the shared typography API.
import { createUniqueId, type ComponentProps } from "solid-js"

export function Wordmark(
  props: Pick<ComponentProps<"svg">, "class"> & { fade?: boolean; muted?: boolean; outline?: boolean },
) {
  const gradient = createUniqueId()
  const mask = createUniqueId()
  return (
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 720 129" fill="none" class={props.class}>
      <g opacity={props.muted === false ? 1 : 0.16} mask={props.fade === false ? undefined : `url(#${mask})`}>
        <text
          x="360"
          y="104"
          text-anchor="middle"
          font-family="ui-sans-serif, system-ui, sans-serif"
          font-size="120"
          font-weight="700"
          fill={props.outline ? "none" : "currentColor"}
          stroke={props.outline ? "currentColor" : undefined}
        >
          Tandem
        </text>
      </g>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop stop-color="white" stop-opacity="0.7" />
          <stop offset="1" stop-color="white" stop-opacity="0" />
        </linearGradient>
        <mask id={mask}>
          <rect width="720" height="129" fill={`url(#${gradient})`} />
        </mask>
      </defs>
    </svg>
  )
}
