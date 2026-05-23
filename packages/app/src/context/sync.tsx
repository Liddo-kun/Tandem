import { useGlobalSync } from "./global-sync"
import { useSDK } from "./sdk"

export { applyOptimisticAdd, applyOptimisticRemove, mergeOptimisticPage } from "./directory-sync"

export const useSync = () => {
  const globalSync = useGlobalSync()
  const sdk = useSDK()

  return globalSync.createDirSyncContext(sdk.directory)
}
