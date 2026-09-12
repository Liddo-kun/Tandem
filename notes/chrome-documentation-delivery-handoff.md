# Codex-Style Browser Documentation Delivery

## Task

Implement Tandem's browser documentation delivery so it closely mirrors the
original Codex Chrome plugin: a short bootstrap skill, followed by complete
runtime-selected documentation delivered to the model before browser interaction,
with named supplementary documents available on demand.

**Use the instructions embedded in the exact plugin source used to build this
tool. Do not write another independently summarized browser manual.** Preserve
original wording and behavior where compatible; adapt only the actual differences
in Tandem's exposed API, authorization and lifecycle.

This document is a handoff, not an implementation or verification claim.

## Jon's Working Instructions

- Work personally, without subagents.
- Read current `contextL.md` (or `contextW.md`), relevant `log.md` entries and
  applicable nested `AGENTS.md`. Other sessions may have changed the workspace.
  Preserve unrelated changes; do not assume the earlier browser handoff describes
  the latest source or installed version.
- After necessary source inspection, first verify through a real agent session
  making real tool calls. Do not start with `bun test`, test-writing, fixture
  repairs or typechecks. Do not write/modify/run low-level tests unless Jon
  explicitly requests them. Historical failing tests are not the work queue.
- Test actual session/model-context delivery and behavior, on multiple websites,
  not just Shopee. A direct function call or synthetic provider script alone is
  not proof that a real agent received and followed the documentation.
- If live verification is blocked, report the specific blocker; do not substitute
  low-level tests. Build only when needed to load the changes; focused post-change
  typechecks are supporting work, not a startup routine.
- Do not restart production automatically. Install verified builds with rollback
  available and let Jon restart. Never clear native journals or take over uncertain
  tab ownership to get a successful result.
- Jon's suggestions during execution are not requests to stop working.

## Current Gap

Tandem's shared `chrome-browser` skill was expanded with relevant Codex behavioral
guidance, but the delivery mechanism was not ported:

- Skills are advertised to the model in the available-skills list.
- Calling `skill` loads static Markdown from
  `packages/core/src/plugin/skill/chrome-browser.md` into tool output.
- The browser tool supplies a description and JSON parameter schema.
- There is no equivalent of the complete, selected-browser
  `chrome.documentation()` result and its named supplemental-document lookup.

The earlier Shopee session genuinely loaded the static skill. The problem was
not simply that the model forgot to load it. Adding more prose to that same skill
does not close the documentation-delivery gap.

Separate issues (approval reduction and historical blocked-lease recovery) are
described in `notes/chrome-browser-handoff-20260911.md`. Do not silently fold their
implementation into this task. Recheck their current state before writing any
permission or cleanup instructions.

## Exact Source Of Truth

Read `packages/chrome-bridge/vendor/original/source.json` first. At handoff it pins:

```text
/home/jon/.codex/plugins/cache/personal/chrome-standalone/26.901.51231-standalone.1+codex.20260909145247
```

The recorded original service SHA256 is:

```text
3027e8e47d3241f8fde99078a9ced4647ac1732b614b3704628405236f8ac18b
```

Relevant files beneath that installed plugin root:

- `skills/control-chrome/SKILL.md` -- canonical bootstrap and working-session rules.
  Do not substitute the separately named edited copy.
- `scripts/browser-client.mjs` -- model-facing client, browser documentation method,
  named document lookup and request transport.
- `scripts/browser-service.mjs` -- embedded documentation strings, document/API
  manifests, selection logic, reference rendering and required-document checks.
- `hooks/hooks.json` -- Stop calls `node_repl.turn_ended`; this is a lifecycle hook,
  not evidence of automatic documentation injection into the system prompt.

Repo provenance/runtime seams:

- `packages/chrome-bridge/vendor/original/{browser-service.mjs,browser-client.mjs,source.json}`
- `packages/chrome-bridge/script/import-original.ts`
- `packages/chrome-bridge/src/original-exports.js`
- `packages/chrome-bridge/src/original-page.ts`

The vendored service contains the original service plus the appended export shim.
The client is a provenance/reference asset, not currently the model-facing API.
Do not modify opaque original service bytes by hand or add a separate Codex runtime.

Readable scratch copies may exist at `/tmp/tandem/original-browser-service.mjs`
and `/tmp/tandem/original-client-readable.mjs`. They have been reformatted by other
work; their line numbers have changed. Verify against the pinned files, and search
by the anchors below rather than relying on old handoff line numbers. Scratch
copies are navigation aids, not the source of truth.

## Verified Original Flow

The canonical skill explicitly initializes a persistent JavaScript session:

```js
const { setupBrowserRuntime } = await import("<plugin root>/scripts/browser-client.mjs");
const agent = await setupBrowserRuntime();
const chrome = await agent.browsers.get("chrome");
nodeRepl.write(await chrome.documentation());
```

It requires the complete documentation to be emitted and read **before the first
browser action**. It specifies an outer output budget of 20,000 tokens when using
the relevant Codex wrapper, forwarding the complete result. Chunk only when
truncation is explicitly reported, then read all remaining content. Do not reread
for the same browser connection merely because a new turn starts.

The delivery is therefore skill instructions followed by a tool-result document
read. Do not describe this as an invisible system-prompt injection. The installed
plugin does not establish every detail of Codex's proprietary prompt assembly.

### Embedded Selection And Rendering

Search the original service for:

- `documentManifest`, `apiManifest`
- `readBrowser`, `readNames`, `assertRequiredDocumentationRead`
- `guidanceNames`, `excludedDocumentation`, `disabledMemberIds`
- `# Selected Browser`, `# Additional Capabilities`, `# Additional Documentation`
- `instruction_overrides`, `requiredFor`

The observed document manager (`Xm` in this pin) does the following:

1. Determines disabled/undocumented API members for the selected browser.
2. Selects guidance and lookup entries from the document manifest using browser
   type, capabilities and disabled APIs.
3. Reads applicable included guidance, respecting documentation exclusions.
4. Renders selected-browser identity, included guidance, a named supplementary
   documentation catalog, available capabilities, and the effective API reference.
5. Records included guidance names in `readNames`.
6. Named `read(name)` validates availability, returns the document and records it.
7. `assertRequiredDocumentationRead(command)` checks manifest `requiredFor` entries.

Trace which commands actually call that assertion and which documents are required.
Do not assume every browser action is guarded just because a guard method exists.
Also trace runtime `instruction_overrides`: bundled defaults are available, but
Codex can substitute some guidance. Do not invent or require unavailable remote
overrides in Tandem.

Topics to locate and evaluate include `api-use-behavior`, `browser-safety`,
`browser-troubleshooting`, `bootstrap-troubleshooting`, `chrome-troubleshooting`,
`browser-control-interruption`, Chrome tab-claiming, visibility/session guidance,
confirmation guidance and capability-specific documents. Read the actual manifest
and strings; this list is a starting point, not a replacement catalog.

The bootstrap skill also requests relevant troubleshooting docs before setup
resets/retries. A missing/stale tab or empty tab list does not mean the browser
disconnected; the original rules distinguish that from an explicit disconnect.

## Implementation Direction

First trace the original client request through the service dispatcher and document
manager, and trace Tandem's actual skill/tool-output path to the model. Then choose
the smallest implementation that preserves the original delivery pattern.

1. **Short bootstrap skill.** Tell the model how to select the configured browser
   and read its complete documentation before interaction. Move the main reference
   out of the bootstrap rather than duplicating it in both places.
2. **Selected-browser document read.** Expose a documented tool equivalent of
   `chrome.documentation()`. An action such as `documentation` on the existing
   browser tool is a possible design, not a mandated or already implemented API.
   It should return actual documentation as model-visible text, not merely a path,
   URI, summary, hash or UI attachment.
3. **Named supplementary reads.** Preserve the source catalog model and on-demand
   topics; include troubleshooting that remains available when connection setup
   fails. Reject unknown/unavailable topic names clearly.
4. **Source-backed content.** Reuse/extract the pinned embedded guidance and
   selection metadata where feasible. Keep provenance and a small, explicit set
   of Tandem adaptations. Avoid another hand-maintained rewrite of all prose or a
   new elaborate documentation framework.
5. **Effective API reference.** Describe the supported Tandem tool surface. Do not
   advertise original methods that the model cannot call (raw evaluation, clipboard,
   file/history APIs, persistent JS variables, etc.). Reuse compatible behavioral
   prose, adapting API examples without implying feature parity that does not exist.
6. **Correct lifecycle.** Match relevant documentation requirements from the
   source. Documentation state must be isolated by trusted session/context and
   appropriate browser/document version; one session's read cannot satisfy another.
   Do not use execution-local tab aliases as the identity of durable documentation.
   A stale tab must not trigger needless rereads or reconnection.
7. **Compaction and reconnect.** Inspect how Tandem retains/prunes skill and tool
   outputs. Prevent a server-side "already read" flag from hiding instructions no
   longer present in model context. Reestablish relevant documentation on genuine
   connection/capability changes; do not dump it into every ordinary turn.
8. **Complete output.** Trace generic output truncation and context budgets in both
   runtimes. Provide explicit continuation if necessary, preserving all content.
   A complete server-side string does not prove complete delivery to the model.
9. **No extra browser approvals for static docs.** Reading trusted bundled guidance
   should not claim tabs, attach debuggers, create a native turn, inspect browsing
   data, or manufacture another permission prompt. Keep configured labels distinct
   from verified browser identity. Reading docs never grants browser access.

Mirroring the delivery system does not require adding `node_repl`, replacing the
existing JSON browser tool or exposing the original host/plugin API wholesale.

## Tandem Integration Map

Inspect current implementations rather than assuming paths are unchanged:

- `packages/core/src/plugin/skill.ts` -- embedded skill definition/registration.
- `packages/core/src/plugin/skill/chrome-browser.md` -- current static guide.
- `packages/opencode/src/skill/index.ts` -- legacy skill registration; previously
  registered this built-in with `location: "<built-in>"`.
- `packages/opencode/src/tool/skill.ts` -- legacy `<skill_content>` output.
- `packages/core/src/tool/skill.ts` -- Core skill output/model conversion.
- `packages/core/src/browser.ts` -- shared browser description/schema and execution.
- `packages/chrome-bridge/src/tools.ts` -- common model-tool adapter and aliases.
- `packages/core/src/tool/browser.ts`, `packages/opencode/src/tool/browser.ts` --
  runtime-specific tool wiring.
- Relevant session/tool-output conversion, truncation and compaction paths in
  Core and legacy; trace imports/callers to find the current path.

### Built-In Skill Resource Bug

At inspection, legacy `tool/skill.ts` computes `path.dirname(info.location)` and
samples files with ripgrep. For `"<built-in>"`, that directory is `.`, causing
unrelated project file paths to appear under `<skill_files>`.

Fix the built-in-resource case as part of clean documentation delivery. Built-in
skills with no filesystem resources must not scan the current project or claim it
is their resource directory. Preserve correct behavior for real on-disk skills
and check both runtime paths. Do not make unrelated user files browser resources.

## Real-Session Acceptance

Capture the actual model-visible tool sequence/content, keeping account data and
credentials out of logs and handoff text. Use real provider/agent sessions:

- A fresh ordinary browser task selects the browser, reads the full document,
  then interacts; it does not need Jon to explicitly request the documentation.
- The returned guidance/reference matches the effective API and includes applicable
  original behavioral guidance and the supplementary catalog.
- A follow-up in the same context does not repeatedly reload the full document.
- A named troubleshooting lookup returns the right source-backed document.
- Missing/stale tabs do not spuriously reset the documentation/browser binding.
- Genuine reconnect or context compaction does not leave the agent operating with
  absent or stale instructions. Verify the actual context route, not just a flag.
- No silent truncation, unrelated `<skill_files>`, extra documentation approvals,
  unsupported API examples or cross-session documentation-state leakage.
- Exercise more than one real website; use reversible tasks and explicit
  finalization. Do not submit account changes solely to test documentation.
- Exercise the normal user-facing runtime first, then the other supported runtime
  via actual session/tool delivery where available. State any unverified path.

If a provider-bound request capture is necessary to prove full delivery, keep it
private under `/tmp/tandem`, omit credentials and distinguish it from merely
reading the persisted chat transcript. Inspect current capture facilities first.

## Completion Report

Report separately:

- Which original source documents/selection rules were reused.
- Which adaptations were necessary and why.
- When and through which tool results the model receives them.
- What state/gating/compaction behavior actually matches Codex versus differs.
- Real-session evidence, observed shortcomings and unverified runtime paths.
- Source-only, built, installed and running status; these are different milestones.

Do not label a larger static skill as completion of this task, or claim exact
Codex prompt-injection parity beyond what the inspected plugin source proves.
