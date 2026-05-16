import path from "node:path"

const generated = (...parts: string[]) =>
  path.join(import.meta.dir, "src-tauri", "gen", "android", "app", "src", "main", ...parts)

const manifestPath = generated("AndroidManifest.xml")
const mainActivityPath = generated("java", "ai", "opencode", "android", "MainActivity.kt")
const mainActivityTemplatePath = path.join(import.meta.dir, "src-tauri", "templates", "MainActivity.kt")
const manifest = Bun.file(manifestPath)
const mainActivity = Bun.file(mainActivityPath)

if (await manifest.exists()) {
  const text = await manifest.text()
  const marker = /(\s+android:name="\.MainActivity"\r?\n)/
  const match = text.match(marker)

  if (!text.includes('android:windowSoftInputMode="adjustResize"') && match) {
    const newline = match[1]!.endsWith("\r\n") ? "\r\n" : "\n"
    await Bun.write(
      manifestPath,
      text.replace(marker, `$1            android:windowSoftInputMode="adjustResize"${newline}`),
    )
  }
}

if (await mainActivity.exists()) {
  // UPSTREAM-DIVERGENCE: Tauri regenerates MainActivity.kt. Copy a reviewed template
  // after init/prepare so edge-to-edge setup and hardware volume zoom survive regeneration.
  await Bun.write(mainActivityPath, await Bun.file(mainActivityTemplatePath).text())
}
