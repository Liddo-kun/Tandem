# Todo after v2 implementation

Follow-up work deferred from the [v2 port](v2-port.md).

## Subagents

- [ ] Evaluate v2's subagent features and architecture with Jon after hands-on use. Review cancellation, cleanup, history/resumption and follow-up ergonomics against the old Tandem behavior.
- [ ] Reimplement the enhancements Jon still wants using v2's architecture and extension points.

## File discovery

- [ ] Check v2's project picker in home/root directories and investigate only if folders are missing. If a failure is reproduced, determine the appropriate fix; the old Tandem fff-to-ripgrep fallback in `packages/core/src/filesystem/search.ts` is a reference, not an assumed requirement.

## Backend reliability investigations

- [ ] Check truncated model output in real sessions: determine whether tool-JSON repair can execute an unintended incomplete tool call. Inspect `packages/ai/src/protocols/utils/tool-stream.ts` and `packages/ai/src/protocols/anthropic-messages.ts` (`onMessageStop`). Treat this as unconfirmed; fix only a demonstrated problem.
- [ ] Check whether provider/publisher failures leave tools or assistant messages pending, including non-AI errors. Inspect `packages/core/src/session/runner/step.ts`; establish the actual failure before changing settlement behavior.

## iOS

Jon has no iPhone and has never tested Tandem on iOS.

- [ ] Adapt the existing iOS wrapper's imports/dependencies to v2 using the working Android/shared integration.
- [ ] Wire iOS platform support, native storage and `createBrowserDraftStore`; adapt the native bridge as needed.
- [ ] Build and verify on an actual iOS device when one is available.

## Interactive Chrome bridge

The Codex-desktop-plugin import lives in `packages/chrome-bridge`. At the assessed v2 revision,
upstream's `browser` drives a separate Electron profile and is desktop-only. Reassess its capabilities
and extension points before porting the integration. Browser-backed webfetch remains in the initial port.

- [ ] Register the bridge tool, bootstrap skill and documentation action as a v2 plugin, avoiding a name collision with upstream's `browser` namespace. Reuse the engine adapter, native host, journals, aliases, PNG checks and visible-controls behavior.
- [ ] Integrate runner lifecycle and awaited cleanup through available hooks; assess whether a narrow core hook is necessary.
- [ ] Port per-capability/origin permissions, ask-by-default behavior and request-local dismissal/cancellation. Check public APIs first and bring required permission/schema/client extensions to Jon.
- [ ] Port private expiring screenshots, transient provider hydration and bounded UI display. Reuse upstream media infrastructure where it preserves the required ownership and expiry behavior.
- [ ] Port browser-grant settings and the bounded browser-tool summary renderer.
- [ ] Regenerate shared contracts only where needed and verify real browser workflows and cleanup.

## Chat appearance

Try v2's Android UI with Jon before choosing which tweaks to recreate. The details below describe
Tandem v1 at `e4cff28994`, compared with its upstream baseline `2fa3363c92`; they are a reconstruction
reference, not fixed requirements for v2's different layout. Current inventory: `log.md`,
**Shared Chat And Tool Display**.

### Compact chat spacing

- [ ] Compare v2's default chat density with the old compact layout and implement the changes Jon wants.

The old shared CSS reduces whitespace around messages and their copy/metadata controls:

| Element | Upstream baseline | Tandem v1 |
| --- | --- | --- |
| User bubble padding (vertical / horizontal) | 8px / 12px | 4px / 10px |
| User copy-row minimum height | 24px | 18px |
| User copy-row top margin | 4px | 0 |
| Assistant text-block top margin | 24px | 4px |
| Assistant copy-row minimum height | 24px | 18px |
| Assistant copy-row top margin | 4px | 0 |
| Assistant content-stack gap | 12px | 6px |
| Turn-list gap | 24px | 4px |

The assistant copy row also constrains normal-size icon buttons to 20×20px. These shared spacing
changes affect all clients; only the side-gutter changes below are Android-specific. Retune for v2's
timeline rows and check readability, touch controls and streaming/scroll stability rather than copying
old selectors blindly.

Old sources: `packages/session-ui/src/components/message-part.css` and `session-turn.css`.
V2 candidates: the corresponding CSS and `packages/session-ui/src/timeline/session-timeline-row.tsx`.

### Narrow Android side margins

- [ ] Evaluate and, if wanted, restore narrower Android chat gutters without changing web/desktop margins.

- In the Android APK, the new-layout outer session-card inset is 3px (`p-[3px]`) instead of 8px (`p-2`).
- All timeline row containers use 8px horizontal padding (`px-2`) rather than 16px, or 20px at the
  medium breakpoint (`px-4 md:px-5`). A shared `rowPadX` keeps message/auxiliary rows aligned.
- Both changes are gated on `platform.platform === "android"`; browser, desktop and iOS retain
  upstream margins. Check narrow and wide tablet layouts and avoid confusing these gutters with
  native safe-area/keyboard insets.

Old sources: `packages/app/src/pages/session.tsx` and `pages/session/timeline/message-timeline.tsx`.
V2 candidate: the timeline row's `padding` input and its app-side container.

### Compact shell and patch summaries

- [ ] Compare v2's tool cards with Tandem's compact summaries and recreate only the useful differences.

The old collapsed/trigger presentation uses two lines while preserving expanded output and diffs:

- Main line: a small status dot, tool name and parenthesized command/file subject, e.g.
  `Bash(git status)` or `apply_patch(src/app.ts)`. Long subjects ellipsize instead of widening the card.
- Status: neutral, warning-colored pending/running, success-colored completed, or error-colored failure.
  The tool name shimmers while pending/running. A nonzero shell `exit`/`exitCode` also indicates failure.
- Preview line: an indented branch marker followed by one ellipsized line, shown only after pending/running
  ends. Shell uses the first nonempty output line after stripping ANSI escapes and trimming whitespace.
- Single-file patch previews distinguish create, delete, move and update. Creation includes the line
  count; updates show additions/removals (or “no line changes”). Multi-file patches summarize the file
  count; missing file metadata falls back to the first output line.
- Typography: 14px monospace main line, 13px preview, an 8px status dot, no vertical gap between lines.
  Multiline collapsible triggers use automatic height, a 36px minimum and 2px vertical padding.
- Running shell commands can still expand. Expanded shell output retains the command, full output and
  copy button; patch cards retain single-file and multi-file diff/accordion views. Error-card labels
  match the visible tool names.

Old sources: `ToolSummaryTrigger` in `packages/session-ui/src/components/basic-tool.tsx` / `.css`;
`firstOutputLine`, `toolFailed`, `applyPatchSummary` and the shell/patch renderers in
`packages/session-ui/src/components/message-part.tsx`; `tool-error-card.tsx`; and
`packages/ui/src/components/collapsible.css`. These helpers were also reused by webfetch: the retained
webfetch answer renderer must not depend on completing this deferred shell/patch styling task.

V2 candidate: `packages/session-ui/src/tools/tool-renderer.tsx`. Its tools are named `shell` and
`patch`; also inspect how Code Mode `execute` groups calls before deciding where summaries belong.

### Context and cache indicator

- [ ] Evaluate v2's usage/context display with Jon before deciding whether to recreate the composer-footer indicator or add only missing information.

The old footer button shows `NN,NNNt   TTL: M:SS` without a “Context” label. It opens the same
context panel as the header usage ring. The countdown starts at the last completed request; the old
provider mapping uses a one-hour TTL for Anthropic/OpenRouter/Alibaba and hides the TTL for other
providers. A v2 implementation must derive applicable TTLs from its current cache policy.

After a response completes, the button briefly shows `cache hit: NN%` with a colored background pulse,
then returns to the token/countdown display. Cache health is `cacheRead / previousCacheTotal`, with a
per-request hit-ratio fallback on the first request. Bands are green at ≥90%, amber at ≥50%, otherwise
red. Session switches do not pulse; the pulse uses completed-request statistics, not partial streaming
values. Preserve those semantics if recreating the indicator, while checking what v2 already supplies.

Old sources: `packages/app/src/components/session/context-token-button.tsx`, `session-context-metrics.ts`,
`packages/app/src/components/prompt-input-v2.tsx`, `pages/session/helpers.ts` and `index.css`.
V2 candidates: `packages/gui-extensions/src/usage` and a composer control slot if still wanted.

### Manual session refresh

- [ ] Evaluate v2's recovery after background suspension, reconnect and server restart. If a manual recovery control is still useful, add a session refresh button using v2's synchronization APIs and header extension point.

The old button sits beside the session overflow actions (inside the Session tab on mobile). It forces
the active conversation's messages and session state to resynchronize without reloading the whole
app. It was added for stale client state after missed events, including rewind/send and server-restart
cases. Reuse upstream recovery where it works and evaluate the need for the button with Jon.

Old sources: `packages/app/src/pages/session/timeline/message-timeline.tsx` (`refreshSession`) and
`packages/app/src/pages/session.tsx` (forced active-session refresh). V2 candidate: the `session.header`
GUI extension slot and current client synchronization methods.

### Mobile session title and actions in the tab bar

- [ ] Try v2's mobile navigation with Jon and decide whether moving the session title/actions into the tab bar still improves usable space. Adapt to v2's extension-defined tabs if wanted.

The old phone layout divides the bottom tabs 75/25 between Session and Changes. The Session tab shows
the live conversation title (falling back to the normal Session label), with the overflow actions
(rename/share/archive/delete) portaled into its `closeButton` slot. The manual-refresh button shares
that actions area. Hiding the separate sticky title bar reclaims about 48px; inline rename and
child-session breadcrumbs retain their header. Desktop and the old-layout variant are unchanged.

The old mobile header context ring was also hidden because the composer-footer context button opened
the same panel. Both that footer and the refresh button are separate deferred decisions above; do not
remove access to usage information or require those controls merely to change the tab layout.

Old sources: `packages/app/src/pages/session.tsx` (`mobileTabs`, `mobileActionsMount`) and
`packages/app/src/pages/session/timeline/message-timeline.tsx` (title/actions portal and header visibility).
V2 candidate: the app's session header/navigation and GUI-extension mobile views. Do not impose the
old fixed two-tab split on v2 without checking its current navigation.

### Shorter composer model labels

- [ ] If Jon still prefers the shorter label, remove a leading `Claude ` from the composer model trigger.

Old behavior uses `name.replace(/^Claude\s+/, "")`, so `Claude Opus 4.8` displays as `Opus 4.8`.
Only the trigger's display text changes: model IDs, provider data and other model names remain intact.
Old source: `packages/app/src/components/prompt-input-v2.tsx`.
V2 candidate: `packages/app/src/composer/composer.tsx`.

## Queued prompt editing (upstream behavior)

These were fixed during the port, then reverted to upstream on 2026-10-05: they are OpenCode
behavior, not caused by Tandem. Reproduce in real use before deciding anything; if confirmed, report
them with the pristine-upstream code path first. Code: `packages/app/src/session/composer/queue.ts`.

- [ ] Editing a queued prompt: a removed attached file can still be sent, or a kept one can appear twice
  (attachment/context prefix and separator handling).
- [ ] Editing a queued prompt that mentions the same @file more than once can bind a mention to the
  wrong occurrence.
- [ ] A queued prompt with empty display text can show hidden model-only text instead.
- [ ] Undoing a queued message back into the composer and resending it may duplicate an attached file
  reference (reviewer suspicion, not reproduced; upstream already had a version of it).

## Webfetch concurrency

- [ ] Jon will compare v1 and v2 browser-fetch concurrency. v2 serializes each whole fetch process-wide
  (`serialized()` in `packages/core/src/plugin/tandem/browser-fetch/cdp-fetch.ts`, no recorded reason;
  its timeout excludes time spent waiting in line). v1 serialized only the browser launch
  (`/home/jon/code/Tandem/packages/opencode/src/plugin/browser-fetch/cdp-fetch.ts`).

## After the switch-over

- [ ] Retire Tandem v1 when Jon no longer needs it: the `tandem-v1` widget and `~/.local/bin/tandem-v1-server`,
  `/usr/local/bin/tandem-v1`, the Tandem v1 app (`ai.opencode.android.v1`) and `~/.local/share/tandem-v1/`
  (about 6 GB including the September database backup). Jon decides when.
- [ ] The daily `~/.local/share/tandem/opencode.db` still holds the migrated v1 tables (about 2.9 GB). Check
  whether v2 reads them after migration before dropping them and vacuuming.
- [ ] inotify watches run out with three servers running, because Syncthing uses about 68,000 of the 77,755.
  Options: keep `node_modules`/build outputs out of Syncthing, or raise the limit at boot (kernel-wide,
  shared with Android). Jon decides.
- [ ] v2's ChatGPT login does not offer GPT-6.1 Sol, so `general-sol` uses GPT-5.6 Sol. Recheck after the
  next upstream sync.
- [ ] Delete the development database's pre-import backup (`opencode.db.before-history-import`, 24 MB) once
  Jon is happy with the imported history.
- [ ] The old `tandem-no-chrome` widget (`~/.local/bin/tandem-no-chrome-web`) also uses port 4098, like the
  development server. Remove it or move it to another port if Jon still wants it.

## Documentation cleanup

- [ ] Trim the stale READMEs under `packages/core/src/plugin/tandem/` (`browser-fetch/`, `claude/`,
  `imagegen/`; about 650 lines) down to what still describes the current code.

## Claude narration — lowest priority

- [ ] Check a real v2 Claude session for visible user-facing narration and intact provider signatures; v2 may already handle this.
- [ ] If still needed, port narration detection, metadata propagation and rendering through the smallest available integration points. Candidate locations: `packages/ai/src/protocols/anthropic-messages.ts`, `packages/core/src/session/runner/publish-llm-event.ts`, and session-ui's `timeline/projection.ts` / `message/message-content.tsx`. Current behavior is documented under Anthropic Narration Rendering in `log.md`.
