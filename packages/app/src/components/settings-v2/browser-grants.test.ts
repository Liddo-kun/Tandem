import { expect, test } from "bun:test"
import { createRoot } from "solid-js"
import { createStore } from "solid-js/store"
import { createBrowserGrantState } from "./browser-grants"

type Grant = { id: string; projectID: string; action: string; resource: string }

test("scope changes discard stale responses; auth failures retain entries and V1 never lists", async () => {
  const pending: Array<{ projectID: string; resolve: (value: Grant[]) => void; reject: (error: Error) => void }> = []
  const removed: string[] = []
  const client = {
    list: ({ projectID }: { projectID: string }) =>
      new Promise<Grant[]>((resolve, reject) => pending.push({ projectID, resolve, reject })),
    remove: async ({ id }: { id: string }) => {
      removed.push(id)
      throw new Error("HTTP 401")
    },
  }
  const [scope, setScope] = createStore({ projectID: "project-a", v2: true })
  let dispose = () => {}
  const controller = createRoot((cleanup) => {
    dispose = cleanup
    return createBrowserGrantState({ projectID: () => scope.projectID, client: () => (scope.v2 ? client : undefined) })
  })
  expect(pending[0]?.projectID).toBe("project-a")
  setScope("projectID", "project-b")
  expect(pending[1]?.projectID).toBe("project-b")
  pending[0]!.resolve([{ id: "foreign", action: "browser", projectID: "project-a", resource: "*" }])
  pending[1]!.reject(new Error("HTTP 403"))
  await Promise.resolve()
  expect(controller.state.failed).toBe(true)
  expect(controller.state.grants).toEqual([])
  controller.retry()
  const owned = { id: "owned", action: "browser", projectID: "project-b", resource: "*" }
  pending[2]!.resolve([
    owned,
    { ...owned, id: "foreign", projectID: "project-a" },
    { ...owned, id: "shell", action: "bash" },
  ])
  await Promise.resolve()
  expect(controller.state.grants).toEqual([owned])
  await controller.remove(owned)
  expect(removed).toEqual(["owned"])
  expect(controller.state.failed).toBe(true)
  expect(controller.state.grants).toEqual([owned])
  await controller.remove({ ...owned, projectID: "foreign" })
  expect(removed).toEqual(["owned"])
  setScope("v2", false)
  expect(controller.state.grants).toEqual([])
  expect(pending).toHaveLength(3)
  dispose()
})
