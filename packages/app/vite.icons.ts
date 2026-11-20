import { readFileSync } from "node:fs"
import type { Plugin } from "vite"
import manifest from "./manifest.json" with { type: "json" }

export function icons(channel: string): Plugin {
  const selected = channel === "beta" || channel === "prod" ? channel : "dev"
  const prefix = `icons/${selected}`

  const iconFiles = [
    ...Object.entries({
      "favicon.ico": "icon.ico",
      // UPSTREAM-DIVERGENCE: Use shared Tandem touch-icon and manifest assets.
      "apple-touch-icon.png": "apple-touch-icon.png",
      "web-app-manifest-192x192.png": "manifest-192.png",
      "web-app-manifest-512x512.png": "icon.png",
    }).map(([name, source]) => ({
      fileName: `${prefix}/${name}`,
      // UPSTREAM-DIVERGENCE: Source web branding from shared Tandem assets, not desktop channel icons.
      source: readFileSync(new URL(`../ui/src/assets/brand/${source}`, import.meta.url)),
      type: name.endsWith(".ico") ? "image/x-icon" : "image/png",
    })),
  ]

  // Vite's resolved `base`, such as `/opencode/` for `vite build --base=/opencode/`.
  let base = "/"

  const webManifest = () => ({
    fileName: "site.webmanifest",
    source: JSON.stringify({
      ...manifest,
      id: base,
      start_url: base,
      scope: base,
      icons: manifest.icons.map((icon) => ({ ...icon, src: `${base}${prefix}${icon.src}` })),
    }),
    type: "application/manifest+json",
  })

  const files = () => [...iconFiles, webManifest()]

  return {
    name: "opencode-app:icons",
    configResolved(config) {
      base = config.base
    },
    generateBundle() {
      files().forEach((file) => this.emitFile({ type: "asset", fileName: file.fileName, source: file.source }))
    },
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const file = files().find((file) => `${base}${file.fileName}` === request.url?.split("?")[0])

        if (!file) return next()
        response.setHeader("Content-Type", file.type)
        response.end(file.source)
      })
    },
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        // UPSTREAM-DIVERGENCE: Substitute Tandem social-preview metadata alongside favicon URLs.
        return html
          .replace("%OPENCODE_FAVICON%", `${base}${prefix}/favicon.ico`)
          .replace("%OPENCODE_APPLE_TOUCH_ICON%", `${base}${prefix}/apple-touch-icon.png`)
          .replaceAll("%OPENCODE_SOCIAL_ICON%", `${base}${prefix}/web-app-manifest-512x512.png`)
      },
    },
  }
}
