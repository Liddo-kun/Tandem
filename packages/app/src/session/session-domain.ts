import type { SessionMessageInfo, SessionMessageUser } from "@opencode/client/promise"

export function selectSessionUserMessages(messages: SessionMessageInfo[]) {
  return messages.filter((message): message is SessionMessageUser => message.type === "user")
}

export function selectVisibleSessionUserMessages(messages: SessionMessageUser[], revertMessageID?: string) {
  if (!revertMessageID) return messages

  // UPSTREAM-DIVERGENCE(temporary): cut at the revert message's position instead of comparing IDs as text.
  return beforeRevert(messages, revertMessageID)
}

// UPSTREAM-DIVERGENCE(temporary): fork-copied IDs end in an unpadded sequence number, so `_745` sorts after
// `_1070` as text. Messages arrive in session order; a revert message outside the loaded window is older than
// all of it, because history loads from the newest message backwards.
export function beforeRevert<T extends { id: string }>(messages: T[], revertMessageID?: string) {
  if (!revertMessageID) return messages

  return messages.slice(0, Math.max(messages.findIndex((message) => message.id === revertMessageID), 0))
}
