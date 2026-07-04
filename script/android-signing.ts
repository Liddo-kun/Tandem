import { randomBytes } from "crypto"
import fs from "fs/promises"
import path from "path"

// Android release signing uses ignored local files at packages/android/release.keystore
// and packages/android/keystore.properties. If neither exists, create a fresh local
// signing key; if only one exists, fail loudly instead of silently re-keying (a new
// key would break `adb install -r` over the previously installed app).
// Shared by tandem:release (build-tandem-release.ts) and tandem:tablet
// (build-tablet-android.ts).
export async function ensureAndroidSigning(root: string) {
  const keystore = path.join(root, "packages/android/release.keystore")
  const properties = path.join(root, "packages/android/keystore.properties")
  const hasKeystore = await exists(keystore)
  const hasProperties = await exists(properties)
  if (hasKeystore && hasProperties) return

  if (hasKeystore || hasProperties) {
    throw new Error(
      `Android release signing is incomplete. Restore the missing file, or delete both files so the release script can create a fresh local signing key:\n- packages/android/release.keystore\n- packages/android/keystore.properties`,
    )
  }

  await fs.mkdir(path.dirname(keystore), { recursive: true })
  const password = randomBytes(48).toString("base64url")
  const command = [
    "keytool",
    "-genkeypair",
    "-v",
    "-keystore",
    keystore,
    "-storetype",
    "PKCS12",
    "-alias",
    "tandem-release",
    "-keyalg",
    "RSA",
    "-keysize",
    "4096",
    "-validity",
    "10000",
    "-storepass",
    password,
    "-keypass",
    password,
    "-dname",
    "CN=Tandem, O=Tandem, C=US",
  ]
  const proc = Bun.spawn(command, { cwd: root, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) {
    await fs.rm(keystore, { force: true })
    throw new Error(`Failed to create Android release keystore with keytool.\n${stdout}${stderr}`)
  }

  await fs.writeFile(
    properties,
    [`storeFile=release.keystore`, `storePassword=${password}`, `keyAlias=tandem-release`, `keyPassword=${password}`, ""].join("\n"),
  )
  console.log("Created local Android release signing files under packages/android")
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}
