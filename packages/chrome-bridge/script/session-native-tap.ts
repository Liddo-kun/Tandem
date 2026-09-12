import assert from "node:assert/strict"
import { spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs"
import { readFile, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { Transform } from "node:stream"
import { fileURLToPath } from "node:url"
import { privateDirectory } from "../src/client"

// Opt-in test instrumentation. It forwards the original host's native bytes unchanged,
// recording method names/identities only, never page text, typed text or image payloads.
if (process.argv[2] === "--prepare") {
  const directory = resolve(process.argv[3] ?? "")
  assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
  await privateDirectory(directory)
  const preparation = JSON.parse(await readFile(join(directory, "preparation.json"), "utf8"))
  assert.equal(preparation.runDir, directory)
  assert.equal(hash(await readFile(preparation.hostExecutable)), preparation.hostSha256)
  const manifest = JSON.parse(await readFile(preparation.nativeManifest, "utf8"))
  assert.equal(manifest.path, preparation.hostLauncher)
  assert(resolve(preparation.nativeManifest).startsWith(`${directory}/home/`))
  const executable = join(directory, "native-tap")
  const child = Bun.spawn(
    [process.execPath, "build", fileURLToPath(import.meta.url), "--compile", "--outfile", executable],
    { stdout: "ignore", stderr: "inherit" },
  )
  assert.equal(await child.exited, 0)
  await writeFile(
    join(directory, "native-tap-preparation.json"),
    JSON.stringify(
      {
        executable,
        sha256: hash(await readFile(executable)),
        originalHost: preparation.hostExecutable,
        originalHostSha256: preparation.hostSha256,
        scope: "test-only native outbound frame observer; one extra parent process",
      },
      null,
      2,
    ),
    { flag: "wx", mode: 0o600 },
  )
  await writeFile(preparation.nativeManifest, JSON.stringify({ ...manifest, path: executable }, null, 2), {
    mode: 0o600,
  })
  assert.equal(hash(await readFile(preparation.productionManifest.path)), preparation.productionManifest.sha256)
} else {
  const directory = process.env.TANDEM_CHROME_BRIDGE_RUN_DIR
  assert(directory)
  assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
  const preparation = JSON.parse(await readFile(join(directory, "preparation.json"), "utf8"))
  const child = spawn(preparation.hostExecutable, process.argv.slice(2), { stdio: ["pipe", "pipe", "pipe"] })
  writeFileSync(join(directory, "native-processes.json"), JSON.stringify({ tapPid: process.pid, hostPid: child.pid }), {
    mode: 0o600,
  })
  let pending = Buffer.alloc(0)
  let dropID: unknown
  let injected = false
  const tap = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        pending = Buffer.concat([pending, chunk])
        while (pending.length >= 4) {
          const size = pending.readUInt32LE(0)
          assert(size <= 1024 * 1024)
          if (pending.length < size + 4) break
          const message = JSON.parse(pending.subarray(4, size + 4).toString())
          pending = pending.subarray(size + 4)
          if (typeof message.method === "string")
            appendFileSync(
              join(directory, "native-dispatch.jsonl"),
              JSON.stringify({
                method: message.method,
                cdp: message.method === "executeCdp" ? message.params?.method : undefined,
                inputType: message.params?.commandParams?.type,
                session: message.params?.session_id,
                turn: message.params?.turn_id,
              }) + "\n",
              { mode: 0o600 },
            )
          const faultPath = join(directory, "native-fault.json")
          if (!injected && existsSync(faultPath) && message.method === "executeCdp") {
            const fault = JSON.parse(readFileSync(faultPath, "utf8"))
            if (message.params?.method === fault.cdp && message.params?.commandParams?.type === fault.inputType) {
              injected = true
              dropID = message.id
              writeFileSync(
                join(directory, "native-fault-consumed.json"),
                JSON.stringify({ cdp: fault.cdp, inputType: fault.inputType, oneResponseOnly: true }),
                { mode: 0o600 },
              )
            }
          }
        }
        callback(null, chunk)
      } catch (error) {
        callback(error instanceof Error ? error : new Error("Native tap failed"))
      }
    },
  })
  let incoming = Buffer.alloc(0)
  const fault = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      try {
        incoming = Buffer.concat([incoming, chunk])
        while (incoming.length >= 4) {
          const size = incoming.readUInt32LE(0)
          assert(size <= 64 * 1024 * 1024)
          if (incoming.length < size + 4) break
          const frame = incoming.subarray(0, size + 4)
          const message = JSON.parse(frame.subarray(4).toString())
          incoming = incoming.subarray(size + 4)
          if (dropID !== undefined && message.id === dropID && !message.method) {
            dropID = undefined
            writeFileSync(
              join(directory, "native-fault-dropped.json"),
              JSON.stringify({ responseDropped: true, nativeReplyWasError: !!message.error }),
              { mode: 0o600 },
            )
          } else this.push(frame)
        }
        callback()
      } catch (error) {
        callback(error instanceof Error ? error : new Error("Native fault tap failed"))
      }
    },
  })
  process.stdin.pipe(fault).pipe(child.stdin)
  child.stdout.pipe(tap).pipe(process.stdout)
  child.stderr.pipe(process.stderr)
  tap.on("error", () => child.kill("SIGTERM"))
  fault.on("error", () => child.kill("SIGTERM"))
  for (const signal of ["SIGTERM", "SIGINT"] as const) process.on(signal, () => child.kill(signal))
  child.on("close", (code) => {
    process.exitCode = code ?? 1
    process.stdin.destroy()
  })
}

function hash(bytes: Buffer) {
  return createHash("sha256").update(bytes).digest("hex")
}
