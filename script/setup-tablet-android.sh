#!/usr/bin/env bash
# Idempotent setup of the Android/Tauri build toolchain inside the aarch64 Ubuntu
# userland on the Y700. Google ships no arm64-Linux NDK/SDK build-tools,
# so this sources community arm64 builds. Details: notes/tandem-setup.md.
#
# Usage:   bash script/setup-tablet-android.sh
# Agents:  SUDO_PASSWORD=<pw> bash script/setup-tablet-android.sh   (non-interactive sudo)
set -euo pipefail

NDK_VERSION="29.0.14206865"
NDK_URL="https://github.com/lzhiyong/termux-ndk/releases/download/android-ndk/android-ndk-r29-aarch64.7z"
SDK_URL="https://github.com/lzhiyong/termux-ndk/releases/download/android-sdk/android-sdk-aarch64.7z"
BT_URL="https://github.com/Commit451/android-arm-build-tools/releases/download/platform-tools-36.0.0/android-build-tools-36.0.0-linux-arm64-20260522.tar.xz"
SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/Android/Sdk}}"
mkdir -p /tmp/tandem/v2/tmp
export TMPDIR=/tmp/tandem/v2/tmp
export XDG_CACHE_HOME=/tmp/tandem/v2/cache
WORK="$(mktemp -d /tmp/tandem/v2/android-setup.XXXXXX)"
trap 'rm -rf "$WORK"' EXIT

[ "$(uname -m)" = "aarch64" ] || { echo "ERROR: aarch64 Linux only (this host: $(uname -m))." >&2; exit 1; }
log(){ printf '\n== %s ==\n' "$*"; }
SUDO(){ if [ -n "${SUDO_PASSWORD:-}" ]; then echo "$SUDO_PASSWORD" | sudo -S -p '' "$@"; else sudo "$@"; fi; }

# 1. apt packages (JDK for AGP, host C toolchain for Rust build scripts, 7z/python helpers)
need=()
command -v javac     >/dev/null || need+=(openjdk-17-jdk-headless)
command -v gcc       >/dev/null || need+=(build-essential)
command -v pkg-config >/dev/null || need+=(pkg-config)
command -v 7z        >/dev/null || need+=(p7zip-full)
command -v python    >/dev/null || need+=(python-is-python3)
if [ ${#need[@]} -gt 0 ]; then
  log "apt install: ${need[*]}"
  SUDO apt-get update -qq
  SUDO env DEBIAN_FRONTEND=noninteractive apt-get install -y -qq "${need[@]}"
fi

# 2. Rust (rustup) + Android target; cargo cross-compiles via the NDK clang linker
if [ ! -x "$HOME/.cargo/bin/cargo" ] && ! command -v cargo >/dev/null; then
  log "install rustup (stable, minimal)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal --default-toolchain stable
fi
export PATH="$HOME/.cargo/bin:$PATH"
log "rust target aarch64-linux-android"
rustup target add aarch64-linux-android >/dev/null

# 3. NDK r29 — clang/lld are statically musl-linked, so they run in the glibc chroot
if [ ! -d "$SDK/ndk/$NDK_VERSION" ]; then
  log "download + extract NDK r29 (aarch64)"
  curl -fsSL --retry 3 -o "$WORK/ndk.7z" "$NDK_URL"
  7z x -bso0 -bsp0 -o"$WORK/ndk" "$WORK/ndk.7z"
  mkdir -p "$SDK/ndk"
  mv "$WORK/ndk/android-ndk-r29" "$SDK/ndk/$NDK_VERSION"
fi

# 4. SDK base: cmdline-tools (sdkmanager), platforms android-35/36, platform-tools, cmake, build-tools
if [ ! -d "$SDK/cmdline-tools/latest" ]; then
  log "download + extract SDK base (aarch64)"
  curl -fsSL --retry 3 -o "$WORK/sdk.7z" "$SDK_URL"
  7z x -bso0 -bsp0 -o"$WORK/sdk" "$WORK/sdk.7z"
  mkdir -p "$SDK"
  cp -a "$WORK/sdk/android-sdk/." "$SDK/"
fi

# 5. Replace bionic native build-tools binaries with glibc arm64 ones (aapt2/aidl/zipalign/split-select).
#    d8/apksigner are Java wrappers and need no change.
glibc_ok=0
if [ -x "$SDK/build-tools/36.0.0/aapt2" ] && readelf -l "$SDK/build-tools/36.0.0/aapt2" 2>/dev/null | grep -q 'ld-linux-aarch64'; then
  glibc_ok=1
fi
if [ "$glibc_ok" -ne 1 ]; then
  log "overlay glibc build-tools binaries (35.0.0 + 36.0.0)"
  curl -fsSL --retry 3 -o "$WORK/bt.tar.xz" "$BT_URL"
  mkdir -p "$WORK/bt"; tar -xJf "$WORK/bt.tar.xz" -C "$WORK/bt"
  for ver in 35.0.0 36.0.0; do
    [ -d "$SDK/build-tools/$ver" ] || cp -a "$SDK/build-tools/35.0.0" "$SDK/build-tools/$ver"
    for t in aapt2 aidl zipalign split-select; do
      install -m 755 "$WORK/bt/$t" "$SDK/build-tools/$ver/$t"
    done
    sed -i "s/^Pkg.Revision=.*/Pkg.Revision=$ver/" "$SDK/build-tools/$ver/source.properties" 2>/dev/null || true
  done
fi

# The V2 build script loads its own environment. Do not rewrite the daily shell profile.
# SDK platform-tools/adb is bionic; use the installed glibc /usr/bin/adb.

log "done"
echo "Toolchain ready under $SDK."
echo "Build with: bun run tandem:tablet"
