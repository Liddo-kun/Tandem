# Browser Documentation Delivery Results

## Status

Implemented in source on 2026-09-12 (tablet local date). Real legacy model/tool
acceptance passed through an isolated source HTTP server and private Chromium.
Core and bridge focused typechecks passed. No low-level tests were written or
run. No subagents were used. No production server/browser restart,
native-registration change, or journal deletion was performed.

**Built and installed at Jon's request; awaiting his manual Tandem restart.**
Version `0.0.0-dev-202609112131`, installed at `/usr/local/bin/tandem`, includes
the embedded web UI. The build/version smoke check passed and the installed
binary exactly matches the build artifact. V2 real-model browser acceptance
remains blocked at provider setup; this is not a claim of V2 verification.

- Installed SHA256: `5a3bca2fbd74d5a01ddda17b919f1923b7534bda947b10176474c1414be40c64`.
- Rollback: `~/.local/share/tandem/chrome-rollout-20260912/documentation-2131/tandem.before`.
- Rollback version: `0.0.0-dev-202609111958`.
- Rollback SHA256: `a30ea9b10c2a335622889da54b179bfa25159befc1b9d455a2c674bdc277d370`.
- After installation, production health remained healthy on
  `0.0.0-dev-202609111958`, confirming the running server was not restarted.
- Build log: `/tmp/tandem/browser-documentation-install-build.log`.

The binary was staged beside the install target and renamed into place so the
running executable was not overwritten. No native-host or Chromium update is
needed for this documentation-only runtime change.

## Source Reuse

The importer verified the installed service SHA256
`3027e8e47d3241f8fde99078a9ced4647ac1732b614b3704628405236f8ac18b`
against `vendor/original/source.json`. The original service bytes are unchanged;
only the reviewed appended export shim adds access to the embedded documentation
object and the original `kB` document selector. No separate Codex runtime is used.

Original flow traced: client `Browser.documentation()` sends
`GetBrowserDocumentation`; service `Qw` resolves the browser and calls
`Xm.readBrowser`. Named `GetDocumentation` goes through `r0` to `Xm.read`.
`VB` calls `assertRequiredDocumentationRead` in the common dispatcher. The pinned
manifest's required commands are raw CDP, WebMCP, and browser-auth handoff, none of
which Tandem exposes. It does not hard-gate ordinary click/inspect/navigation on
the full-browser documentation read; the canonical bootstrap imposes that rule.

Reused included documents:

- `browser-safety`
- `tab-claiming-chrome`
- `tab-cleanup-chrome`
- `browser-control-interruption`
- `api-use-behavior`

Named supplementary catalog:

- `browser-troubleshooting`
- `local-web-development`
- `screenshots`
- `bootstrap-troubleshooting`
- `chrome-troubleshooting`

The manifest selector receives extension browser type, no original capability
objects, and only the original claim/keep member names with exposed Tandem
equivalents. Consequently session naming, AX, visibility and WebMCP guidance are
not included. File-chooser guidance is unavailable; the extension-only upload
troubleshooter is explicitly excluded too because Tandem exposes no uploads.
Included guidance names may also be read individually. Unknown/unavailable
topics return `documentation_unavailable` and the valid names.

## Adaptations

- At Jon's request, the bundled `confirmations` policy is excluded from both
  full documentation and named reads, and the confirmation-policy directives in
  `browser-safety` are removed. The docs no longer impose a separate action-time
  reconfirmation policy for an explicitly requested task. User-scope boundaries,
  untrusted-page handling and actual browser access permissions are unchanged.
  This removal is source-only until the next build/install; earlier acceptance
  and installed-version records below describe the preceding document.
  Real model session `ses_f6d6138c4ffeJ5wFOyoIsPjQUn` verified that the complete
  guide lacks both policy headings and a named `confirmations` read returns
  `documentation_unavailable`. Provider-bound capture exactly matched the
  13,620-character result. No browser pages were accessed. Evidence:
  `/tmp/tandem/chrome-doc-live/no-confirmations-transcript.json`.
- Persistent JavaScript bindings, client method calls, node IDs and reload
  examples become configured browser IDs, execution-scoped aliases and actual
  JSON-tool actions. History access guidance is removed because it is unavailable.
- Tab cleanup uses explicit `finalize`; automatic fallback preserves unfinished
  tabs. Handoffs remain resumable, deliverables are released to the user. Unlike
  the original latest-mark-wins behavior, Tandem rejects conflicting keep marks.
- Codex installation scripts, MCP startup auto-repair, launches and environment
  overrides are not advertised. The Chrome troubleshooting document necessarily
  has a larger transport-specific adaptation, preserving applicable failure and
  no-fallback guidance. It does not prescribe journal deletion or lease takeover.
- Screenshots use Tandem's managed PNG channel, not a fabricated final-response
  image URL. Availability includes both trusted capture configuration and the
  invocation model's image capability.
- A small effective API reference describes only Tandem's exposed arguments,
  permissions, coordinate mapping, targeting, lifecycle and error outcomes.
- Compatible prose is taken directly from the embedded source at runtime. Exact
  replacement assertions fail closed if the pinned wording no longer matches.
  Codex's `instruction_overrides` and request-metadata confirmation replacement
  are not available and are not invented here.

## Delivery And Context

The short shared bootstrap and browser tool description require a complete
`documentation` result before interaction. Static reads run before connection or
native-turn acquisition. Both existing runtime leaves deliver this as normal
text, with no filesystem indirection, screenshot attachment, native access or
documentation-specific approval. A configured label is not verified identity.

No durable/global `readNames` or already-read receipt is introduced. Normal model
history owns the read, isolated by the existing trusted runtime/session context.
There is no new hard gate on ordinary browser operations; this mirrors the
original's instruction-driven requirement for those operations, not its guards
for unavailable privileged APIs. A model can still disobey instructions.

Legacy pruning protects skill output but not generic browser output. Both
compaction implementations abbreviate tool content and may remove the full
document from the active context. The always-available tool description and
bootstrap require rereading when full text is absent, including after compaction,
pruning, changed model/capabilities or a genuine reconnect. They do not rely on a
server-side flag surviving context loss. Stale tabs do not invalidate guidance.

Both generic model-output boundaries default to 2,000 lines / 50 KiB and allow
configuration overrides; these budgets are not increased or bypassed. Responses
include a content-version marker, character ranges and end/continuation marker.
Explicit `offset`/`limit` chunks recover the complete document when generic
truncation removes its end. Offsets are JavaScript string character indices, not
UTF-8 byte offsets. A slice reaching the end does not assert earlier slices were
read; the agent is instructed to consume every character.

Built-in skill output no longer claims `.` or `/builtin` as its resource
directory. Legacy skips ripgrep for `<built-in>`; Core retains its real-SKILL.md
resource rule and suppresses virtual-directory/resource presentation. Actual
filesystem skills keep their existing scans and path resolution.

## Real Sessions

Baseline used this ordinary agent session's real browser tools on Example Domain
and IANA. It confirmed the old static skill's unrelated `<skill_files>` leak and
successful page interaction/cleanup without selected-browser documentation.

Candidate verification used normal HTTP-admitted sessions with genuine
`openai/gpt-5.6-sol`, not a scripted provider or direct controller call:

- Source server on loopback `4117`; private browser/host/registration under
  `/tmp/tandem/chrome-bridge/doc12`. Only unmodified installed extension assets
  were copied, not the user's profile/account data. The preparation script built
  a host solely to load the implementation for live verification. No smoke or
  low-level fixture tests were run.
- The first source attempt against the production binding returned
  `controller_busy`. It read full and named troubleshooting documents without
  browser approval; no takeover was attempted. The private binding resolved that
  verification blocker without changing production ownership.
- Initial acceptance configuration accidentally let an inherited wildcard deny
  hide `skill`; those model runs are not bootstrap/resource proof. Correcting
  the private build-agent permission exposed it. No product permission code was
  changed for this.
- Fresh session `ses_f6dbb1748ffe5DYJ62gy7jkHHR`: skill -> browsers -> complete
  documentation -> real Wikipedia search and httpbin form input/verification.
  Scientific name was read, synthetic customer name and Medium pizza verified,
  form not submitted, both temporary tabs closed with native-confirmed cleanup.
  Exactly two site approvals, none for documentation. Skill output had an empty
  resource list and no resource directory.
- Same-session Example Domain follow-up: create -> inspect -> finalize, no
  repeated skill/documentation reads. Named `browser-troubleshooting` returned
  the adapted source document and correctly distinguished missing tabs from
  disconnects.
- Actual legacy summarize/compaction with private `tail_turns: 0`, followed by
  an ordinary Example Domain request: skill -> browsers -> complete documentation
  before create/inspect/finalize. This exercised real active-context replacement.
- Session `ses_f6dad04e6ffeajtkctRujZv9aK`, private output limit 8,000 bytes:
  initial full documentation output was explicitly truncated, with no end
  marker. The model then read ranges 0-7000, 7000-14000 and 14000-17375, all
  untruncated, before interacting. The same session rejected an unknown topic
  without page access; an old tab alias returned `stale_handle`, followed by
  successful fresh-tab use without a documentation reload.
- Only the private Chromium was closed and reopened, with journals preserved.
  The same session first received `browser_unavailable` and read named connection
  troubleshooting; after reopen it reread all three documentation chunks before
  successful page inspection and native-confirmed finalization. Production
  Chromium was not restarted.

Private evidence lives in `/tmp/tandem/chrome-doc-live/*-transcript.json` and
`*-approvals.json`. `/tmp/tandem/chrome-doc-provider.jsonl` contains only extracted
documentation strings and minimal transport status, not request headers or
credentials. A preload flag alone did not run the capture hook, so an isolated
entry wrapper explicitly imported it before the normal server entrypoint.
Subsequent WebSocket send capture exactly matched the complete 17,872-character
model tool output (including its end marker), proving delivery beyond persisted
transcript storage. Earlier pre-capture runs alone do not prove wire delivery.
The final review also corrected original latest-mark-wins prose and explicitly
documented the top-frame-only parameter; the final-source read is recorded
separately from the earlier workflow artifacts.

Final-source session `ses_f6da56c11ffeNlAsPrzZSL2nwE` again performed skill ->
browsers -> complete documentation -> Example Domain -> observed Learn more link
-> IANA heading -> native-confirmed finalization. The final 17,970-character
(17,980-byte) full tool result exactly matched provider-bound captured text;
SHA256 `dc2d1e812c97f2606bd919262837509625ef74c8e3642ff4a2a774e627771bd6`.
The isolated source server and private Chromium were shut down after verified
cleanup. Private journals and evidence were preserved, and the production
native-host manifest SHA256 still matched its pre-verification value.

## Remaining Verification

V2 `/api/session` accepted real prompts but could not complete provider setup:

- `ses_f6db583b8ffencdSjaTta6fi5x`: `ModelUnavailableError` for
  `openai/gpt-5.6-sol`; the V2 available-model endpoint exposes only `opencode`
  models in this environment, unlike the legacy catalog.
- `ses_f6dab75b8ffeHDimWK0lwUncxO`: an advertised
  `opencode/minimax-m2.5-free` model returned HTTP 401 with "Model ... is not
  supported". No browser tool executed in that session.

These are real-session blockers, not substituted synthetic tests. V2 bootstrap,
model-bound full-text delivery, low-budget continuation, compaction and native
workflow remain unverified. No credential/catalog migration was folded into
this browser-documentation task. A known-working V2 provider connection is needed
to finish that acceptance path before claiming both runtimes fully verified.

The candidate is installed with rollback, but production activation and a
post-restart live check remain pending Jon's manual Tandem restart.
