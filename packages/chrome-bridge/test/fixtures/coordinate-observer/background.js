importScripts("config.js")
let pending = false
setInterval(async () => {
  if (pending) return
  pending = true
  try {
    const command = await (await fetch(TANDEM_COORDINATE.endpoint)).json()
    if (!command) return
    const tabs = await chrome.tabs.query({})
    const tab = tabs.find((tab) => tab.url === command.url)
    if (!tab || !command.url.startsWith(TANDEM_COORDINATE.origin + "/?token=")) throw new Error("Not fixture")
    // Real browser page zoom, not pinch/pageScale or a renderer metrics override.
    await chrome.tabs.setZoom(tab.id, command.zoom)
    const zoom = await chrome.tabs.getZoom(tab.id)
    await fetch(TANDEM_COORDINATE.endpoint, { method: "POST", body: JSON.stringify({ id: command.id, zoom }) })
  } finally {
    pending = false
  }
}, 100)
