import path from "node:path"

const manifestPath = path.join(
  import.meta.dir,
  "src-tauri",
  "gen",
  "android",
  "app",
  "src",
  "main",
  "AndroidManifest.xml",
)
const manifest = Bun.file(manifestPath)

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
