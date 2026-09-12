importScripts("config.js")
// Test-only observer: never attach a debugger, and do not inspect before the server exits.
setInterval(async () => {
  try {
    await chrome.runtime.getPlatformInfo()
    const endpoint = globalThis.TANDEM_OBSERVER.endpoint
    if (!(await fetch(endpoint)).ok) return
    const targetInfos = await chrome.debugger.getTargets()
    await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ at: Date.now(), targetInfos }),
    })
  } catch {
    /* The fixture starts/stops independently of the browser. */
  }
}, 250)
