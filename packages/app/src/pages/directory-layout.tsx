import { DataProvider } from "@opencode-ai/session-ui/context"
import { showToast } from "@/utils/toast"
import { base64Encode } from "@opencode-ai/core/util/encode"
import { useLocation, useNavigate, useParams } from "@solidjs/router"
import { type Accessor, createEffect, createMemo, createResource, onCleanup, type ParentProps, Show } from "solid-js"
import { useLanguage } from "@/context/language"
import { LocalProvider } from "@/context/local"
import { SDKProvider, useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { decode64 } from "@/utils/base64"
import { Schema } from "effect"
import type { ServerConnection } from "@/context/server"
import { sessionHref } from "@/utils/session-route"
import { useServerSync } from "@/context/server-sync"
import { useServerSDK } from "@/context/server-sdk"
import { usePlatform } from "@/context/platform"
import { readBrowserImage } from "@/utils/browser-media"

export function DirectoryDataProvider(
  props: ParentProps<{
    directory: string | Accessor<string>
    draftID?: string
    server?: Accessor<ServerConnection.Key | undefined>
  }>,
) {
  const location = useLocation()
  const navigate = useNavigate()
  const params = useParams()
  const sync = useSync()
  const sdk = useSDK()
  const serverSync = useServerSync()
  const serverSDK = useServerSDK()
  const platform = usePlatform()
  // Retargeting the server replaces the reader identity, aborting/releasing old capture leases.
  const browserImageReader = createMemo(() => {
    const server = serverSDK().server.http
    return (sessionID: string, uri: string, signal: AbortSignal) =>
      readBrowserImage({ server, fetch: platform.fetch, sessionID, uri, signal })
  })
  const directory = () => (typeof props.directory === "function" ? props.directory() : props.directory)
  const slug = createMemo(() => base64Encode(directory()))
  const href = (sessionID: string) => {
    const server = props.server?.()
    if (server) return sessionHref(server, sessionID)
    return `/${slug()}/session/${sessionID}`
  }

  // UPSTREAM-DIVERGENCE: local Markdown images and imagegen thumbnails use authenticated
  // file reads, outside model context. Reader identity changes with the scoped SDK so image
  // caches cannot survive a server/directory retarget with the same relative filename.
  const readFile = createMemo(() => {
    const client = sdk().client
    return (path: string) =>
      client.file
        .read({ path })
        .then((x) => x.data)
        .catch(() => undefined)
  })

  createEffect(() => {
    // A draft lives at /new-session?draftId=… and has no directory segment to normalize.
    if (props.draftID || props.server?.()) return
    const next = sync().data.path.directory
    if (!next || next === directory()) return
    const path = location.pathname.slice(slug().length + 1)
    navigate(`/${base64Encode(next)}${path}${location.search}${location.hash}`, { replace: true })
  })

  createResource(
    () => params.id,
    (id) =>
      sync()
        .session.sync(id)
        .catch(() => {}),
  )

  createEffect(() => {
    const sessionID = params.id
    if (!sessionID) return
    serverSync().session.pin(sessionID)
    onCleanup(() => serverSync().session.unpin(sessionID))
  })

  return (
    <Show when={directory()} keyed>
      {(directory) => (
        <DataProvider
          data={sync().data}
          directory={directory}
          readFile={readFile()}
          readBrowserImage={browserImageReader()}
          sessionID={params.id}
          onNavigateToSession={(sessionID: string) => navigate(href(sessionID))}
          onSessionHref={href}
        >
          <LocalProvider>{props.children}</LocalProvider>
        </DataProvider>
      )}
    </Show>
  )
}

export const ProjectDirString = Schema.String.pipe(Schema.brand("ProjectDirString"))
export type ProjectDirString = Schema.Schema.Type<typeof ProjectDirString>

export function decodeDirectory(dir: string): ProjectDirString | undefined {
  const decoded = decode64(dir)
  if (!decoded) return
  return ProjectDirString.make(decoded)
}

export default function Layout(props: ParentProps) {
  const params = useParams()
  const language = useLanguage()
  const navigate = useNavigate()
  let invalid = ""

  const resolved = createMemo(() => {
    if (!params.dir) return ""
    return decodeDirectory(params.dir) ?? ""
  })

  createEffect(() => {
    const dir = params.dir
    if (!dir) return
    if (resolved()) {
      invalid = ""
      return
    }
    if (invalid === dir) return
    invalid = dir
    showToast({
      variant: "error",
      title: language.t("common.requestFailed"),
      description: language.t("directory.error.invalidUrl"),
    })
    navigate("/", { replace: true })
  })

  return (
    <Show when={resolved()} keyed>
      {(resolved) => (
        <SDKProvider directory={resolved}>
          <DirectoryDataProvider directory={resolved}>{props.children}</DirectoryDataProvider>
        </SDKProvider>
      )}
    </Show>
  )
}
