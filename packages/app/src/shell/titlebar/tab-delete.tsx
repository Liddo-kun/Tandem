import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { Dialog, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { useQueryClient } from "@tanstack/solid-query"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import type { ServerCtx } from "@/runtime/server/runtime"
import { errorMessage } from "@/shell/layout/helpers"
import { showToast } from "@/shell/notifications/toast"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { sessionTitle } from "@/session/title"
import { notifySessionTabsRemoved } from "./session-events"

/** Tandem: deletes a tab's session from the tab context menu, confirming like Home's session list does. */
export function useTabSessionDelete() {
  const dialog = useDialog()
  const language = useLanguage()
  const queryClient = useQueryClient()

  const remove = (conn: ServerConnection.Any, ctx: ServerCtx, session: SessionInfo) => {
    const ids = sessionTreeIDs(ctx.data.session.list(), session.id)
    return ctx.data.session
      .remove(session.id)
      .then(() => {
        notifySessionTabsRemoved({
          server: ServerConnection.key(conn),
          directory: session.location.directory,
          sessionIDs: ids,
        })
      })
      .catch((cause) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        })
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["home-sessions", conn], exact: true })
      })
  }

  function DeleteDialog(props: { conn: ServerConnection.Any; ctx: ServerCtx; session: SessionInfo }) {
    const name = () => sessionTitle(props.session.title) ?? language.t("command.session.new")
    const confirm = async () => {
      await remove(props.conn, props.ctx, props.session)
      dialog.close()
    }
    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  return (conn: ServerConnection.Any, ctx: ServerCtx, session: SessionInfo) =>
    dialog.show(() => <DeleteDialog conn={conn} ctx={ctx} session={session} />)
}
