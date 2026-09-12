// Saved grants contain configured browser IDs, not the display labels from permission prompts.
export function browserGrantScope(resource: string) {
  if (resource.length > 16384) return
  const parts = resource.split(":")
  if (parts.length !== 4 || parts.some((part) => !/^(?:[a-f0-9]{2})+$/.test(part))) return
  let values: string[]
  try {
    values = parts.map((part) =>
      new TextDecoder("utf-8", { fatal: true }).decode(
        Uint8Array.from(part.match(/../g)!, (byte) => Number.parseInt(byte, 16)),
      ),
    )
  } catch {
    return
  }
  const [browser, capability, origin, frame] = values
  if (
    !browser ||
    browser.length > 256 ||
    /[\s*?\[\]\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(browser)
  )
    return
  if (!["discovery", "create", "read", "input", "navigation", "screenshot", "handoff", "site"].includes(capability!)) return
  const validOrigin = (value: string | undefined) => {
    if (value === "browser") return capability === "discovery"
    if (
      !value ||
      value.length > 2048 ||
      /[*?\u0000-\u0020\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value) ||
      !URL.canParse(value)
    )
      return false
    const url = new URL(value)
    return (url.protocol === "http:" || url.protocol === "https:") && url.origin === value
  }
  if (!validOrigin(origin) || !validOrigin(frame)) return
  return { browser, capability: capability!, origin: origin!, frame: frame! }
}
