import path from "node:path"
import { existsSync } from "node:fs"

type TauriConfig = {
  productName?: string
  identifier?: string
  app?: {
    windows?: Array<{ title?: string }>
  }
}

const generated = (...parts: string[]) =>
  path.join(import.meta.dir, "src-tauri", "gen", "android", "app", "src", "main", ...parts)

const manifestPath = generated("AndroidManifest.xml")
const buildGradlePath = path.join(import.meta.dir, "src-tauri", "gen", "android", "app", "build.gradle.kts")
const stringsPath = generated("res", "values", "strings.xml")
const mainActivityTemplatePath = path.join(import.meta.dir, "src-tauri", "templates", "MainActivity.kt")
const config = (await Bun.file(path.join(import.meta.dir, "src-tauri", "tauri.conf.json")).json()) as TauriConfig
const manifest = Bun.file(manifestPath)
const mainActivity = await findMainActivity()

if (process.env.OPENCODE_ANDROID_VARIANT !== "1") {
  await patchBuildGradle()
  await patchStrings()
}

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

if (mainActivity && (await Bun.file(mainActivity).exists())) {
  // UPSTREAM-DIVERGENCE: Tauri regenerates MainActivity.kt. Copy a reviewed template
  // after init/prepare so edge-to-edge setup and hardware volume zoom survive regeneration.
  await Bun.write(
    mainActivity,
    (await Bun.file(mainActivityTemplatePath).text()).replace(
      /^package .+$/m,
      (await Bun.file(mainActivity).text()).match(/^package .+$/m)?.[0] ?? "package ai.opencode.android",
    ),
  )
}

async function patchBuildGradle() {
  const buildGradle = Bun.file(buildGradlePath)
  if (!(await buildGradle.exists())) return

  const text = await buildGradle.text()
  await Bun.write(
    buildGradlePath,
    text.replace(/applicationId\s*=\s*"[^"]+"/, `applicationId = "${config.identifier ?? "com.devgriffin.whispercode"}"`),
  )
}

async function patchStrings() {
  const strings = Bun.file(stringsPath)
  if (!(await strings.exists())) return

  const appName = escapeXml(config.productName ?? "WhisperCode")
  const title = escapeXml(config.app?.windows?.[0]?.title ?? config.productName ?? "WhisperCode")
  const text = await strings.text()
  await Bun.write(
    stringsPath,
    text
      .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${appName}</string>`)
      .replace(/<string name="main_activity_title">[^<]*<\/string>/, `<string name="main_activity_title">${title}</string>`),
  )
}

async function findMainActivity() {
  const javaRoot = generated("java")
  if (!existsSync(javaRoot)) return

  for await (const file of new Bun.Glob("**/MainActivity.kt").scan({ cwd: javaRoot, absolute: true })) {
    return file
  }
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
}
