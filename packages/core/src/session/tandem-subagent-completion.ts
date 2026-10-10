// Tandem-owned (not in upstream): collect this job's final answers and report direct user steering.
import { Effect } from "effect"
import type { Job } from "../job.js"
import type { Session } from "../session.js"
import { NO_TEXT, text } from "./subagent-completion.js"
import { withUserSteering } from "./tandem-subagent-steering.js"

export const collectSubagentCompletion = Effect.fnUntraced(function* (
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
  return withUserSteering(messages, output)
})
