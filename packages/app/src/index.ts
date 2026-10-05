// UPSTREAM-DIVERGENCE: Initialize shared polyfills for the Android app entry.
import "./runtime/polyfills"

export { AppBaseProviders, AppInterface, preloadRoute } from "./app"
export { type FatalRendererErrorLog, type Platform, PlatformProvider } from "./runtime/platform/platform"
export { ServerConnection } from "./runtime/server/registry"
// UPSTREAM-DIVERGENCE: Export the browser draft store for Android text/attachment persistence.
export { createBrowserDraftStore } from "./runtime/persistence/drafts"
