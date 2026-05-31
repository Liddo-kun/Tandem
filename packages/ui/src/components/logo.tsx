import { type ComponentProps } from "solid-js"

// UPSTREAM-DIVERGENCE: Tandem brand mark. A bold "T" monogram with an offset depth shadow,
// cohesive with the ANSI Shadow CLI wordmark and the Android launcher icon. Shapes use the
// shared --icon-* CSS vars so they theme correctly across web/desktop/mobile.
export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-mark-shadow" d="M3 4H15V9H11V18H7V9H3V4Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-mark-t" d="M2 3H14V8H10V17H6V8H2V3Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M14 19H74V44H54V89H34V44H14V19Z" fill="var(--icon-base)" />
      <path d="M10 15H70V40H50V85H30V40H10V15Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 168 40"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <path d="M5 7H21V14H15V32H11V14H5V7Z" fill="var(--icon-weak-base)" />
      <path d="M3 5H19V12H13V30H7V12H3V5Z" fill="var(--icon-strong-base)" />
      <text
        x="30"
        y="29"
        font-family="ui-sans-serif, system-ui, -apple-system, sans-serif"
        font-weight="700"
        font-size="28"
        letter-spacing="-0.5"
        fill="var(--icon-strong-base)"
      >
        Tandem
      </text>
    </svg>
  )
}
