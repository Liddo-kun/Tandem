importScripts("config.js")
const extensionId = "hehggadaopoacecdllhhajmbjkdcmajg"
let busy = false
let used = false
const report = (event) =>
  fetch(TANDEM_FAULT.endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event }),
  })
setInterval(async () => {
  if (busy || used) return
  busy = true
  try {
    if ((await (await fetch(TANDEM_FAULT.endpoint)).text()) !== "restart") return
    used = true
    await chrome.management.setEnabled(extensionId, false)
    await report("disabled")
    await new Promise((resolve) => setTimeout(resolve, 1000))
    await chrome.management.setEnabled(extensionId, true)
    await report("enabled")
  } catch {
    if (used) await report("failed").catch(() => {})
  } finally {
    busy = false
  }
}, 250)
