import { expect } from "bun:test"
import { Message } from "@opencode/ai"
import { Anthropic, OpenAI } from "@opencode/ai/providers"
import { compileRequest } from "@opencode/ai/route/client"
import { Agent } from "@opencode/core/agent"
import { Config } from "@opencode/core/config"
import { AppNodeBuilder } from "@opencode/core/effect/app-node-builder"
import { Instructions } from "@opencode/core/instructions/index"
import { LocationServiceMap } from "@opencode/core/location-service-map"
import { Model } from "@opencode/core/model"
import { Plugin } from "@opencode/core/plugin"
import { Provider } from "@opencode/core/provider"
import { AbsolutePath } from "@opencode/core/schema"
import { Session } from "@opencode/core/session"
import { SessionContext } from "@opencode/core/session/context"
import { SessionModelRequest } from "@opencode/core/session/model-request"
import { SessionRunnerModel } from "@opencode/core/session/runner/model"
import { Tool } from "@opencode/core/tool"
import { LayerNode } from "@opencode/util/effect/layer-node"
import { Global } from "@opencode/util/global"
import { Effect, Layer } from "effect"
import { withEnv } from "./fixture/env"
import { tempGlobalLayer } from "./fixture/global"
import { offlineModels } from "./fixture/models"
import { tmpdirScoped } from "./fixture/tmpdir"
import { testEffect } from "./lib/effect"

const it = testEffect(Layer.empty)
const layer = AppNodeBuilder.build(LayerNode.group([Session.node, LocationServiceMap.node]), [
  Global.node.replace(tempGlobalLayer),
  Config.node.replace(Config.testLayer()),
  offlineModels,
  // Resolve locally without credentials; use the real provider request compiler, never send it.
  SessionRunnerModel.node.replace(
    Layer.succeed(SessionRunnerModel.Service, {
      resolve: (session) =>
        Effect.succeed(
          SessionRunnerModel.resolved(
            session.model?.providerID === "openai"
              ? OpenAI.configure({ apiKey: "fixture" }).responses("gpt-5.5")
              : Anthropic.configure({ apiKey: "fixture" }).model("claude-sonnet-4-6"),
            {
              capabilities: { tools: true, input: ["text"], output: ["text"] },
              cost: [],
              limit: { context: 200_000, output: 32_000 },
            },
          ),
        ),
    }),
  ),
])

// Active-mode coverage needs the same real executables as the feature, not fake successful probes.
const supported =
  ["linux", "darwin"].includes(process.platform) && ["ugrep", "bfs", "grep"].every((bin) => Bun.which(bin))
const run = supported ? it.live : it.live.skip

run(
  "Claude Bash search removes search schemas and instructions from main/child requests and Code Mode",
  () =>
    withEnv({ TANDEM_CLAUDE_BASH_SEARCH: "1", TANDEM_PROMPT_CORRECTOR: "0", TANDEM_DUMP_REQUEST: undefined }, () =>
      Effect.gen(function* () {
        const directory = yield* tmpdirScoped("tandem-bash-search-")
        const sessions = yield* Session.Service
        const locations = yield* LocationServiceMap.Service
        const parent = yield* sessions.create({ location: { directory: AbsolutePath.make(directory.path) } })

        yield* Effect.gen(function* () {
          const plugins = yield* Plugin.Service
          yield* plugins.awaitActivation
          const tools = yield* Tool.Service
          const context = yield* SessionContext.Service
          const original = (yield* tools.list()).filter((tool) => tool.name === "glob" || tool.name === "grep")
          expect(original.map((tool) => tool.name).sort()).toEqual(["glob", "grep"])

          for (const codemode of [false, true]) {
            yield* Effect.scoped(
              Effect.gen(function* () {
                yield* tools.transform((editor) => {
                  for (const name of ["glob", "grep"])
                    editor.update(name, (tool) => {
                      tool.options = codemode ? { codemode: true, pinned: true } : { codemode: false }
                    })
                })

                for (const scenario of [
                  { agent: "build", provider: "anthropic", enabled: "1", removed: true },
                  { agent: "general", provider: "anthropic", enabled: "1", removed: true },
                  { agent: "build", provider: "anthropic", enabled: "0", removed: false },
                  { agent: "general", provider: "openai", enabled: "1", removed: false },
                  { agent: "explore", provider: "anthropic", enabled: "1", removed: false },
                ]) {
                  yield* withEnv({ TANDEM_CLAUDE_BASH_SEARCH: scenario.enabled }, () =>
                    Effect.gen(function* () {
                      const session = yield* sessions.create({
                        ...(scenario.agent === "build" ? { location: parent.location } : { parentID: parent.id }),
                        agent: Agent.ID.make(scenario.agent),
                        ...(scenario.agent === "explore"
                          ? {
                              permissions: [
                                { action: "shell", resource: "*", effect: "deny" as const },
                                { action: "execute", resource: "*", effect: "allow" as const },
                              ],
                            }
                          : {}),
                        model: Model.Ref.make({
                          providerID: Provider.ID.make(scenario.provider),
                          id: Model.ID.make(scenario.provider === "openai" ? "gpt-5.5" : "claude-sonnet-4-6"),
                        }),
                      })
                      const selected = yield* context.select(session.id)
                      expect(selected.tools.bashSearch === true).toBe(scenario.removed)
                      const observed = yield* Instructions.read(selected.instructions)
                      const initial = Instructions.renderInitial(
                        selected.instructions,
                        Object.fromEntries(observed.map((entry) => [entry.key, entry.value])),
                      )
                      const model = yield* context.resolveModel(session)
                      const prepared = yield* context.request.primary({
                        session,
                        agent: selected.agent.id,
                        model,
                        tools: selected.tools,
                        ...SessionModelRequest.baseTranscript({
                          agent: selected.agent.info,
                          model,
                          tools: selected.tools,
                          initial,
                          messages: [],
                        }),
                        messages: [Message.user("Find the source files and read the relevant code.")],
                      })
                      const wire = yield* compileRequest(prepared.request)
                      const payload = JSON.stringify(wire.body)
                      const catalog = JSON.stringify(selected.tools.codeModeCatalog)
                      const names = prepared.request.tools.map((tool) => tool.name)

                      if (scenario.removed) {
                        // Includes system blocks, the relocated first-user reminder, descriptions,
                        // input schemas and the Code Mode inventory, not just top-level tool names.
                        expect(payload).not.toMatch(/\b(?:Glob|Grep)\b|tools\.(?:glob|grep)\b|(?:glob|grep) tool/)
                        expect(catalog).not.toMatch(/"name":"(?:glob|grep)"/)
                        for (const tool of original)
                          expect(payload).not.toContain(JSON.stringify(tool.description).slice(1, -1))
                        expect(names).not.toContain("Glob")
                        expect(names).not.toContain("Grep")
                        expect(names).toContain("Bash")
                        expect(names).toContain("Read")
                        expect(names).toContain("Execute")
                        expect(payload).toContain("Use plain grep and find through Bash")
                        expect(payload).toContain("<system-reminder>")
                        expect(payload).toContain("# Code Mode")
                      } else {
                        // Controls catch false passes from an empty catalog or indiscriminate filtering.
                        for (const tool of original) {
                          if (codemode) expect(catalog).toContain(JSON.stringify(tool.description).slice(1, -1))
                          else
                            expect(names).toContain(
                              scenario.provider === "anthropic"
                                ? tool.name[0].toUpperCase() + tool.name.slice(1)
                                : tool.name,
                            )
                        }
                        expect(payload).not.toContain("Use plain grep and find through Bash")
                      }
                    }),
                  )
                }
              }),
            )
          }
        }).pipe(Effect.provide(locations.get(parent.location)))
      }).pipe(Effect.provide(layer)),
    ),
  60_000,
)
