import { createHash, randomUUID } from "node:crypto"
import { constants } from "node:fs"
import { access, lstat, mkdir, open, readFile, rename, unlink } from "node:fs/promises"
import { dirname, isAbsolute, join } from "node:path"
import { connect, EXTENSION_ORIGIN, HOST_NAME, privateDirectory } from "./client"
import { BrowserError } from "./errors"

export type Installation = {
  root: string
  manifest: string
  binary: string
  id: string
  label: string
}
type Saved = {
  version: 1
  manifest: string
  previous: string | null
  registration: string
  environment: string
  executable: string
  digest: string
  id: string
  label: string
}
const hash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex")
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`

async function read(path: string): Promise<string | null> {
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK).catch((error) => {
    if (error.code === "ENOENT") return undefined
    throw error
  })
  if (!file) return null
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size > 128 * 1024 || info.nlink !== 1) throw new Error(`Unsafe file: ${path}`)
    return await file.readFile("utf8")
  } finally {
    await file.close()
  }
}
async function atomic(path: string, value: string | Uint8Array, mode = 0o600) {
  const temporary = `${path}.${randomUUID()}.new`
  const file = await open(temporary, "wx", mode)
  try {
    await file.writeFile(value)
    await file.sync()
  } finally {
    await file.close()
  }
  await rename(temporary, path)
  const directory = await open(dirname(path), "r")
  try {
    await directory.sync()
  } finally {
    await directory.close()
  }
}
async function locked<T>(root: string, action: () => Promise<T>) {
  if (process.platform !== "linux") throw new Error("Only Linux native messaging installation is supported")
  if (!isAbsolute(root)) throw new Error("Installation root must be absolute")
  await mkdir(root, { recursive: true, mode: 0o700 })
  await privateDirectory(root)
  const path = join(root, "install.lock")
  const lock = await open(path, "wx", 0o600).catch(() => {
    throw new Error("Installation locked; verify the installer has exited before manually removing install.lock")
  })
  try {
    return await action()
  } finally {
    await lock.close()
    await unlink(path)
  }
}

export async function install(options: Installation) {
  return locked(options.root, async () => {
    if (!isAbsolute(options.manifest) || !isAbsolute(options.binary)) throw new Error("Paths must be absolute")
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(options.id) || !options.label || options.label.length > 128)
      throw new Error("Invalid browser binding")
    const runtime = join(options.root, "ipc")
    if (Buffer.byteLength(join(runtime, `host-${randomUUID()}.sock`)) > 103)
      throw new Error("Installation path is too long for Unix sockets")
    await mkdir(runtime, { mode: 0o700, recursive: true })
    await privateDirectory(runtime)
    const source = await lstat(options.binary)
    if (!source.isFile()) throw new Error("Host must be a regular executable")
    await access(options.binary, constants.X_OK)
    const bytes = await readFile(options.binary)
    const digest = hash(bytes)
    const executable = join(options.root, `host-${digest}`)
    // Content-addressed binaries are never overwritten, including while running.
    const existing = await lstat(executable).catch((error) => {
      if (error.code !== "ENOENT") throw error
    })
    if (existing) {
      if (!existing.isFile() || existing.nlink !== 1 || hash(await readFile(executable)) !== digest)
        throw new Error("Installed host has changed")
      await access(executable, constants.X_OK)
    } else {
      await atomic(executable, bytes, 0o700)
    }
    const launcher = join(options.root, `launch-${digest}`)
    const launch = `#!/bin/sh\nexport TANDEM_CHROME_BRIDGE_RUN_DIR=${quote(runtime)}\nexec ${quote(executable)} "$@"\n`
    const oldLaunch = await read(launcher)
    if (oldLaunch !== null && oldLaunch !== launch) throw new Error("Installed launcher has changed")
    if (oldLaunch === null) await atomic(launcher, launch, 0o700)
    await access(launcher, constants.X_OK)
    const registration =
      JSON.stringify(
        {
          name: HOST_NAME,
          description: "Tandem Chrome bridge",
          path: launcher,
          type: "stdio",
          allowed_origins: [EXTENSION_ORIGIN],
        },
        null,
        2,
      ) + "\n"
    const environment = `export TANDEM_CHROME_CONNECTIONS=${quote(JSON.stringify([{ id: options.id, label: options.label, directory: runtime, screenshotVerified: false }]))}\n`
    const statePath = join(options.root, "installation.json")
    const state = await read(statePath)
    const current = await read(options.manifest)
    const saved: Saved = state
      ? JSON.parse(state)
      : {
          version: 1,
          manifest: options.manifest,
          previous: current,
          registration,
          environment,
          executable,
          digest,
          id: options.id,
          label: options.label,
        }
    if (
      saved.version !== 1 ||
      saved.manifest !== options.manifest ||
      saved.registration !== registration ||
      saved.environment !== environment
    )
      throw new Error("Different installation or binding; restore it before installing another version")
    if (current !== saved.previous && current !== registration)
      throw new Error("Registration changed by another installer")
    const envPath = join(options.root, "connections.sh")
    const oldEnv = await read(envPath)
    if (oldEnv !== null && oldEnv !== environment)
      throw new Error("Connection configuration changed; preserve it manually")
    // Durable rollback record precedes either externally visible change. A retry
    // accepts only the original or our exact replacement after interruption.
    if (!state) await atomic(statePath, JSON.stringify(saved, null, 2) + "\n")
    await mkdir(dirname(options.manifest), { recursive: true, mode: 0o700 })
    if (oldEnv === null) await atomic(envPath, environment)
    if ((await read(options.manifest)) !== current) throw new Error("Registration changed during installation")
    if (current !== registration) await atomic(options.manifest, registration)
    return {
      state: "pending_activation",
      environment: envPath,
      executable,
      digest,
      capture: "unverified",
      note: "Source connections.sh in the intended server environment. Verify extension-launched host and server browser status before declaring activation.",
    }
  })
}

export async function restore(root: string) {
  return locked(root, async () => {
    const raw = await read(join(root, "installation.json"))
    if (!raw) throw new Error("No saved installation")
    const saved: Saved = JSON.parse(raw)
    const current = await read(saved.manifest)
    if (current !== saved.registration && current !== saved.previous)
      throw new Error("Registration changed by another installer; refusing restore")
    if (saved.previous !== null) {
      const target = JSON.parse(saved.previous).path
      if (typeof target !== "string" || !isAbsolute(target))
        throw new Error("Saved registration has no absolute target")
      await access(target, constants.X_OK).catch(() => {
        throw new Error("Saved host executable is missing or not executable")
      })
    }
    if ((await read(saved.manifest)) !== current) throw new Error("Registration changed during restore")
    if (current === saved.registration) {
      if (saved.previous === null) await unlink(saved.manifest)
      else await atomic(saved.manifest, saved.previous)
    }
    return {
      state: "restored",
      note: "Restart only with approval. Remove the connections.sh sourcing from the server launcher. All binaries, configuration, backups and journals are retained.",
    }
  })
}

export async function status(root: string) {
  await privateDirectory(root)
  const raw = await read(join(root, "installation.json"))
  if (!raw) return { state: "not_installed" }
  const saved: Saved = JSON.parse(raw)
  const baseline = {
    binding: { id: saved.id, label: saved.label, profileIdentity: "unverified" },
    hostDigest: saved.digest,
    capture: "unverified: requires a measured PNG check with the intended browser launch",
    server: "verify through the intended Tandem server browser tool",
  }
  const registration = await read(saved.manifest)
  if (registration === saved.previous) return { ...baseline, state: "restored" }
  if (registration !== saved.registration) return { ...baseline, state: "wrong_registration" }
  if (!(await Bun.file(saved.executable).exists())) return { ...baseline, state: "missing_host" }
  const launcher = JSON.parse(saved.registration).path
  try {
    await access(saved.executable, constants.X_OK)
    await access(launcher, constants.X_OK)
  } catch {
    return { ...baseline, state: "missing_host" }
  }
  if (hash(await readFile(saved.executable)) !== saved.digest) return { ...baseline, state: "host_changed" }
  try {
    const bridge = await connect(join(root, "ipc"))
    try {
      if (bridge.discovery.executable !== saved.executable)
        return { ...baseline, state: "pending_activation", reason: "Connected host is not the installed executable" }
      const transport = await bridge.status()
      const info = transport.recovery === "ready" ? await bridge.call<{ version?: string }>("getInfo", {}) : undefined
      return {
        ...baseline,
        state: transport.recovery === "ready" ? "host_connected" : transport.recovery,
        protocol: transport.version,
        extensionVersion: info?.version ?? "unknown",
        pid: transport.pid,
      }
    } finally {
      bridge.close()
    }
  } catch (error) {
    return { ...baseline, state: error instanceof BrowserError ? error.code : "pending_activation" }
  }
}
