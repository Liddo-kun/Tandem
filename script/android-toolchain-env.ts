// Tandem-owned (not in upstream): tablet Android toolchain environment and runnable SDK tools.
import { existsSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// Populate process.env with the on-tablet (aarch64 chroot) Android/Tauri toolchain so
// build steps work in any shell, even when /etc/profile.d/50-android.sh was not sourced
// (e.g. a non-login shell, or a long-lived server process started before setup ran).
//
// No-op off aarch64 Linux, or when ~/Android/Sdk is absent, so Windows/macOS release
// runs keep their own toolchain env untouched. See script/tablet-android.md.
//
// Note: Bun.which() snapshots PATH at startup, so callers that gate on a command must pass
// the live PATH, e.g. Bun.which(cmd, { PATH: process.env.PATH }).
export function loadAndroidToolchainEnv() {
  if (process.platform !== "linux" || process.arch !== "arm64") return

  const sdk = process.env["ANDROID_HOME"] ?? process.env["ANDROID_SDK_ROOT"] ?? path.join(os.homedir(), "Android/Sdk")
  if (!existsSync(sdk)) return
  process.env["ANDROID_HOME"] = sdk
  process.env["ANDROID_SDK_ROOT"] = sdk

  const ndkRoot = path.join(sdk, "ndk")
  if (!process.env["NDK_HOME"] && existsSync(ndkRoot)) {
    const latest = readdirSync(ndkRoot).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).at(-1)
    if (latest) process.env["NDK_HOME"] = path.join(ndkRoot, latest)
  }
  if (process.env["NDK_HOME"]) process.env["ANDROID_NDK_HOME"] = process.env["NDK_HOME"]

  const java = "/usr/lib/jvm/java-17-openjdk-arm64"
  if (!process.env["JAVA_HOME"] && existsSync(java)) process.env["JAVA_HOME"] = java

  const prepend = [
    path.dirname(process.execPath),
    path.join(os.homedir(), ".cargo/bin"),
    process.env["JAVA_HOME"] ? path.join(process.env["JAVA_HOME"], "bin") : "",
    path.join(sdk, "cmdline-tools/latest/bin"),
  ].filter((dir) => dir && existsSync(dir))
  process.env["PATH"] = [...prepend, process.env["PATH"]].filter(Boolean).join(path.delimiter)
}

export function findAndroidAapt2(sdk: string, options?: { order?: "lexical" | "numeric-descending"; missing?: "throw" }) {
  const dir = path.join(sdk, "build-tools")
  if (options?.missing !== "throw" && !existsSync(dir)) return
  const candidates = options?.order === "lexical"
    ? [...new Bun.Glob("*/aapt2").scanSync({ cwd: dir, absolute: true })].sort().reverse()
    : (options?.order === "numeric-descending"
        ? readdirSync(dir).sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
        : readdirSync(dir).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).reverse())
        .map((version) => path.join(dir, version, "aapt2"))
  return candidates.find((candidate) => {
    if (!existsSync(candidate)) return false
    // AGP can install x86_64 tools beside the tablet's glibc ARM64 binaries.
    try {
      return Bun.spawnSync([candidate, "version"], { stdout: "ignore", stderr: "ignore" }).exitCode === 0
    } catch {
      return false
    }
  })
}
