import { createMemo, Show } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { useNavigate } from "@solidjs/router"
import { useMutation } from "@tanstack/solid-query"
import { Button } from "@opencode-ai/ui/button"
import { Dialog } from "@opencode-ai/ui/dialog"
import { DropdownMenu } from "@opencode-ai/ui/dropdown-menu"
import { IconButton } from "@opencode-ai/ui/icon-button"
import { TextField } from "@opencode-ai/ui/text-field"
import { Popover as KobaltePopover } from "@kobalte/core/popover"
import { showToast } from "@opencode-ai/ui/toast"
import { useDialog } from "@opencode-ai/ui/context/dialog"
import { SessionContextUsage } from "@/components/session-context-usage"
import { useServerSDK } from "@/context/server-sdk"
import { useLanguage } from "@/context/language"
import { usePlatform } from "@/context/platform"
import { useSDK } from "@/context/sdk"
import { useSync } from "@/context/sync"
import { useSessionKey } from "@/pages/session/session-layout"
import { sessionTitle } from "@/utils/session-title"

export function SessionTitleActions(props: { sessionID?: string; parentID?: string; onRename: () => void }) {
  const navigate = useNavigate()
  const serverSDK = useServerSDK()
  const sdk = useSDK()
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const { params } = useSessionKey()
  const nativeMobile = platform.platform === "ios" || platform.platform === "android"

  const shareUrl = createMemo(() => {
    if (!props.sessionID) return
    return sync.session.get(props.sessionID)?.share?.url
  })
  const shareEnabled = createMemo(() => sync.data.config.share !== "disabled")
  const [title, setTitle] = createStore({
    menuOpen: false,
    pendingRename: false,
    pendingShare: false,
    pendingDelete: undefined as string | undefined,
  })
  const [share, setShare] = createStore({
    open: false,
    dismiss: null as "escape" | "outside" | null,
  })
  let more: HTMLButtonElement | undefined

  const errorMessage = (err: unknown) => {
    if (err && typeof err === "object" && "data" in err) {
      const data = (err as { data?: { message?: string } }).data
      if (data?.message) return data.message
    }
    if (err instanceof Error) return err.message
    return language.t("common.requestFailed")
  }

  const navigateAfterSessionRemoval = (sessionID: string, parentID?: string, nextSessionID?: string) => {
    if (params.id !== sessionID) return
    if (parentID) {
      navigate(`/${params.dir}/session/${parentID}`)
      return
    }
    if (nextSessionID) {
      navigate(`/${params.dir}/session/${nextSessionID}`)
      return
    }
    navigate(`/${params.dir}/session`)
  }

  const shareMutation = useMutation(() => ({
    mutationFn: (id: string) => serverSDK.client.session.share({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to share session", err)
    },
  }))

  const unshareMutation = useMutation(() => ({
    mutationFn: (id: string) => serverSDK.client.session.unshare({ sessionID: id, directory: sdk.directory }),
    onError: (err) => {
      console.error("Failed to unshare session", err)
    },
  }))

  const viewShare = () => {
    const url = shareUrl()
    if (!url) return
    platform.openLink(url)
  }

  const shareSession = () => {
    const id = props.sessionID
    if (!id || shareMutation.isPending) return
    if (!shareEnabled()) return
    shareMutation.mutate(id)
  }

  const unshareSession = () => {
    const id = props.sessionID
    if (!id || unshareMutation.isPending) return
    if (!shareEnabled()) return
    unshareMutation.mutate(id)
  }

  const archiveSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return

    const sessions = sync.data.session ?? []
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    await sdk.client.session
      .update({ sessionID, time: { archived: Date.now() } })
      .then(() => {
        sync.set(
          produce((draft) => {
            const index = draft.session.findIndex((s) => s.id === sessionID)
            if (index !== -1) draft.session.splice(index, 1)
          }),
        )
        navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
      })
      .catch((err) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(err),
        })
      })
  }

  const deleteSession = async (sessionID: string) => {
    const session = sync.session.get(sessionID)
    if (!session) return false

    const sessions = (sync.data.session ?? []).filter((s) => !s.parentID && !s.time?.archived)
    const index = sessions.findIndex((s) => s.id === sessionID)
    const nextSession = index === -1 ? undefined : (sessions[index + 1] ?? sessions[index - 1])

    const result = await sdk.client.session
      .delete({ sessionID })
      .then((x) => x.data)
      .catch((err) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(err),
        })
        return false
      })

    if (!result) return false

    sync.set(
      produce((draft) => {
        const removed = new Set<string>([sessionID])

        const byParent = new Map<string, string[]>()
        for (const item of draft.session) {
          const parentID = item.parentID
          if (!parentID) continue
          const existing = byParent.get(parentID)
          if (existing) {
            existing.push(item.id)
            continue
          }
          byParent.set(parentID, [item.id])
        }

        const stack = [sessionID]
        while (stack.length) {
          const parentID = stack.pop()
          if (!parentID) continue

          const children = byParent.get(parentID)
          if (!children) continue

          for (const child of children) {
            if (removed.has(child)) continue
            removed.add(child)
            stack.push(child)
          }
        }

        draft.session = draft.session.filter((s) => !removed.has(s.id))
      }),
    )

    navigateAfterSessionRemoval(sessionID, session.parentID, nextSession?.id)
    return true
  }

  return (
    <Show when={props.sessionID} keyed>
      {(id) => (
        <div class="shrink-0 flex items-center gap-3">
          <SessionContextUsage placement="bottom" />
          <Show when={!props.parentID}>
            <DropdownMenu
              gutter={4}
              modal={!nativeMobile}
              placement="bottom-end"
              open={title.menuOpen}
              onOpenChange={(open) => {
                setTitle("menuOpen", open)
                if (open) return
              }}
            >
              <DropdownMenu.Trigger
                as={IconButton}
                icon="dot-grid"
                variant="ghost"
                class="size-6 rounded-md data-[expanded]:bg-surface-base-active"
                classList={{
                  "bg-surface-base-active": share.open || title.pendingShare,
                }}
                aria-label={language.t("common.moreOptions")}
                aria-expanded={title.menuOpen || share.open || title.pendingShare}
                ref={(el: HTMLButtonElement) => {
                  more = el
                }}
              />
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  style={{ "min-width": "104px" }}
                  onCloseAutoFocus={(event) => {
                    if (title.pendingRename) {
                      event.preventDefault()
                      setTitle("pendingRename", false)
                      props.onRename()
                      return
                    }
                    if (title.pendingShare) {
                      event.preventDefault()
                      requestAnimationFrame(() => {
                        setShare({ open: true, dismiss: null })
                        setTitle("pendingShare", false)
                      })
                      return
                    }
                    if (title.pendingDelete) {
                      const id = title.pendingDelete
                      event.preventDefault()
                      requestAnimationFrame(() => {
                        dialog.show(() => <DialogDeleteSession sessionID={id} onDelete={deleteSession} />)
                        setTitle("pendingDelete", undefined)
                      })
                    }
                  }}
                >
                  <DropdownMenu.Item
                    onSelect={() => {
                      setTitle("pendingRename", true)
                      setTitle("menuOpen", false)
                    }}
                  >
                    <DropdownMenu.ItemLabel>{language.t("common.rename")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <Show when={shareEnabled()}>
                    <DropdownMenu.Item
                      onSelect={() => {
                        setTitle({ pendingShare: true, menuOpen: false })
                      }}
                    >
                      <DropdownMenu.ItemLabel>{language.t("session.share.action.share")}</DropdownMenu.ItemLabel>
                    </DropdownMenu.Item>
                  </Show>
                  <DropdownMenu.Item onSelect={() => void archiveSession(id)}>
                    <DropdownMenu.ItemLabel>{language.t("common.archive")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                  <DropdownMenu.Separator />
                  <DropdownMenu.Item
                    onSelect={() => {
                      setTitle({ pendingDelete: id, menuOpen: false })
                    }}
                  >
                    <DropdownMenu.ItemLabel>{language.t("common.delete")}</DropdownMenu.ItemLabel>
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu>

            <KobaltePopover
              open={share.open}
              anchorRef={() => more}
              placement="bottom-end"
              gutter={4}
              modal={false}
              onOpenChange={(open) => {
                if (open) setShare("dismiss", null)
                setShare("open", open)
              }}
            >
              <KobaltePopover.Portal>
                <KobaltePopover.Content
                  data-component="popover-content"
                  style={{ "min-width": "320px" }}
                  onEscapeKeyDown={(event) => {
                    setShare({ dismiss: "escape", open: false })
                    event.preventDefault()
                    event.stopPropagation()
                  }}
                  onPointerDownOutside={() => {
                    setShare({ dismiss: "outside", open: false })
                  }}
                  onFocusOutside={() => {
                    setShare({ dismiss: "outside", open: false })
                  }}
                  onCloseAutoFocus={(event) => {
                    if (share.dismiss === "outside") event.preventDefault()
                    setShare("dismiss", null)
                  }}
                >
                  <div class="flex flex-col p-3">
                    <div class="flex flex-col gap-1">
                      <div class="text-13-medium text-text-strong">{language.t("session.share.popover.title")}</div>
                      <div class="text-12-regular text-text-weak">
                        {shareUrl()
                          ? language.t("session.share.popover.description.shared")
                          : language.t("session.share.popover.description.unshared")}
                      </div>
                    </div>
                    <div class="mt-3 flex flex-col gap-2">
                      <Show
                        when={shareUrl()}
                        fallback={
                          <Button
                            size="large"
                            variant="primary"
                            class="w-full"
                            onClick={shareSession}
                            disabled={shareMutation.isPending}
                          >
                            {shareMutation.isPending
                              ? language.t("session.share.action.publishing")
                              : language.t("session.share.action.publish")}
                          </Button>
                        }
                      >
                        <div class="flex flex-col gap-2">
                          <TextField value={shareUrl() ?? ""} readOnly copyable copyKind="link" tabIndex={-1} class="w-full" />
                          <div class="grid grid-cols-2 gap-2">
                            <Button
                              size="large"
                              variant="secondary"
                              class="w-full shadow-none border border-border-weak-base"
                              onClick={unshareSession}
                              disabled={unshareMutation.isPending}
                            >
                              {unshareMutation.isPending
                                ? language.t("session.share.action.unpublishing")
                                : language.t("session.share.action.unpublish")}
                            </Button>
                            <Button
                              size="large"
                              variant="primary"
                              class="w-full"
                              onClick={viewShare}
                              disabled={unshareMutation.isPending}
                            >
                              {language.t("session.share.action.view")}
                            </Button>
                          </div>
                        </div>
                      </Show>
                    </div>
                  </div>
                </KobaltePopover.Content>
              </KobaltePopover.Portal>
            </KobaltePopover>
          </Show>
        </div>
      )}
    </Show>
  )
}

function DialogDeleteSession(props: { sessionID: string; onDelete: (sessionID: string) => Promise<boolean> }) {
  const sync = useSync()
  const dialog = useDialog()
  const language = useLanguage()
  const name = createMemo(
    () => sessionTitle(sync.session.get(props.sessionID)?.title) ?? language.t("command.session.new"),
  )
  const handleDelete = async () => {
    await props.onDelete(props.sessionID)
    dialog.close()
  }

  return (
    <Dialog title={language.t("session.delete.title")} fit>
      <div class="flex flex-col gap-4 pl-6 pr-2.5 pb-3">
        <div class="flex flex-col gap-1">
          <span class="text-14-regular text-text-strong">{language.t("session.delete.confirm", { name: name() })}</span>
        </div>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" size="large" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="primary" size="large" onClick={handleDelete}>
            {language.t("session.delete.button")}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
