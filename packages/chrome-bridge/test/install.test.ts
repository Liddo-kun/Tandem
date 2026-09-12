import { afterEach, expect, test } from "bun:test"
import { chmod, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises"
import { join } from "node:path"
import { install, restore, status } from "../src/install"

const roots: string[] = []
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture() {
  const dir = await mkdtemp("/tmp/tci-")
  roots.push(dir)
  const binary = join(dir, "binary")
  await writeFile(binary, "#!/bin/sh\nexit 0\n", { mode: 0o700 })
  const manifest = join(dir, "manifest.json")
  const previous = JSON.stringify({ path: binary })
  await writeFile(manifest, previous)
  return { root: join(dir, "install"), manifest, binary, id: "fixture", label: "Fixture", previous }
}
test("install and reinstall preserve rollback bytes and binding; restore is repeatable", async () => {
  const f = await fixture()
  expect((await install(f)).state).toBe("pending_activation")
  const registration = await readFile(f.manifest, "utf8")
  expect((await install(f)).state).toBe("pending_activation")
  expect(await readFile(f.manifest, "utf8")).toBe(registration)
  await expect(install({ ...f, id: "another" })).rejects.toThrow("Different installation")
  expect((await status(f.root)).state).toBe("browser_unavailable")
  await restore(f.root)
  await restore(f.root)
  expect(await readFile(f.manifest, "utf8")).toBe(f.previous)
  await install(f)
  expect(await readFile(f.manifest, "utf8")).toBe(registration)
})
test("restore refuses registration takeover and missing previous executable", async () => {
  const f = await fixture()
  await install(f)
  const registration = await readFile(f.manifest, "utf8")
  await writeFile(f.manifest, "another installer")
  await expect(restore(f.root)).rejects.toThrow("changed by another installer")
  await writeFile(f.manifest, registration)
  await unlink(f.binary)
  await expect(restore(f.root)).rejects.toThrow("missing or not executable")
  expect(await readFile(f.manifest, "utf8")).toBe(registration)
})
test("retry resumes saved-before-registration interruption and retains journals", async () => {
  const f = await fixture()
  await install(f)
  await writeFile(f.manifest, f.previous)
  await unlink(join(f.root, "connections.sh"))
  const journal = join(f.root, "ipc", "journal-unresolved.json")
  await writeFile(journal, "unknown outcome")
  await install(f)
  await restore(f.root)
  expect(await readFile(journal, "utf8")).toBe("unknown outcome")
})
test("missing host, changed configuration, interrupted lock fail closed", async () => {
  const f = await fixture()
  const result = await install(f)
  await unlink(result.executable)
  expect((await status(f.root)).state).toBe("missing_host")
  await install(f)
  await writeFile(join(f.root, "connections.sh"), "custom configuration")
  await expect(install(f)).rejects.toThrow("configuration changed")
  await writeFile(join(f.root, "install.lock"), "")
  await expect(install(f)).rejects.toThrow("Installation locked")
})
test("fresh registration restore removes only registration", async () => {
  const f = await fixture()
  await unlink(f.manifest)
  const result = await install(f)
  await restore(f.root)
  expect(await Bun.file(f.manifest).exists()).toBe(false)
  expect(await Bun.file(result.executable).exists()).toBe(true)
})
test("nonexecutable source is rejected before registration changes", async () => {
  const f = await fixture()
  await chmod(f.binary, 0o600)
  await expect(install(f)).rejects.toThrow()
  expect(await readFile(f.manifest, "utf8")).toBe(f.previous)
})

test("status detects missing launcher and reports restored registration", async () => {
  const f = await fixture()
  await install(f)
  const manifest = JSON.parse(await readFile(f.manifest, "utf8"))
  await unlink(manifest.path)
  expect((await status(f.root)).state).toBe("missing_host")
  await restore(f.root)
  expect((await status(f.root)).state).toBe("restored")
})

test("preexisting connection configuration is preserved without taking registration", async () => {
  const f = await fixture()
  await install(f)
  await restore(f.root)
  await writeFile(join(f.root, "connections.sh"), "operator configuration")
  await expect(install(f)).rejects.toThrow("configuration changed")
  expect(await readFile(f.manifest, "utf8")).toBe(f.previous)
  expect(await readFile(join(f.root, "connections.sh"), "utf8")).toBe("operator configuration")
})
