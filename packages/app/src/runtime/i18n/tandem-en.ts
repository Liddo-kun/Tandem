// Tandem-owned (not in upstream): Tandem's English app strings, layered over upstream's English dictionary.
import en from "./en"

// Other locales have no translations for these keys, so they fall back to this English text.
// `session.child.backToParent` replaces upstream's English value only; translated locales keep theirs.
export const dict = {
  ...en,
  // Explain local-only chat after a delegated job ends; the back link follows that sentence.
  "session.child.chatNotice": "Replies here are also reported to the main session.",
  "session.child.backToParent": "Back to main session.",
  // Corrector, the composer context button, Android zoom and native server connection.
  "prompt.corrector.title": "Corrector",
  "prompt.corrector.description": "Correct spelling, punctuation and dictation errors before sending. Keeps your meaning and leaves attachments and context intact. Changes apply to new prompts; queued prompts keep their original setting.",
  "prompt.context.view": "View context usage",
  "prompt.context.tokens": "{{count}}t",
  "prompt.context.ttl": "{{minutes}}m",
  "prompt.context.cacheHit": "cache",
  "prompt.context.expired": "expired",
  "prompt.cold.title.expired": "The prompt cache has expired",
  "prompt.cold.title.switched": "Nothing is cached for this model",
  "prompt.cold.description": "This conversation is {{count}} tokens. Sending now reads all of them again at full price.",
  "prompt.cold.trim": "Trim and send",
  "prompt.cold.trim.description": "Shortens long tool results from earlier in the conversation, then sends. No extra request. Claude models only.",
  "prompt.cold.trim.failed": "Could not trim the conversation. Your prompt was not sent.",
  "prompt.cold.compact": "Compact and send",
  "prompt.cold.compact.description": "Replaces the conversation with a summary, then sends.",
  "prompt.cold.compact.free": "Free: already compacted before the cache expired. Replaces the conversation with that summary, then sends.",
  "prompt.cold.compact.failed": "Compaction did not finish. Your prompt was not sent.",
  "prompt.cold.send": "Send as is",
  "prompt.cold.send.description": "Sends the whole conversation.",
  "settings.android.zoom.title": "Page zoom",
  "settings.android.zoom.description": "Scale the app from 80% to 150% in 2% steps. Volume keys also adjust zoom. Default: 100%.",
  "settings.android.zoom.reset": "Reset",
  "server.connect.credentialsRequired": "Server is reachable but requires valid credentials. Enter its password or paste a fresh pairing link.",
  "server.connect.v2Required": "This Android app requires a v2 server. Choose a server running version 2.",
  "server.connect.discovery.start": "Find LAN servers",
  "server.connect.discovery.busy": "Searching the local network…",
  "server.connect.discovery.help": "Discovery prefers port 4097 with 4096 as fallback. For other ports, enter the full server URL manually.",
  "server.connect.discovery.failed": "Could not scan the local network. Enter the server URL manually.",
  "server.connect.discovery.credentials": "Credentials required",
  // Rewind and revert.
  "session.revert.count.one": "{{count}} message reverted",
  "session.revert.count.other": "{{count}} messages reverted",
  "session.revert.pending": "Your next prompt makes this permanent",
  "session.revert.redo": "Redo",
  "session.rewind.title": "Rewind to this prompt?",
  "session.rewind.description": "Later messages are hidden. Redo brings them back until your next prompt.",
  "session.rewind.files.one": "{{count}} file changed since this prompt:",
  "session.rewind.files.other": "{{count}} files changed since this prompt:",
  "session.rewind.noFiles": "No file changes were recorded since this prompt.",
  "session.rewind.unknownCounts": "Files marked ? changed by an unknown number of lines.",
  "session.rewind.overwrite": "Restoring files overwrites any later edits to them, including yours.",
  "session.rewind.notCovered":
    "Files outside the session's folder or ignored by Git, untracked files over 2 MB, and effects such as commits are not saved, so a rewind cannot bring them back.",
  "session.rewind.conversation": "Conversation only",
  "session.rewind.conversationAndFiles": "Conversation and files",
  "session.rewind.confirm": "Rewind",
}

export default dict
