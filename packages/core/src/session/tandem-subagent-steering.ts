// Tandem-owned (not in upstream): distinguish direct user steering from the child's final answers.
import type { SessionMessage } from "./message.js"

export function withUserSteering(messages: ReadonlyArray<SessionMessage.Info>, output: string) {
  const steering = messages.flatMap((message) => {
    if (message.type !== "user" || message.metadata?.tandemSubagentPrompt === true) return []
    const attachments = [
      ...(message.files ?? []).map((file) => `File: ${JSON.stringify(file.name ?? file.mime)}`),
      ...(message.agents ?? []).map((agent) => `Agent: ${JSON.stringify(agent.name)}`),
      ...(message.skills ?? []).map((skill) => `Skill: ${JSON.stringify(skill.name)}`),
    ]
    const prompt = [message.text, ...(attachments.length ? [`Attachments:\n${attachments.join("\n")}`] : [])]
      .filter((value) => value.length > 0)
      .join("\n\n")
    return [
      (prompt || "(Empty prompt)")
        .split(/\r?\n/)
        .map((line) => `> ${line}`)
        .join("\n"),
    ]
  })
  if (steering.length === 0) return output
  return [
    "### Direct user steering prompts (chronological)",
    ...steering.map((prompt, index) => `#### User steering prompt ${index + 1}\n\n${prompt}`),
    "### Subagent final responses",
    output,
  ].join("\n\n")
}
