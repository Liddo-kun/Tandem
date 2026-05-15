import { describe, expect, test } from "bun:test"
import type { OpencodeClient, Session } from "@opencode-ai/sdk/v2/client"
import { createStore } from "solid-js/store"
import { warmSessions } from "./bootstrap"
import type { State } from "./types"

const session = (input: { id: string; parentID?: string }) =>
  ({
    id: input.id,
    parentID: input.parentID,
    time: {
      created: 1,
      updated: 1,
    },
  }) as Session

const baseState = (input: Partial<State> = {}) =>
  ({
    status: "complete",
    agent: [],
    command: [],
    project: "",
    projectMeta: undefined,
    icon: undefined,
    provider_ready: true,
    provider: {} as State["provider"],
    config: {} as State["config"],
    path: { directory: "/tmp" } as State["path"],
    session: [],
    sessionTotal: 0,
    session_status: {},
    session_diff: {},
    todo: {},
    permission: {},
    question: {},
    mcp_ready: true,
    mcp: {},
    lsp_ready: true,
    lsp: [],
    vcs: undefined,
    limit: 10,
    message: {},
    part: {},
    ...input,
  }) as State

function sdkWithSessions(sessions: Record<string, Session>, calls: string[]) {
  return {
    session: {
      get: async ({ sessionID }: { sessionID: string }) => {
        calls.push(sessionID)
        return { data: sessions[sessionID] }
      },
    },
  } as unknown as OpencodeClient
}

describe("warmSessions", () => {
  test("loads missing session ancestors for prompt request trees", async () => {
    const [store, setStore] = createStore(
      baseState({
        session: [session({ id: "root" })],
      }),
    )
    const calls: string[] = []
    const sdk = sdkWithSessions(
      {
        child: session({ id: "child", parentID: "root" }),
        grandchild: session({ id: "grandchild", parentID: "child" }),
      },
      calls,
    )

    await warmSessions({ ids: ["grandchild"], store, setStore, sdk })

    expect(calls).toEqual(["grandchild", "child"])
    expect(store.session.map((item) => item.id)).toEqual(["child", "grandchild", "root"])
  })

  test("walks ancestors for already-known prompt sessions", async () => {
    const [store, setStore] = createStore(
      baseState({
        session: [session({ id: "grandchild", parentID: "child" }), session({ id: "root" })],
      }),
    )
    const calls: string[] = []
    const sdk = sdkWithSessions(
      {
        child: session({ id: "child", parentID: "root" }),
      },
      calls,
    )

    await warmSessions({ ids: ["grandchild"], store, setStore, sdk })

    expect(calls).toEqual(["child"])
    expect(store.session.map((item) => item.id)).toEqual(["child", "grandchild", "root"])
  })
})
