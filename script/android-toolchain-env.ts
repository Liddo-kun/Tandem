import { existsSync, readdirSync } from "node:fs"
import os from "node:os"
import path from "node:path"

// Populate process.env with the on-tablet (aarch64 chroot) Android/Tauri toolchain so
// build steps work in any shell, even when /etc/profile.d/50-android.sh was not sourced
// (e.g. a non-login shell, or a long-lived server process started before setup ran).
//
// No-op off aarch64 Linux, or when ~/Android/Sdk is absent, so Windows/macOS release
// runs keep their own toolchain env untouched. See packages/android/apkbuildontablet.md.
//
// Note: Bun.which() snapshots PATH at startup, so callers that gate on a command must pass
// the live PATH, e.g. Bun.which(cmd, { PATH: process.env.PATH }).
export function loadAndroidToolchainEnv() {
  if (process.platform !== "linux" || process.arch !== "arm64") return

  const sdk = process.env["ANDROID_HOME"] ?? path.join(os.homedir(), "Android/Sdk")
  if (!existsSync(sdk)) return
  process.env["ANDROID_HOME"] = sdk
  process.env["ANDROID_SDK_ROOT"] = sdk

  const ndkRoot = path.join(sdk, "ndk")
  if (!process.env["NDK_HOME"] && existsSync(ndkRoot)) {
    const latest = readdirSync(ndkRoot).sort().at(-1)
    if (latest) process.env["NDK_HOME"] = path.join(ndkRoot, latest)
  }
  if (process.env["NDK_HOME"]) process.env["ANDROID_NDK_HOME"] = process.env["NDK_HOME"]

  const java = "/usr/lib/jvm/java-17-openjdk-arm64"
  if (!process.env["JAVA_HOME"] && existsSync(java)) process.env["JAVA_HOME"] = java

  const prepend = [
    path.join(os.homedir(), ".cargo/bin"),
    process.env["JAVA_HOME"] ? path.join(process.env["JAVA_HOME"], "bin") : "",
    path.join(sdk, "cmdline-tools/latest/bin"),
  ].filter((dir) => dir && existsSync(dir))
  process.env["PATH"] = [...prepend, process.env["PATH"]].filter(Boolean).join(path.delimiter)
}
