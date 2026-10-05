// Tandem-owned (not in upstream): preserve Android metadata and native toolchain settings after Tauri generation.
import path from "node:path"
import { existsSync } from "node:fs"
import { findAndroidAapt2 } from "../../script/android-toolchain-env"

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
const gradlePropertiesPath = path.join(import.meta.dir, "src-tauri", "gen", "android", "gradle.properties")
const buildGradlePath = path.join(import.meta.dir, "src-tauri", "gen", "android", "app", "build.gradle.kts")
const stringsPath = generated("res", "values", "strings.xml")
const mainActivityTemplatePath = path.join(import.meta.dir, "src-tauri", "templates", "MainActivity.kt")
const baseConfig = (await Bun.file(path.join(import.meta.dir, "src-tauri", "tauri.conf.json")).json()) as TauriConfig
const config: TauriConfig = process.env.OPENCODE_ANDROID_VARIANT === "v2"
  ? { ...baseConfig, ...await Bun.file(path.join(import.meta.dir, "src-tauri", "tauri.v2.conf.json")).json() }
  : baseConfig
const manifest = Bun.file(manifestPath)
const mainActivity = await findMainActivity()

await patchGradleProperties()

const preserveVariantMetadata = process.env.OPENCODE_ANDROID_VARIANT === "1"
await patchBuildGradle(preserveVariantMetadata)
if (!preserveVariantMetadata) await patchStrings()

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
  // after init/prepare so edge-to-edge setup and disabled native pinch zoom survive regeneration.
  await Bun.write(
    mainActivity,
    (await Bun.file(mainActivityTemplatePath).text()).replace(
      /^package .+$/m,
      (await Bun.file(mainActivity).text()).match(/^package .+$/m)?.[0] ?? "package ai.opencode.android",
    ),
  )
}

async function patchBuildGradle(preserveIdentifier: boolean) {
  const buildGradle = Bun.file(buildGradlePath)
  if (!(await buildGradle.exists())) return

  let text = patchReleaseSigning(await buildGradle.text())
  if (!preserveIdentifier) {
    text = text.replace(
      /applicationId\s*=\s*"[^"]+"/,
      `applicationId = "${config.identifier ?? "app.liddokun.tandem"}"`,
    )
  }

  await Bun.write(
    buildGradlePath,
    text
      // UPSTREAM-DIVERGENCE: Android release APKs must connect to LAN HTTP Tandem/opencode servers.
      .replace(
        /manifestPlaceholders\["usesCleartextTraffic"\]\s*=\s*"[^"]+"/,
        `manifestPlaceholders["usesCleartextTraffic"] = "true"`,
      ),
  )
}

function patchReleaseSigning(text: string) {
  // External signing paths keep both development and production secrets out of source.
  const signingProperties = process.env.TANDEM_ANDROID_KEYSTORE_PROPERTIES ?? "../../../../keystore.properties"
  const propertiesMarker = `val releaseKeystorePropertiesFile = file(${JSON.stringify(signingProperties)})`
  const signingMarker = `signingConfigs {`

  let updated = text.replace(/val releaseKeystorePropertiesFile = file\("[^"]*"\)/, propertiesMarker)
  if (!updated.includes(propertiesMarker)) {
    updated = updated.replace(
      /(val tauriProperties = Properties\(\)\.apply \{[\s\S]*?\n\})/,
      `$1

${propertiesMarker}
val releaseKeystoreProperties = Properties().apply {
    if (releaseKeystorePropertiesFile.exists()) {
        releaseKeystorePropertiesFile.inputStream().use { load(it) }
    }
}`,
    )
  }

  if (!updated.includes(signingMarker)) {
    updated = updated.replace(
      /    buildTypes \{/,
      `    signingConfigs {
        create("release") {
            val releaseStoreFile = releaseKeystoreProperties.getProperty("storeFile")
            if (releaseKeystorePropertiesFile.exists() && !releaseStoreFile.isNullOrBlank()) {
                storeFile = releaseKeystorePropertiesFile.parentFile.resolve(releaseStoreFile)
                storePassword = releaseKeystoreProperties.getProperty("storePassword")
                keyAlias = releaseKeystoreProperties.getProperty("keyAlias")
                keyPassword = releaseKeystoreProperties.getProperty("keyPassword")
            }
        }
    }
    buildTypes {`,
    )
  }

  updated = updated.replace(
    `            if (releaseKeystorePropertiesFile.exists()) {
                storeFile = file(releaseKeystoreProperties.getProperty("storeFile"))`,
    `            val releaseStoreFile = releaseKeystoreProperties.getProperty("storeFile")
            if (releaseKeystorePropertiesFile.exists() && !releaseStoreFile.isNullOrBlank()) {
                storeFile = releaseKeystorePropertiesFile.parentFile.resolve(releaseStoreFile)`,
  )

  if (!updated.includes(`signingConfig = signingConfigs.getByName("release")`)) {
    updated = updated.replace(
      /        getByName\("release"\) \{\r?\n/,
      `        getByName("release") {
            if (releaseKeystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
`,
    )
  }

  return updated
}

async function patchGradleProperties() {
  const gradleProperties = Bun.file(gradlePropertiesPath)
  if (!(await gradleProperties.exists())) return

  const properties: Record<string, string> = {
    // CI-style local builds should exit cleanly instead of leaving Gradle/Kotlin daemons alive.
    "org.gradle.daemon": "false",
    "kotlin.compiler.execution.strategy": "in-process",
  }

  // UPSTREAM-DIVERGENCE: When building on an arm64 Linux host (e.g. the tablet itself), AGP would
  // otherwise download an x86_64 aapt2 from Maven that cannot execute. Point it at the SDK's native
  // arm64 aapt2 instead. No-op on x86_64 release hosts, so the normal release build is unaffected.
  const arm64Aapt2 = findArm64Aapt2()
  if (arm64Aapt2) properties["android.aapt2FromMavenOverride"] = arm64Aapt2

  await Bun.write(gradlePropertiesPath, setProperties(await gradleProperties.text(), properties))
}

function findArm64Aapt2() {
  if (process.platform !== "linux" || process.arch !== "arm64") return
  const sdk = process.env.ANDROID_HOME ?? process.env.ANDROID_SDK_ROOT
  if (!sdk) return

  return findAndroidAapt2(sdk, { order: "lexical" })
}

async function patchStrings() {
  const strings = Bun.file(stringsPath)
  if (!(await strings.exists())) return

  // UPSTREAM-DIVERGENCE: Generated Android labels should fall back to Tandem if config is missing.
  const appName = escapeXml(config.productName ?? "Tandem")
  const title = escapeXml(config.app?.windows?.[0]?.title ?? config.productName ?? "Tandem")
  const text = await strings.text()
  await Bun.write(
    stringsPath,
    text
      .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${appName}</string>`)
      .replace(
        /<string name="main_activity_title">[^<]*<\/string>/,
        `<string name="main_activity_title">${title}</string>`,
      ),
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

function setProperties(text: string, properties: Record<string, string>) {
  const lines = text.split(/\r?\n/)
  const seen = new Set<string>()

  const updated = lines.map((line) => {
    const match = line.match(/^([^#!\s][^=]*)=(.*)$/)
    if (!match) return line

    const key = match[1]!.trim()
    const value = properties[key]
    if (value === undefined) return line

    seen.add(key)
    return `${key}=${value}`
  })

  for (const [key, value] of Object.entries(properties)) {
    if (!seen.has(key)) updated.push(`${key}=${value}`)
  }

  return updated.join("\n")
}
