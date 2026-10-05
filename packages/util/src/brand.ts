// Tandem-owned (not in upstream): centralized product identity and release URLs.
export * as Brand from "./brand.js"

// Product identity only. Package scopes, provider IDs, protocol and config names
// remain upstream conventions. Keep this module pure for Node and browser consumers.
export const product = "Tandem"
export const command = "tandem"
export const app = "tandem"
export const repository = "https://github.com/Liddo-kun/Tandem"
export const issues = `${repository}/issues`
export const releases = "https://github.com/Liddo-kun/Tandem/releases"
export const manualUpdateMessage = `${product} updates are installed manually. Download releases from ${releases}`
