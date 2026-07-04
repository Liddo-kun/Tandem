import type { AsyncStorage } from "@solid-primitives/storage"
import { Store } from "@tauri-apps/plugin-store"

type StoreLike = {
  get: (key: string) => Promise<string | null | undefined>
  set: (key: string, value: string) => Promise<unknown>
  delete: (key: string) => Promise<unknown>
  clear: () => Promise<unknown>
  keys: () => Promise<string[]>
  length: () => Promise<number>
}

const storeCache = new Map<string, Promise<StoreLike>>()
const apiCache = new Map<string, AsyncStorage>()
const memoryCache = new Map<string, StoreLike>()

const createMemoryStore = () => {
  const data = new Map<string, string>()
  const store: StoreLike = {
    get: async (key) => data.get(key),
    set: async (key, value) => {
      data.set(key, value)
    },
    delete: async (key) => {
      data.delete(key)
    },
    clear: async () => {
      data.clear()
    },
    keys: async () => Array.from(data.keys()),
    length: async () => data.size,
  }
  return store
}

const getStore = (name: string) => {
  const cached = storeCache.get(name)
  if (cached) return cached

  const store = Store.load(name).catch(() => {
    const cached = memoryCache.get(name)
    if (cached) return cached
    const memory = createMemoryStore()
    memoryCache.set(name, memory)
    return memory
  })

  storeCache.set(name, store)
  return store
}

export const createTauriStorage = (name = "default.dat") => {
  const cached = apiCache.get(name)
  if (cached) return cached

  // Writes rely on the store plugin's built-in auto-save (100ms debounce); an
  // explicit save() per write would force an extra IPC round-trip plus a full
  // file rewrite on every persisted value (e.g. each prompt-draft keystroke).
  const api: AsyncStorage = {
    getItem: async (key: string) => {
      const store = await getStore(name)
      const value = await store.get(key).catch(() => null)
      if (value === undefined) return null
      return value
    },
    setItem: async (key: string, value: string) => {
      const store = await getStore(name)
      await store.set(key, value).catch(() => undefined)
    },
    removeItem: async (key: string) => {
      const store = await getStore(name)
      await store.delete(key).catch(() => undefined)
    },
    clear: async () => {
      const store = await getStore(name)
      await store.clear().catch(() => undefined)
    },
    key: async (index: number) => {
      const store = await getStore(name)
      return (await store.keys().catch(() => []))[index] ?? null
    },
    getLength: async () => {
      const store = await getStore(name)
      return await store.length().catch(() => 0)
    },
    get length() {
      return api.getLength()
    },
  }

  apiCache.set(name, api)
  return api
}
