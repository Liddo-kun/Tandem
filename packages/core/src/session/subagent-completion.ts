export * as SubagentCompletion from "./subagent-completion.js"

import { Effect } from "effect"
import type { Job } from "../job.js"
import type { Session } from "../session.js"
import type { SessionMessage } from "./message.js"
// UPSTREAM-DIVERGENCE: keep Tandem's steering presentation in an owned module.
import { withUserSteering } from "./tandem-subagent-steering.js"

export const NO_TEXT = "Subagent completed without a text response."

// UPSTREAM-DIVERGENCE: Tandem collects this job's final answers and separately reports direct user steering.
export const collect = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "messages">,
  recovery: Extract<Job.Recovery, { kind: "subagent" }>,
) {
  const messages = yield* sessions.messages({
    sessionID: recovery.childSessionID,
    order: "asc",
    ...(recovery.promptID ? {} : { type: "assistant" as const }),
    ...(recovery.promptID ? { cursor: { id: recovery.promptID, direction: "next" as const } } : {}),
  })
  // Pre-upgrade durable jobs have no boundary; preserve their latest-message behavior rather than replay old turns.
  if (!recovery.promptID)
    return text(
      messages.findLast(
        (message) => message.type === "assistant" && message.time.completed !== undefined && !message.error,
      ),
    )
  const answers = messages.flatMap((message) => {
    if (
      message.type !== "assistant" ||
      message.time.completed === undefined ||
      message.error !== undefined ||
      message.finish !== "stop" ||
      message.content.some((part) => part.type === "tool" && !part.executed)
    )
      return []
    const parts = message.content.filter((part) => part.type === "text")
    const final = parts.some((part) => part.state?.phase === "final_answer")
    const answer = parts
      .filter((part) => (final ? part.state?.phase === "final_answer" : part.state?.phase !== "commentary"))
      .map((part) => part.text)
      .filter((value) => value.length > 0)
      .join("\n\n")
    return answer ? [answer] : []
  })
  const output =
    answers.length === 0
      ? NO_TEXT
      : answers.length === 1
        ? answers[0]
        : answers.map((answer, index) => `### Subagent final answer ${index + 1}\n\n${answer}`).join("\n\n")
  // UPSTREAM-DIVERGENCE: report direct user steering separately from the collected finals.
  return withUserSteering(messages, output)
})

export function text(message: SessionMessage.Info | undefined) {
  if (message?.type !== "assistant") return NO_TEXT
  return (
    message.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .filter((text) => text.length > 0)
      .join("\n\n") || NO_TEXT
  )
}

export const deliver = Effect.fnUntraced(function* (
  sessions: Pick<Session.Interface, "synthetic">,
  jobs: Pick<Job.Interface, "completeBackground">,
  input: Pick<Job.Info, "status" | "output" | "error" | "notificationID"> & {
    recovery: Extract<Job.Recovery, { kind: "subagent" }>
    resume?: boolean
  },
) {
  if (input.status === "running") return
  const recovery = input.recovery
  const text =
    input.status === "completed"
      ? (input.output ?? NO_TEXT)
      : input.status === "error"
        ? (input.error ?? "Subagent failed")
        : "Subagent cancelled"
  yield* sessions.synthetic({
    ...(input.notificationID ? { id: input.notificationID } : {}),
    sessionID: recovery.parentSessionID,
    ...(input.resume === false ? { resume: false } : {}),
    description: recovery.description,
    text: `<subagent sessionID="${recovery.childSessionID}" state="${input.status}" description="${recovery.description}">\n${text}\n</subagent>`,
    metadata: { source: "subagent", childID: recovery.childSessionID, agent: recovery.agent, state: input.status },
  })
  if (input.notificationID) yield* jobs.completeBackground(input.notificationID)
})
