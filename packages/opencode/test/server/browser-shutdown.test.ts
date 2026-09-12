import { expect } from "bun:test"
import { Effect, Layer } from "effect"
import { fileURLToPath } from "node:url"
import { testEffect } from "../lib/effect"

const it = testEffect(Layer.empty)
const native = process.env.TANDEM_SHUTDOWN_NATIVE === "1" ? it.live : it.live.skip
const root = fileURLToPath(new URL("../../../..", import.meta.url))

// Requires the explicitly isolated Xvfb :96. Each case prepares its own native
// host/profile, starts a real production CLI, and signals only that owned PID.
for (const runtime of ["legacy", "v2"])
  for (const mode of ["work", "permission", "keep", "uncertain"])
    for (const signal of ["SIGTERM", "SIGINT"])
      native(
        `${runtime} ${mode} awaits native shutdown on ${signal}`,
        () =>
          Effect.gen(function* () {
            const child = Bun.spawn(
              [process.execPath, "packages/chrome-bridge/script/shutdown-acceptance.ts", runtime, mode, signal],
              {
                cwd: root,
                stdout: Bun.file(`/tmp/tandem/shutdown-${runtime}-${mode}-${signal}.log`),
                stderr: Bun.file(`/tmp/tandem/shutdown-${runtime}-${mode}-${signal}-error.log`),
              },
            )
            const code = yield* Effect.promise(() => child.exited)
            expect(code).toBe(0)
          }),
        180000,
      )
