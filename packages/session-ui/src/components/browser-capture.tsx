// UPSTREAM-DIVERGENCE: owned captures fetch only while visible, under a shared bounded blob lifetime.
import { createEffect, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { useData } from "../context/data"
import { useI18n } from "@opencode-ai/ui/context/i18n"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { ImagePreview } from "@opencode-ai/ui/image-preview"
import { createCaptureView, type CaptureState } from "./browser-capture-pool"

export function BrowserCapture(props: { sessionID: string; uri: string; onLoad?: () => void }) {
  const data = useData()
  const i18n = useI18n()
  const dialog = useDialog()
  const [state, setState] = createStore<CaptureState>({ failed: false, loading: false })
  let element: HTMLDivElement | undefined
  let retry: (() => void) | undefined
  let fail: (() => void) | undefined
  createEffect(() => {
    const read = data.readBrowserImage
    const sessionID = props.sessionID
    const uri = props.uri
    const view = createCaptureView({
      read: (signal) => read?.(sessionID, uri, signal) ?? Promise.resolve(undefined),
      change: setState,
    })
    let intersecting = false
    const update = () =>
      view.visible(
        intersecting &&
          !document.hidden &&
          !!element?.getClientRects().length &&
          (!element.checkVisibility || element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })),
      )
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(
            (entries) => {
              const entry = entries[entries.length - 1]
              intersecting =
                !!entry?.isIntersecting && entry.intersectionRect.width > 0 && entry.intersectionRect.height > 0
              update()
            },
            { threshold: 0.01 },
          )
    if (element) observer?.observe(element)
    // Platforms without IntersectionObserver require an explicit click rather than eagerly fetching history.
    retry = () => {
      if (!observer) intersecting = true
      update()
      view.retry()
    }
    fail = view.fail
    document.addEventListener("visibilitychange", update)
    onCleanup(() => {
      retry = undefined
      fail = undefined
      observer?.disconnect()
      document.removeEventListener("visibilitychange", update)
      view.dispose()
    })
  })
  const alt = () => i18n.t("ui.fileMedia.kind.image")
  const unavailable = () => i18n.t("ui.fileMedia.state.unavailable", { kind: alt() })
  // A stable placeholder prevents releasing offscreen images from shifting the timeline back into view.
  return (
    <div
      ref={element}
      data-component="browser-capture"
      style={{
        width: "180px",
        "max-width": "100%",
        height: "140px",
        display: "flex",
        "align-items": "center",
        "justify-content": "center",
      }}
    >
      <Show
        when={state.src}
        fallback={
          <button type="button" disabled={state.loading} onClick={() => retry?.()}>
            {state.failed
              ? unavailable()
              : state.loading
                ? i18n.t("ui.fileMedia.state.loading", { kind: alt() })
                : alt()}
          </button>
        }
      >
        {(src) => (
          <button
            type="button"
            data-slot="imagegen-thumb"
            onClick={() =>
              dialog.show(() => (
                <Show when={state.src} fallback={<span>{unavailable()}</span>}>
                  {(current) => <ImagePreview src={current()} alt={alt()} />}
                </Show>
              ))
            }
          >
            <img src={src()} alt={alt()} onLoad={() => props.onLoad?.()} onError={() => fail?.()} />
          </button>
        )}
      </Show>
    </div>
  )
}
