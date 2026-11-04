import { createMemo, Show, type JSX } from "solid-js"
import { useLanguage } from "@/runtime/i18n/language"
import { SessionElicitationDock } from "@/session/requests/session-elicitation-dock"
import { SessionPermissionDock } from "@/session/requests/session-permission-dock"
import { SessionQuestionDock } from "@/session/requests/session-question-dock"
import { questionMotion } from "@/session/requests/question-motion"
import { SessionWebSearchDock } from "@/session/requests/session-websearch-dock"
import type { SessionComposerRegionController } from "./session-composer-region-controller"
import { ComposerMorph, Grow } from "./spring-height"

type SessionComposerRegionState = Pick<
  SessionComposerRegionController["state"],
  | "questionRequest"
  | "elicitationRequest"
  | "websearch"
  | "permissionRequest"
  | "permissionResponding"
  | "decide"
  | "blocked"
>

export type SessionComposerRegionViewController = Pick<
  SessionComposerRegionController,
  "centered" | "onResponseSubmit" | "setDockRef" | "child" | "showComposer"
> &
  // UPSTREAM-DIVERGENCE: direct child chat links back to the parent session.
  Partial<Pick<SessionComposerRegionController, "openParent" | "parentID">> & { state: SessionComposerRegionState }

export function SessionComposerRegion(props: {
  controller: SessionComposerRegionViewController
  above?: JSX.Element
  composer: JSX.Element
  subagent: JSX.Element
}) {
  const language = useLanguage()
  const controller = props.controller

  const face = createMemo(() => {
    const websearch = controller.state.websearch.request()
    const question = controller.state.questionRequest()
    const elicitation = controller.state.elicitationRequest()
    const permission = controller.state.permissionRequest()
    // UPSTREAM-DIVERGENCE: child sessions keep the composer for direct subagent chat.
    const composer = controller.showComposer() && !controller.state.blocked()

    return { key: composer ? "composer" : "docks", websearch, question, elicitation, permission, composer }
  })

  return (
    <div
      ref={controller.setDockRef}
      data-component="session-composer-dock"
      class="w-full shrink-0 flex flex-col justify-center items-center pb-3 pointer-events-none"
    >
      {/* Only the docks and composer take the pointer; the gaps beside them belong to the timeline underneath. */}
      <div
        classList={{
          "w-full px-3 *:pointer-events-auto": true,
          "md:max-w-session md:mx-auto": controller.centered(),
        }}
      >
        <div class="relative z-[70] flex flex-col">
          {props.above}
          <ComposerMorph face={face()} instant={(face) => !!face.question && !questionMotion()}>
            {(current) => (
              <div class="flex flex-col">
                <Grow when={current().websearch} fade card class={controller.child() ? "mb-2" : undefined}>
                  <SessionWebSearchDock model={controller.state.websearch} onSubmit={controller.onResponseSubmit} />
                </Grow>
                <Grow
                  when={current().question}
                  instant={!questionMotion()}
                  fade
                  card
                  class={controller.child() ? "mb-2" : undefined}
                >
                  {(request) => <SessionQuestionDock request={request} onSubmit={controller.onResponseSubmit} />}
                </Grow>

                <Grow when={current().elicitation} fade card class={controller.child() ? "mb-2" : undefined}>
                  {(request) => <SessionElicitationDock request={request} onSubmit={controller.onResponseSubmit} />}
                </Grow>

                <Grow when={current().permission} fade card class={controller.child() ? "mb-2" : undefined}>
                  {(request) => (
                    <SessionPermissionDock
                      request={request}
                      responding={controller.state.permissionResponding()}
                      onDecide={(response) => {
                        controller.onResponseSubmit()
                        controller.state.decide(response)
                      }}
                    />
                  )}
                </Grow>

                <Show when={current().composer}>
                  <div
                    classList={{
                      "relative z-[70]": true,
                    }}
                  >
                    {/* UPSTREAM-DIVERGENCE: Tandem permits direct child chat and explains the parent-delivery boundary. */}
                    <Show when={controller.child()}>
                      <div class="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pb-2 text-12-regular text-text-weak">
                        <span>{language.t("session.child.chatNotice")}</span>
                        <Show when={controller.parentID?.()}>
                          <button
                            type="button"
                            class="text-text-base transition-colors hover:text-text-strong"
                            onClick={controller.openParent}
                          >
                            {language.t("session.child.backToParent")}
                          </button>
                        </Show>
                      </div>
                    </Show>
                    {props.composer}
                  </div>
                </Show>
              </div>
            )}
          </ComposerMorph>
          {/* UPSTREAM-DIVERGENCE: child sessions show the composer instead of upstream's subagent bar (props.subagent). */}
        </div>
      </div>
    </div>
  )
}
