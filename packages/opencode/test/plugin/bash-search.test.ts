import { afterEach, describe, expect, test } from "bun:test"
import path from "path"
import fs from "fs/promises"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { BashSearch } from "@/plugin/bash-search/bash-search"
import { ToolRegistry } from "@/tool/registry"
import { Agent } from "@/agent/agent"
import { Config } from "@/config/config"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { InstanceState } from "@/effect/instance-state"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"
import { disposeAllInstances, tmpdir } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { TestConfig } from "../fixture/config"

// Tandem-only claude bash-search (TANDEM_CLAUDE_BASH_SEARCH): grep/find PATH shims
// plus Glob/Grep removal for Claude models. See notes/plan-bash-search.md.

const FLAG = "TANDEM_CLAUDE_BASH_SEARCH"
const savedFlag = process.env[FLAG]
// Real binaries when installed (`apt install ugrep bfs`); execution tests skip otherwise.
const bins = BashSearch.resolveBinaries()

afterEach(() => {
  if (savedFlag === undefined) delete process.env[FLAG]
  else process.env[FLAG] = savedFlag
  BashSearch.deactivate()
})

describe("bash-search gate", () => {
  test("flag off means inactive regardless of binaries", async () => {
    delete process.env[FLAG]
    expect(BashSearch.enabledByFlag()).toBe(false)
    expect(await BashSearch.activate()).toBeUndefined()
    expect(BashSearch.isActive()).toBe(false)
  })

  test("missing binaries mean no resolution", () => {
    expect(BashSearch.resolveBinaries({ PATH: "/nonexistent-tandem-test" })).toBeUndefined()
  })

  test.if(!!bins)("flag on with binaries activates and is idempotent", async () => {
    process.env[FLAG] = "1"
    const dir = await BashSearch.activate()
    expect(dir).toBeDefined()
    expect(BashSearch.isActive()).toBe(true)
    expect(await BashSearch.activate()).toBe(dir!)
  })

  test("stripSearchBullets removes only the glob/grep bullets", () => {
    const description = [
      "IMPORTANT: This tool is for terminal operations like git, npm, docker, etc.",
      "- File search: use Glob instead of shell directory traversal",
      "- Content search: use Grep instead of shell search commands",
      "- Read files: use Read instead of shell commands that print file contents",
      "- Communication: respond directly instead of using shell commands to print messages",
    ].join("\n")
    const stripped = BashSearch.stripSearchBullets(description)
    expect(stripped).not.toContain("use Glob")
    expect(stripped).not.toContain("use Grep")
    expect(stripped).toContain("use Read")
    expect(stripped).toContain("Communication: respond directly")
  })
})

describe("bash-search shims", () => {
  test("shim generation bakes absolute paths and sets the executable bit", async () => {
    await using tmp = await tmpdir()
    const fake = { ugrep: "/fake/ugrep", bfs: "/fake/bfs", grep: "/fake/grep" }
    const dir = path.join(tmp.path, "shims")
    await BashSearch.writeShims(dir, fake)
    for (const [name, bin] of [
      ["grep", fake.ugrep],
      ["find", fake.bfs],
    ] as const) {
      const file = path.join(dir, name)
      const stat = await fs.stat(file)
      expect(stat.mode & 0o111).toBe(0o111)
      const content = await fs.readFile(file, "utf8")
      expect(content).toStartWith("#!/bin/sh")
      expect(content).toContain(JSON.stringify(bin))
    }
    // The fallback path in the grep shim points at the real grep.
    expect(await fs.readFile(path.join(dir, "grep"), "utf8")).toContain(JSON.stringify(fake.grep))
  })

  test.if(!!bins)("grep shim runs ugrep with CC defaults (ignore files, hidden, no .git)", async () => {
    await using tmp = await tmpdir()
    const shims = path.join(tmp.path, "shims")
    await BashSearch.writeShims(shims, bins!)

    const version = Bun.spawnSync([path.join(shims, "grep"), "--version"])
    expect(version.exitCode).toBe(0)
    expect(version.stdout.toString()).toContain("ugrep")

    await Bun.write(path.join(tmp.path, "a.txt"), "hello world\n")
    await Bun.write(path.join(tmp.path, "b.txt"), "hello ignored\n")
    await Bun.write(path.join(tmp.path, ".gitignore"), "b.txt\n")
    await Bun.write(path.join(tmp.path, ".hidden.txt"), "hello hidden\n")
    const search = Bun.spawnSync([path.join(shims, "grep"), "-r", "-l", "hello", "."], { cwd: tmp.path })
    expect(search.exitCode).toBe(0)
    const found = search.stdout.toString().trim().split("\n").toSorted()
    expect(found).toEqual([".hidden.txt", "a.txt"])
  })

  test.if(!!bins)("grep shim falls back to the real grep on incompatible flags", async () => {
    await using tmp = await tmpdir()
    const shims = path.join(tmp.path, "shims")
    await BashSearch.writeShims(shims, bins!)
    await Bun.write(path.join(tmp.path, "a.txt"), "hello world\n")
    // -lZ matches the fallback pattern list (`-[!-]*[Zz]*`); GNU grep prints the
    // filename NUL-terminated, which ugrep's -Z (fuzzy search) would not.
    const result = Bun.spawnSync([path.join(shims, "grep"), "-lZ", "hello", "a.txt"], { cwd: tmp.path })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString()).toBe("a.txt\u0000")
  })

  test.if(!!bins)("find shim runs bfs", async () => {
    await using tmp = await tmpdir()
    const shims = path.join(tmp.path, "shims")
    await BashSearch.writeShims(shims, bins!)

    const version = Bun.spawnSync([path.join(shims, "find"), "--version"])
    expect(version.exitCode).toBe(0)
    expect(version.stdout.toString()).toContain("bfs")

    await Bun.write(path.join(tmp.path, "dir", "a.txt"), "x")
    const result = Bun.spawnSync([path.join(shims, "find"), ".", "-name", "a.txt"], { cwd: tmp.path })
    expect(result.exitCode).toBe(0)
    expect(result.stdout.toString().trim()).toBe("./dir/a.txt")
  })
})

const configLayer = TestConfig.layer({
  directories: () => InstanceState.directory.pipe(Effect.map((dir) => [path.join(dir, ".opencode")])),
})
const it = testEffect(
  LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node]), [
    [Config.node, configLayer],
    [RuntimeFlags.node, RuntimeFlags.layer()],
  ]),
)

function modelTools(modelID: string) {
  return Effect.gen(function* () {
    const registry = yield* ToolRegistry.Service
    const agents = yield* Agent.Service
    return yield* registry.tools({
      providerID: ProviderV2.ID.opencode,
      modelID: ModelV2.ID.make(modelID),
      agent: yield* agents.defaultInfo(),
    })
  })
}

function toolIds(modelID: string) {
  return modelTools(modelID).pipe(Effect.map((tools) => tools.map((tool) => tool.id)))
}

function bashDescription(modelID: string) {
  return modelTools(modelID).pipe(Effect.map((tools) => tools.find((tool) => tool.id === "bash")?.description ?? ""))
}

describe("bash-search tool registry", () => {
  afterEach(async () => {
    await disposeAllInstances()
  })

  it.instance("keeps glob/grep for claude models when inactive", () =>
    Effect.gen(function* () {
      BashSearch.deactivate()
      const ids = yield* toolIds("claude-sonnet-4-5")
      expect(ids).toContain("glob")
      expect(ids).toContain("grep")
    }),
  )

  if (bins) {
    it.instance("removes glob/grep for claude models when active", () =>
      Effect.gen(function* () {
        process.env[FLAG] = "1"
        yield* Effect.promise(() => BashSearch.activate())
        const ids = yield* toolIds("claude-sonnet-4-5")
        expect(ids).not.toContain("glob")
        expect(ids).not.toContain("grep")
        expect(ids).toContain("read")
        expect(ids).toContain("bash")
      }),
    )

    it.instance("keeps glob/grep for non-claude models when active", () =>
      Effect.gen(function* () {
        process.env[FLAG] = "1"
        yield* Effect.promise(() => BashSearch.activate())
        const ids = yield* toolIds("gpt-5.6")
        expect(ids).toContain("glob")
        expect(ids).toContain("grep")
      }),
    )

    it.instance("strips the shell search bullets for claude models when active", () =>
      Effect.gen(function* () {
        process.env[FLAG] = "1"
        yield* Effect.promise(() => BashSearch.activate())
        const description = yield* bashDescription("claude-sonnet-4-5")
        expect(description).not.toContain("File search: use Glob")
        expect(description).not.toContain("Content search: use Grep")
        expect(description).toContain("Read files: use Read")
      }),
    )

    it.instance("keeps the shell search bullets for non-claude models when active", () =>
      Effect.gen(function* () {
        process.env[FLAG] = "1"
        yield* Effect.promise(() => BashSearch.activate())
        const description = yield* bashDescription("gpt-5.6")
        expect(description).toContain("File search: use Glob")
        expect(description).toContain("Content search: use Grep")
      }),
    )
  }
})
