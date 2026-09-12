import { describe, expect, test } from "bun:test"
import { validateProcessTrace, type TraceValidationInput } from "../script/evidence"

const input: TraceValidationInput = {
  runDir: "/tmp/tandem/chrome-bridge/run-1",
  nativeManifest:
    "/tmp/tandem/chrome-bridge/run-1/home/.config/chromium/NativeMessagingHosts/com.openai.codexextension.json",
  productionManifest: "/home/jon/.config/chromium/NativeMessagingHosts/com.openai.codexextension.json",
  productionHostTarget: "/home/jon/.local/share/chrome-standalone/native-host",
  extensionPath: "/tmp/tandem/chrome-bridge/run-1/extension",
  browserExecutable: "/usr/lib/chromium/chromium",
  browserPID: 100,
  hostLauncher: "/tmp/tandem/chrome-bridge/run-1/native-host",
  hostExecutable: "/tmp/tandem/chrome-bridge/run-1/host",
  hostPID: 200,
  originalHome: "/home/jon",
}

describe("process trace evidence", () => {
  test("accepts exact successful provenance including a resumed open", () => {
    const trace = [
      `100 execve("${input.browserExecutable}", ["chromium"], []) = 0`,
      `100 openat(AT_FDCWD, "${input.nativeManifest}", O_RDONLY <unfinished ...>`,
      "100 <... openat resumed>) = 17",
      `200 execve("${input.hostLauncher}", ["native-host"], []) = 0`,
      '200 execve("/usr/bin/env", ["env"], []) = 0',
      `200 execve("${input.hostExecutable}", ["host"], []) = 0`,
      '201 execve("/usr/lib/chromium/chrome_crashpad_handler", ["crashpad"], []) = 0',
      "200 +++ exited with 0 +++",
      "100 +++ exited with 0 +++",
    ].join("\n")
    const result = validateProcessTrace(trace, input)
    expect(result.passed).toBe(true)
    expect(result.status).toBe("verified")
    expect(result.observed.nativeManifestOpened).toBe(true)
  })

  test("rejects forbidden access and an unapproved successful executable", () => {
    const trace = [
      `100 execve("${input.browserExecutable}", [], []) = 0`,
      `100 openat(AT_FDCWD, "${input.nativeManifest}", O_RDONLY) = 3`,
      `200 execve("${input.hostLauncher}", [], []) = 0`,
      `200 execve("${input.hostExecutable}", [], []) = 0`,
      '200 openat(AT_FDCWD, "/home/jon/.codex/auth.json", O_RDONLY) = -1 ENOENT',
      '200 execve("/opt/original/browser-service.mjs", [], []) = 0',
      "200 +++ exited with 0 +++",
      "100 +++ exited with 0 +++",
    ].join("\n")
    const result = validateProcessTrace(trace, input)
    expect(result.passed).toBe(false)
    expect(result.failures).toContain("attempted access to an original runtime/config path: /home/jon/.codex/auth.json")
    expect(result.failures).toContain("unapproved successful executable: /opt/original/browser-service.mjs")
  })

  test("rejects a successfully opened production registry", () => {
    const trace = validTrace().replace(
      "100 +++ exited",
      `100 openat(AT_FDCWD, "${input.productionManifest}", O_RDONLY) = 9\n100 +++ exited`,
    )
    expect(validateProcessTrace(trace, input).failures).toContain(
      "production native registry manifest was opened successfully",
    )
  })

  test("does not accept malformed or mismatched provenance", () => {
    const malformed = 'garbage\n100 execve("/usr/lib/chromium/chromium", [], []) = ?\n100 +++ exited with 0 +++'
    expect(validateProcessTrace(malformed, input).passed).toBe(false)

    const wrongPIDs = validTrace()
      .replace(/^100 execve/, "999 execve")
      .replace(/^200 execve/m, "888 execve")
    const result = validateProcessTrace(wrongPIDs, input)
    expect(result.failures).toContain("browser executable PID does not match smoke provenance")
    expect(result.failures).toContain("host launcher PID does not match smoke provenance")
  })

  test("allows extension identity assets containing codex names", () => {
    const trace = `${validTrace()}\n100 openat(AT_FDCWD, "${input.extensionPath}/com.openai.codexextension.json", O_RDONLY) = 4`
    expect(validateProcessTrace(trace, input).passed).toBe(true)
  })
})

function validTrace() {
  return [
    `100 execve("${input.browserExecutable}", [], []) = 0`,
    `100 openat(AT_FDCWD, "${input.nativeManifest}", O_RDONLY) = 3`,
    `200 execve("${input.hostLauncher}", [], []) = 0`,
    `200 execve("${input.hostExecutable}", [], []) = 0`,
    "200 +++ exited with 0 +++",
    "100 +++ exited with 0 +++",
  ].join("\n")
}
