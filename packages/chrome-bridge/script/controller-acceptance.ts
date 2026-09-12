import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { resolve } from "node:path"

const dirs = process.argv
  .slice(2)
  .filter((x) => x !== "--")
  .map((x) => resolve(x))
if (dirs.length !== 6 || new Set(dirs).size !== 6)
  throw new Error(
    "Usage: controller-acceptance.ts <core-a> <core-b> <core-c> <extended> <faults> <selection-first-browser>",
  )
const cwd = fileURLToPath(new URL("..", import.meta.url))
const results: { name: string; passed: boolean; detail: unknown }[] = []
for (const [name, args] of [
  ["typecheck", ["run", "typecheck"]],
  ["deterministic tests", ["run", "test"]],
  ["formatting", ["../../node_modules/prettier/bin/prettier.cjs", "--check", "."]],
  ["three core browser suites", ["script/controller-evidence.ts", ...dirs.slice(0, 3)]],
  ["extended user-tab suite", ["script/controller-evidence.ts", "--extended", dirs[3]!]],
  ["identity, faults and two-browser selection", ["script/controller-evidence.ts", "--probes", ...dirs.slice(4)]],
] as const) {
  const child = Bun.spawn([process.execPath, ...args], { cwd, stdout: "pipe", stderr: "pipe" })
  const [stdout, stderr, exit] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ])
  let detail: unknown = `${stdout}\n${stderr}`.trim()
  if (args[0] === "script/controller-evidence.ts" && stdout) {
    try {
      detail = JSON.parse(stdout)
    } catch {}
  }
  results.push({ name, passed: exit === 0, detail })
  console.error(`${exit === 0 ? "PASS" : "FAIL"} ${name}`)
}
const preparations = await Promise.all(
  dirs.slice(0, 3).map((dir) => readFile(`${dir}/preparation.json`, "utf8").then(JSON.parse)),
)
results.push({
  name: "DPR 1, DPR 2 and non-default browser zoom coverage",
  passed:
    preparations.some((p) => p.deviceScale === 1 && p.zoom === 1) &&
    preparations.some((p) => p.deviceScale === 2 && p.zoom === 1) &&
    preparations.some((p) => p.zoom !== 1 && p.zoom > 0),
  detail: preparations.map((p) => ({ runDir: p.runDir, deviceScale: p.deviceScale, zoom: p.zoom })),
})
const passed = results.every((x) => x.passed)
console.log(
  JSON.stringify(
    {
      phase2AcceptancePassed: passed,
      scope: "Original Phase 2 supported baseline, not OpenAI plugin parity or Phase 3 integration",
      limitations: [
        "Screenshot visual review is recorded separately in README",
        "Cleanup/disposal can change physical tab selection",
        "Unknown prior-host ownership preserves tabs and reports cleanup_unconfirmed",
        "Cross-origin/transformed frames and closed shadow roots are unsupported",
      ],
      checkedAt: new Date().toISOString(),
      results,
    },
    null,
    2,
  ),
)
if (!passed) process.exitCode = 1
