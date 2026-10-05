import { defineConfig } from "vite"
import appPlugin from "@opencode/app/vite"

export default defineConfig({
  plugins: [appPlugin],
  publicDir: "../app/public",
  define: {
    "import.meta.env.TANDEM_ANDROID_NAME": JSON.stringify(
      process.env.OPENCODE_ANDROID_VARIANT === "v2" ? "Tandem V2" : "Tandem",
    ),
  },
  server: { host: "0.0.0.0", port: 1422, strictPort: true },
  build: { outDir: "dist", emptyOutDir: true, target: "esnext", assetsDir: "." },
})
