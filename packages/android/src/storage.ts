import type { AsyncStorage } from "@solid-primitives/storage"
import { Store } from "@tauri-apps/plugin-store"

const stores = new Map<string, Promise<Store>>()
const apis = new Map<string, AsyncStorage>()

export function createTauriStorage(name = "default.dat"): AsyncStorage {
  const existing = apis.get(name)
  if (existing) return existing
  const store = stores.get(name) ?? Store.load(name)
  stores.set(name, store)
  // The plugin auto-saves with a 100ms debounce. Draft bytes use IndexedDB instead.
  const api: AsyncStorage = {
    getItem: async (key) => (await (await store).get<string>(key)) ?? null,
    setItem: async (key, value) => { await (await store).set(key, value) },
    removeItem: async (key) => { await (await store).delete(key) },
    clear: async () => { await (await store).clear() },
    key: async (index: number) => (await (await store).keys())[index] ?? null,
    getLength: async () => (await store).length(),
  }
  apis.set(name, api)
  return api
}
