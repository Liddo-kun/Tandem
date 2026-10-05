/** One Android viewport owner. Shared chrome consumes insets; the root has no inset padding. */
export function androidViewport(zoom: () => number) {
  const probe = document.createElement("div")
  probe.style.cssText = "position:fixed;visibility:hidden;pointer-events:none;padding:env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)"
  let insets: { top: number; bottom: number; left: number; right: number } | undefined
  const values = new Map<string, string>()
  const set = (key: string, value: number) => {
    const text = `${value / zoom()}px`
    if (values.get(key) === text) return
    values.set(key, text)
    document.documentElement.style.setProperty(key, text)
  }
  const sync = () => {
    if (!probe.isConnected) return
    if (!insets) {
      const style = getComputedStyle(probe)
      insets = {
        top: parseFloat(style.paddingTop) || 0,
        bottom: parseFloat(style.paddingBottom) || 0,
        left: parseFloat(style.paddingLeft) || 0,
        right: parseFloat(style.paddingRight) || 0,
      }
    }
    const height = window.visualViewport?.height ?? window.innerHeight
    // adjustResize shrinks innerHeight too; compare against the screen's layout viewport.
    const keyboard = window.screen.height - height > 150
    set("--android-viewport-height", height)
    set("--safe-area-inset-top", insets.top)
    set("--safe-area-inset-bottom", keyboard ? 0 : insets.bottom)
    set("--safe-area-inset-left", insets.left)
    set("--safe-area-inset-right", insets.right)
  }
  const resize = () => { insets = undefined; sync() }
  return {
    sync,
    start: () => {
      document.body.append(probe)
      sync()
      window.addEventListener("resize", resize)
      window.visualViewport?.addEventListener("resize", resize)
      window.visualViewport?.addEventListener("scroll", sync)
      return () => {
        window.removeEventListener("resize", resize)
        window.visualViewport?.removeEventListener("resize", resize)
        window.visualViewport?.removeEventListener("scroll", sync)
        probe.remove()
        for (const key of values.keys()) document.documentElement.style.removeProperty(key)
      }
    },
  }
}
