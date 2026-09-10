import { afterEach, expect } from "bun:test"
import { Effect } from "effect"
import { LayerNode } from "@opencode-ai/core/effect/layer-node"
import { ModelV2 } from "@opencode-ai/core/model"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { Agent } from "@/agent/agent"
import { Permission } from "@/permission"
import { Plugin } from "@/plugin"
import { ToolRegistry } from "@/tool/registry"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"

const it = testEffect(LayerNode.compile(LayerNode.group([ToolRegistry.node, Agent.node, Plugin.node])))

afterEach(disposeAllInstances)

for (const action of [
  undefined,
  "allow",
  "ask",
  "deny",
  { "web-fetcher": "allow", "*": "allow", explore: "ask" },
] as const) {
  it.instance(
    `keeps the browser reader internal with task=${typeof action === "object" ? "patterns" : (action ?? "default")}`,
    () =>
      Effect.gen(function* () {
        yield* (yield* Plugin.Service).init()
        const agents = yield* Agent.Service
        const registry = yield* ToolRegistry.Service
        const parent = yield* agents.defaultInfo()
        const child = yield* agents.get("web-fetcher")
        if (!child) throw new Error("browser reader not registered")

        expect(Permission.evaluate("task", child.name, parent.permission).action).toBe("deny")
        expect(Permission.evaluate("task", "explore", parent.permission).action).toBe(
          typeof action === "object" ? "ask" : (action ?? "allow"),
        )
        expect(Permission.evaluate("webfetch", "*", parent.permission).action).toBe("allow")
        expect(Permission.evaluate("fetch_page", "*", parent.permission).action).toBe("deny")
        expect(Permission.evaluate("fetch_page", "*", child.permission).action).toBe("allow")
        expect(Permission.evaluate("webfetch", "*", child.permission).action).toBe("deny")

        const tools = yield* registry.tools({
          providerID: ProviderV2.ID.opencode,
          modelID: ModelV2.ID.make("test"),
          agent: parent,
        })
        const task = tools.find((tool) => tool.id === "task")
        if (!task) throw new Error("task tool not registered")
        expect(task.description).not.toContain("web-fetcher")
        if (action !== "deny") expect(task.description).toContain("- explore:")
      }),
    { config: { permission: action ? { task: action } : {} } },
  )
}
