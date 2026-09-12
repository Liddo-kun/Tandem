import assert from "node:assert/strict"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { readFile, rm } from "node:fs/promises"

const root = fileURLToPath(new URL("../../..", import.meta.url))
const [runtime = "legacy", mode = "work", signal = "SIGTERM"] = process.argv.slice(2)
const directory = `/tmp/tandem/chrome-bridge/os-${Date.now()}`
for (const args of [
  [
    "packages/chrome-bridge/script/prepare.ts",
    "--run-dir",
    directory,
    "--extension",
    "/home/jon/.config/chromium/Profile 5/Extensions/hehggadaopoacecdllhhajmbjkdcmajg/1.26.901.11451_0",
    "--production-manifest",
    "/home/jon/.config/chromium/NativeMessagingHosts/com.openai.codexextension.json",
    "--screenshot-new-surface",
    "--no-sandbox",
    "--observer",
    "--display",
    ":96",
  ],
  ["packages/chrome-bridge/script/session-native-tap.ts", "--prepare", directory],
  ["packages/chrome-bridge/script/session-shutdown.ts", runtime, mode, signal, directory],
]) {
  const child = Bun.spawn([process.execPath, ...args], { cwd: root, stdout: "inherit", stderr: "inherit" })
  assert.equal(await child.exited, 0, `Failed ${args[0]}; evidence ${join(directory, "shutdown-server-error.log")}`)
}
const processes = JSON.parse(await readFile(join(directory, "shutdown-processes.json"), "utf8"))
assert(processes.serverExited && processes.browserExited && processes.nativeExited)
// Evidence and databases stay; each replay prepares fresh assets, not this stopped profile.
for (const file of ["host", "native-tap", "extension", "cache", "home/.config/chromium", "server-home/cache"])
  await rm(join(directory, file), { recursive: true, force: true })
