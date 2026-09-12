importScripts("config.js")
const epoch = crypto.randomUUID()
const activations = []
chrome.tabs.onActivated.addListener((event) => {
  activations.push({ ...event, at: Date.now() })
  if (activations.length > 256) activations.shift()
})
let pending = false
setInterval(async () => {
  if (pending) return
  pending = true
  try {
    const tabs = await chrome.tabs.query({})
    await fetch(globalThis.TANDEM_OBSERVER.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        epoch,
        at: Date.now(),
        activations,
        tabs: tabs.map(({ id, windowId, active, url }) => ({ id, windowId, active, url })),
      }),
    })
  } catch {
  } finally {
    pending = false
  }
}, 250)
