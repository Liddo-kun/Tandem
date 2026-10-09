import { defineConfig } from "vite"
import appPlugin from "@opencode/app/vite"

const names: Record<string, string> = { v2: "Tandem Dev", desktop: "Tandem Desktop" }

export default defineConfig({
  plugins: [appPlugin],
  publicDir: "../app/public",
  define: {
    "import.meta.env.TANDEM_ANDROID_NAME": JSON.stringify(
      names[process.env.OPENCODE_ANDROID_VARIANT ?? ""] ?? "Tandem",
    ),
  },
  server: { host: "0.0.0.0", port: 1422, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "esnext", assetsDir: "." },
})
