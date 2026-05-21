import { createSimpleContext } from "@opencode-ai/ui/context"
import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"

export { applyOptimisticAdd, applyOptimisticRemove, mergeOptimisticPage } from "./directory-sync"

export const { use: useSync, provider: SyncProvider } = createSimpleContext({
  name: "Sync",
  init: () => {
    const globalSync = useGlobalSync()
    const sdk = useSDK()

    return globalSync.createDirSyncContext(sdk.directory)
  },
})
