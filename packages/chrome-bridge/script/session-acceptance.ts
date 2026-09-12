import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { readFile, readdir, writeFile } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { privateDirectory } from "../src/client"

// Preparation (including the explicit native tap) must be done separately.
const selected = process.argv.find((arg) => arg.startsWith("--runtime="))?.slice("--runtime=".length)
assert(selected === undefined || selected === "legacy" || selected === "v2")
const dirs = process.argv
  .slice(2)
  .filter((arg) => arg !== "--" && !arg.startsWith("--runtime="))
  .map((arg) => resolve(arg))
assert(
  dirs.length === (selected ? 1 : 2) && new Set(dirs).size === dirs.length,
  "Usage: session-acceptance.ts <fresh-legacy-run> <fresh-v2-run> OR --runtime=legacy|v2 <fresh-run>",
)
process.umask(0o077)
const root = fileURLToPath(new URL("../../..", import.meta.url))
const failures: string[] = []
for (const [index, directory] of dirs.entries()) {
  await privateDirectory(directory)
  assert(directory.startsWith("/tmp/tandem/chrome-bridge/"))
  const preparation = JSON.parse(await readFile(join(directory, "preparation.json"), "utf8"))
  assert.equal(preparation.runDir, directory)
  assert(preparation.browser.args.includes("--enable-features=CDPScreenshotNewSurface"))
  await readFile(join(directory, "native-tap-preparation.json"))
  assert(
    !(await readdir(directory)).some((file) => file.startsWith("phase3-") || /^host-.*\.json$/.test(file)),
    "Use a fresh prepared browser",
  )
  const runtime: "legacy" | "v2" = selected ?? (index === 0 ? "legacy" : "v2")
  const browser = Bun.spawn(["/usr/bin/timeout", "--kill-after=5s", "600s", preparation.launcher], {
    stdout: Bun.file(join(directory, "phase3-browser.log")),
    stderr: Bun.file(join(directory, "phase3-browser-error.log")),
  })
  try {
    const deadline = Date.now() + 20000
    while (!(await readdir(directory)).some((name) => /^host-.*\.json$/.test(name))) {
      assert(Date.now() < deadline && browser.exitCode === null, "Prepared browser did not launch native host")
      await Bun.sleep(100)
    }
    const test: ReturnType<typeof Bun.spawn> = Bun.spawn(
      [
        "/usr/bin/timeout",
        "--kill-after=5s",
        "540s",
        process.execPath,
        "test",
        runtime === "legacy" ? "test/session/browser-live.test.ts" : "test/session-browser-live.test.ts",
        "--timeout",
        "480000",
      ],
      {
        cwd: join(root, "packages", runtime === "legacy" ? "opencode" : "core"),
        env: {
          PATH: process.env.PATH,
          HOME: preparation.home,
          TMPDIR: join(directory, "tmp"),
          LANG: "C.UTF-8",
          TANDEM_PROMPT_CORRECTOR: "false",
          TANDEM_PHASE3_RUN_DIR: directory,
          TANDEM_PHASE3_MODEL_PROVIDER: process.env.TANDEM_PHASE3_MODEL_PROVIDER,
          TANDEM_PHASE3_CASES: process.env.TANDEM_PHASE3_CASES,
        },
        stdout: Bun.file(join(directory, "phase3-test.log")),
        stderr: Bun.file(join(directory, "phase3-test-error.log")),
      },
    )
    assert.equal(await test.exited, 0, `${runtime} test failed; see ${directory}/phase3-test.log`)
    const report = JSON.parse(await readFile(join(directory, `phase3-${runtime}`, "report.json"), "utf8"))
    assert.equal(report.passed, true)
    if (!process.env.TANDEM_PHASE3_MODEL_PROVIDER) {
      const artifacts = join(directory, `phase3-${runtime}`)
      const scenarios = []
      for (const file of await readdir(artifacts)) {
        if (!/^(lifecycle-|concurrent-).*\.json$/.test(file)) continue
        const value = JSON.parse(await readFile(join(artifacts, file), "utf8"))
        assert.equal(value.passed, true)
        scenarios.push({
          file,
          name: value.name ?? file,
          passed: true,
          exit: value.exit,
          nativeCounts: value.counts,
          nativeCreateCount: value.nativeCreateCount,
        })
      }
      await writeFile(
        join(directory, "phase3-lifecycle-summary.json"),
        JSON.stringify(
          {
            runtime,
            passed: true,
            phase3Complete: false,
            scenarios,
            boundaries:
              runtime === "legacy"
                ? [
                    "SessionPrompt",
                    "SessionPrompt.cancel",
                    "InstanceStore.disposeDirectory",
                    "Session.fork",
                    "TaskTool foreground subagent",
                    "503 provider retry",
                  ]
                : [
                    "SessionRunner",
                    "SessionRunCoordinator.interrupt",
                    "SessionRunCoordinator scope close",
                    "separate Location graphs",
                    "exact durable prompt retry and coordinator join",
                  ],
            exclusions: [
              "V2 rejects duplicate provider input IDs before dispatch; legacy deduplicates the repeated delivery",
              "V2 SessionExecutionLocal routing and full serving-process signal shutdown are not exercised",
              "V2 exposes no transcript fork in this runtime fixture; task subagent and provider retry are legacy-only here",
              "No durable post-crash recovery",
            ],
          },
          null,
          2,
        ),
        { mode: 0o600 },
      )
    }
    console.log(
      `PASS ${runtime}: ${process.env.TANDEM_PHASE3_MODEL_PROVIDER ? "genuine-model" : "scripted-provider"} runtime, native counts, effects, persisted transcript and PNG`,
    )
  } catch (error) {
    failures.push(runtime)
    await writeFile(
      join(directory, "phase3-failure.json"),
      JSON.stringify({ runtime, passed: false, error: String(error) }),
      { mode: 0o600 },
    )
    console.error(`FAIL ${runtime}: ${String(error)}`)
  } finally {
    browser.kill("SIGTERM")
    const exitStatus = await browser.exited
    const nativeProcesses = await readFile(join(directory, "native-processes.json"), "utf8").then(
      (value) => JSON.parse(value),
      () => undefined,
    )
    const running = async (pid: number) => {
      const stat = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => "")
      return !!stat && !stat.slice(stat.lastIndexOf(")") + 2).startsWith("Z")
    }
    if (nativeProcesses)
      for (const pid of [nativeProcesses.tapPid, nativeProcesses.hostPid]) {
        const deadline = Date.now() + 5000
        while (await running(pid)) {
          assert(Date.now() < deadline, `Owned native process ${pid} did not exit with isolated Chromium`)
          await Bun.sleep(25)
        }
      }
    const unchanged =
      createHash("sha256")
        .update(await readFile(preparation.productionManifest.path))
        .digest("hex") === preparation.productionManifest.sha256
    await writeFile(
      join(directory, "phase3-process-report.json"),
      JSON.stringify({
        runtime,
        browserTimeoutPid: browser.pid,
        nativeProcesses,
        nativeProcessesExited: nativeProcesses ? true : undefined,
        browserExited: true,
        exitStatus,
        signal: browser.signalCode,
        productionManifestUnchanged: unchanged,
      }),
      { mode: 0o600 },
    )
    assert(unchanged, "Production registration changed")
  }
}
assert.deepEqual(failures, [], "Runtime acceptance failed; inspect each fresh run's phase3-failure.json and test logs")
