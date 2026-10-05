// UPSTREAM-DIVERGENCE: Remove upstream artwork; preserve the component API via Tandem-owned art.
export { Mark, Splash, Logo } from "./tandem-logo"
// UPSTREAM-DIVERGENCE: Export bundled Tandem artwork for browser/desktop notifications.
export const notificationIcon = new URL("../assets/brand/notification.png", import.meta.url).href
