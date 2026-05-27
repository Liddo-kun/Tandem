import { defineConfig } from "vite"
import appPlugin from "@opencode-ai/app/vite"

export default defineConfig({
  plugins: [appPlugin],
  publicDir: "../app/public",
  define: {
    "import.meta.env.VITE_TANDEM_ANDROID_V2_ONLY": JSON.stringify("true"),
  },
  server: {
    host: "0.0.0.0",
    port: 1422,
    strictPort: true,
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "esnext",
    assetsDir: ".",
  },
})
