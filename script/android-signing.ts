import { randomBytes } from "crypto"
import fs from "fs/promises"
import path from "path"
import os from "os"

// V2 signing lives outside the worktree and never occupies the production key paths.
// Missing production or explicitly supplied signing files must be restored, not re-keyed.
export async function ensureAndroidSigning(root: string, applicationId: string) {
  const supplied = process.env["TANDEM_ANDROID_KEYSTORE_PROPERTIES"]
  if (supplied) {
    const properties = path.resolve(root, supplied)
    if (!(await exists(properties))) throw new Error(`Restore the supplied signing properties: ${properties}`)
    return properties
  }
  const directory = applicationId === "app.liddokun.tandem.v2"
    ? path.join(os.homedir(), ".local/share/tandem-v2/android-signing")
    : path.join(root, "packages/android")
  const keystore = path.join(directory, "release.keystore")
  const properties = path.join(directory, "keystore.properties")
  const hasKeystore = await exists(keystore)
  const hasProperties = await exists(properties)
  if (hasKeystore && hasProperties) return properties

  if (hasKeystore || hasProperties) {
    throw new Error(
      `Android release signing is incomplete. Restore the missing file; do not re-key an existing app:\n- ${keystore}\n- ${properties}`,
    )
  }

  if (applicationId !== "app.liddokun.tandem.v2") {
    throw new Error(`Restore the existing signing files for ${applicationId}; automatic key generation is V2-only.`)
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
    "tandem-v2-release",
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
    "CN=Tandem V2, O=Tandem, C=US",
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

  await fs.chmod(keystore, 0o600)
  await fs.writeFile(
    properties,
    [
      `storeFile=release.keystore`,
      `storePassword=${password}`,
      `keyAlias=tandem-v2-release`,
      `keyPassword=${password}`,
      "",
    ].join("\n"),
    { mode: 0o600 },
  )
  console.log(`Created isolated V2 Android signing files under ${directory}`)
  return properties
}

async function exists(file: string) {
  return fs
    .access(file)
    .then(() => true)
    .catch(() => false)
}
