# Tandem request inspection — source handoff

Implemented 2026-10-04 in the isolated v2 worktree. **Live acceptance pending**; the master owns builds and live runs. No low-level tests, CLI builds, server restarts, device operations, commits, dependency changes or lockfile edits were performed by this worker. Focused AI and Core typechecks passed for the initial implementation; logs are `/tmp/tandem/v2/request-dump-{ai,core}-typecheck.log`. The follow-up signature/AI-SDK fixes below have not run additional checks, per Jon's instruction; master live validation is next.

## Files and ownership

- `packages/ai/src/tandem/request-dump.ts`: Tandem-owned opt-in writer, credential exclusion and fiber-local attribution reference.
- `packages/ai/src/route/executor.ts`: capture in the innermost native HTTP handler after per-call middleware.
- `packages/ai/src/route/transport/websocket.ts`: capture immediately before the concrete socket's `ws.send(message)`.
- `packages/core/src/session/model-request.ts`: supply attribution to final HTTP handlers and to WS execution/frames. Primary/title/generate/compaction share this seam; child requests identify their own Session and Agent.
- `packages/core/src/aisdk.ts`: ownership granted by Jon for the follow-up; inspect the legacy SDK bridge's innermost fetch handler after body overlays and HTTP hooks.
- This handoff document; master-owned `v2-progress.md` and acceptance checkboxes are untouched.

Pre-edit status showed no overlap in these source files. Ownership was announced before edits; Android/app and research prompt/child-hook files are untouched. Effect APIs were checked against the shared `/home/jon/.local/share/tandem/repos/github.com/Effect-TS/effect-smol` reference.

## Final-send pipeline

1. Core resolves provider/model/variant and captures `Tool.snapshot`: permission-visible direct tools plus Code Mode `execute`. Code Mode's catalog is instruction/discovery content, not an extra native tool list.
2. `SessionModelRequest.prepare` runs session context/compaction/generate/title hooks; definition identity/key matching retains internal names for alias resolution. `model.request` can change endpoint/headers.
3. AI `route/client.ts:prepareRequest` resolves route defaults and options, sanitizes surrogates, deduplicates tools, projects schemas (`ToolSchemaProjection.tools`), applies effort updates and cache policy, and merges route headers.
4. `compile` lowers canonical `LLMRequest` through `route.body.from`, validates the native body schema and prepares transport. HTTP transport merges the final `http.body` overlay, JSON-encodes and applies authentication. **This compiled body is not a final-send dump.**
5. HTTP: `session.http.request` may replace the body/URL/headers. `RequestExecutor.layer` captures the final `HttpClientRequest` passed to its innermost handler, immediately before `http.execute`. This includes the native HTTP fallback and `/responses/compact` path. The standard Effect Fetch HTTP client then renders/sends the body; injected HTTP clients can perform their own later transformations (outside this boundary).
6. WS: Responses transport removes `stream`, `stream_options`, and `background`, constructs `response.create`, and the continuation driver may reduce it to an incremental request. Core runs `experimental.ws.handshake` and then `experimental.ws.send`. The concrete AI socket captures the resulting message immediately before `ws.send`; reused channels and full retries pass this boundary again.
7. Legacy AI-SDK: `prepareOptions` merges the SDK model-body overlay; `throughMiddleware` applies the same per-request HTTP hooks. Its innermost handler now calls `RequestDump.http(sent)` immediately before the existing outgoing fetch operation. Attribution provided by Core's HTTP middleware survives the bridge's Effect/async-context handoff. No request streams are newly read, cloned or materialized by diagnostics; the bridge's existing fetch serialization is unchanged. When dumping is enabled, normal Session preparation supplies this middleware even without installed HTTP hooks.

Dumps are labelled `boundary: "final-send-attempt"`: the exact JSON message selected for an attempted send, subject to documented redaction. They do not assert successful network delivery. No internal snapshot is emitted. No incoming stream, event ID, call ID, checkpoint or payload is rewritten. HTTP request streams are never read by diagnostics. The WS wrapper preserves the live HTTP-context getter used by fallback handling.

## Output, credentials and failures

`TANDEM_DUMP_REQUEST=<directory>` is read in the model-executing process. Unset/empty means disabled. New directories use mode 0700 and unique JSON files mode 0600; existing directory permissions are not changed.

Each record contains time, transport, sanitized endpoint, HTTP method when applicable, `{ sessionID, agent, model: { providerID, modelID }, kind }`, and the final decoded provider body (including tools). Core's model attribution is the selected catalog model; the body's `model` field shows the actual wire model/deployment when present.

- No request/response headers, cookies, handshake headers or credentials/config objects are written.
- Endpoint and standalone URL values omit userinfo, query and fragment. Credential-named scalar fields are redacted; JSON Schema property names/objects are retained. This is transport credential exclusion, not a transcript sanitizer for secrets deliberately included in ordinary prompt prose.
- `signature` is not treated as a credential key. Provider signatures and `redacted_thinking.data` remain verbatim opaque values for round-trip inspection.
- Only model sends carrying `RequestDump.Current` attribution are eligible. Login/refresh, generic asset downloads and other unscoped traffic are excluded, including unknown custom auth paths. Recognized auth endpoint paths/hosts, OAuth `grant_type` bodies and auth WS frame types are additionally excluded.
- Serialization/directory/file failures are caught. At most one fixed warning is logged per process; exception details, endpoint and body are never logged on this path. Provider execution continues. File operations are synchronous and opt-in; diagnostics add local I/O latency before sending.

## Coverage and gaps

| Path                                                                | Source coverage                                                                                                                                                                               |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native AI JSON HTTP, after session HTTP hooks                       | Captured with attribution                                                                                                                                                                     |
| Native primary and child requests                                   | Captured on their actual HTTP/WS transport                                                                                                                                                    |
| Title, generate, summary compaction                                 | Captured via shared preparation/HTTP middleware                                                                                                                                               |
| Responses native `/compact` and in-band compaction                  | Native executor/socket covered; real acceptance pending                                                                                                                                       |
| Responses WS full/incremental/retry; WS-to-HTTP fallback            | Concrete sends covered, including post-send-hook frames                                                                                                                                       |
| WS handshake                                                        | No credential-bearing handshake dump; resulting endpoint appears on outgoing frame records                                                                                                    |
| Stream, multipart and non-string raw HTTP bodies                    | Omission record, never consumed or replayed; not claimed as captured final bodies                                                                                                             |
| Non-JSON bodies/WS frames                                           | Omission record; opaque text is not persisted                                                                                                                                                 |
| OAuth/auth endpoints and unscoped provider/media/download calls     | Intentionally excluded                                                                                                                                                                        |
| Legacy AI-SDK bridge (`core/src/aisdk.ts`)                          | Captured in the innermost outgoing fetch handler after SDK overlays and session HTTP hooks, with the same attribution. |
| Third-party transport extensions | Custom WS connectors/channel executors bypassing the concrete AI socket, or custom fetch implementations transforming further inside their own implementation, require extension-owned final-send instrumentation. These are extension limitations, not normal runtime gaps. |
| Future browser-reader/corrector sessions                            | Covered if using normal Session preparation; direct unscoped AI calls need explicit attribution                                                                                               |

## Master real-session acceptance prescription

Build/stage this source through the established launcher when scheduled. Set the variable on the **server/private spawn**, not merely on a client connected to an already-running server. For the master-scheduled registered server:

```sh
TANDEM_DUMP_REQUEST=/tmp/tandem/v2/request-dumps \
  /home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun script/tandem-v2.ts serve
```

No restart is requested by this handoff. The already-proven isolated `--standalone` workflow is suitable for independent acceptance without replacing either registered server:

```sh
env -u TANDEM_DUMP_REQUEST \
  /home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun script/tandem-v2.ts cli \
  run --standalone --model openai/gpt-5.6-sol --format json \
  'Read notes/v2-port.md lines 179–190 with the read tool, then use shell to run pwd. Report the heading and directory.'

TANDEM_DUMP_REQUEST=/tmp/tandem/v2/request-dumps \
  /home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun script/tandem-v2.ts cli \
  run --standalone --model openai/gpt-5.6-sol --format json \
  'Read notes/v2-port.md lines 179–190 with the read tool, then use shell to run pwd. Report the heading and directory.'

TANDEM_DUMP_REQUEST=/proc/tandem-v2-request-dumps \
  /home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun script/tandem-v2.ts cli \
  run --standalone --model openai/gpt-5.6-sol --format json \
  'Read notes/v2-port.md lines 179–190 with the read tool, then use shell to run pwd. Report the heading and directory.'
```

Run from `/home/jon/code/Tandem-v2`. `/proc/tandem-v2-request-dumps` is an intentionally impossible output location; no permissions/root edits are needed. Capture the session JSONL and server logs under `/tmp/tandem/v2`; standalone normally suppresses server stderr, so use `--print-logs` to observe the fixed warning if desired. Passing requires actual tools and a completed answer in all three modes, no new files/warnings in disabled mode, and successful execution despite the unwritable target. Do not mistake absent dumps from an old staged binary for disabled-mode acceptance.

For final transformation acceptance, use the prepared normal plugin below **last** in isolated configuration. Its public `http.request` and `experimental.ws.send` hooks mark final bodies and tool descriptions. These are real provider requests, not a mocked endpoint. Verify the dumps contain each applicable post-hook marker and projected tool schema; the provider still performs `read` and `shell`. Remove the temporary plugin after acceptance. Include a normal legacy AI-SDK HTTP model session to validate the newly closed bridge path, and a real Anthropic thinking round trip to confirm preserved signatures/opaque content when credentials are available.

Exercise native HTTP explicitly using the isolated OpenAI provider `settings.transport: "http"` overlay; repeat disabled/enabled/unwritable. Then use `settings.transport: "websocket"` (ChatGPT/OpenAI default) and repeat all three modes when the endpoint accepts WS. Resume an enabled Session with a second tool-using prompt to exercise a reused channel/incremental request. Verify outgoing `response.create`, absent WS-disallowed fields, and that primary tool results continue with unchanged call IDs. A WS fallback record is HTTP coverage, **not** proof of WS acceptance; record unavailable WS as unverified.

For auxiliary coverage, let a new Session generate its title, exercise a real Session `generate` request, request compaction through the ordinary session workflow, and run a tool-using child. Check recorded `kind`, child Session ID/Agent and actual wire route for each. Record any unavailable auxiliary route as unverified. Inspect JSON files structurally for absent headers/query/userinfo and auth records; locally compare against the stored access/refresh/API credentials without printing those values. Save only pass/fail and counts. Check newly-created file/directory modes. Record request transports/counts, Session IDs, completed tools, write-failure outcome and all gaps in the master ledger before checking §3 complete.

### Prepared normal acceptance plugin (not loaded)

Directory: `/tmp/tandem/v2/request-inspection-plugin`. `server.js` exports a normal `{ id, setup }` Promise plugin and uses only public `ctx.session.hook` registrations. `package.json` supplies ESM mode; no dependencies/install are needed. Current configured local plugin paths must be **directories**, not standalone script paths (`config/plugin/source.ts`).

Merge the following fragment into the master's isolated config only when scheduling live acceptance, appending this plugin after other configured plugins:

```json
{
  "plugins": ["/tmp/tandem/v2/request-inspection-plugin"],
  "providers": {
    "openai": {
      "settings": { "transport": "http" }
    }
  }
}
```

WS selection is exactly `"providers": { "openai": { "settings": { "transport": "websocket" } } }`. Both values come from `Provider.Transport` in `packages/schema/src/provider.ts`, referenced by `ConfigProvider.Settings` in `packages/schema/src/config/provider.ts`. Use **plural `providers`/`plugins`** from current `packages/schema/src/config.ts`; transport is a provider **settings** field. Ready-to-merge files: `/tmp/tandem/v2/request-inspection-plugin/{http,ws}.json`. Preserve the existing config/plugin list rather than replacing it wholesale. The development launcher clears `OPENCODE_CONFIG` and `OPENCODE_CONFIG_CONTENT`, so setting those outside it is not an overlay mechanism.

Enable the plugin on the model-executing server/private spawn with:

```sh
TANDEM_REQUEST_ACCEPTANCE=1 \
TANDEM_REQUEST_ACCEPTANCE_PROVIDER=openai \
TANDEM_REQUEST_ACCEPTANCE_MODEL=gpt-5.6-sol \
TANDEM_DUMP_REQUEST=/tmp/tandem/v2/request-dumps \
  /home/jon/.local/share/tandem-v2/toolchain/bun-1.4.2/bin/bun script/tandem-v2.ts cli \
  run --standalone --model openai/gpt-5.6-sol --format json \
  'Read notes/v2-port.md lines 179–190, then use shell to run pwd. Report the heading and directory.'
```

Optional `TANDEM_REQUEST_ACCEPTANCE_SESSION=<session ID>` further narrows both hooks to an existing acceptance Session; otherwise the explicit environment flag plus provider/model filter scopes the private run. Use another explicit provider/model pair for legacy SDK or Claude acceptance. The plugin is inert without `_ACCEPTANCE=1`; it does not register hooks. No config was changed to load it, and no provider requests were sent.

Expected markers: `TANDEM_FINAL_HTTP_BODY_MARKER`, `TANDEM_FINAL_HTTP_TOOL_MARKER`, and the corresponding `WS` forms. Body marking supports Responses instructions, Anthropic system blocks, and Chat-shaped messages; description marking supports flat, function-wrapped and namespaced tool schemas. It preserves tool names, argument schemas, historical tool calls/results, signatures and opaque thinking. HTTP transformation parses a **clone** of the hook's JSON request and replaces the request; WS transformation parses/replaces the outgoing JSON frame. These deliberate plugin transformations do not add stream consumption to diagnostics.

## Later Claude mapping seam — before validation

Outbound mapping belongs on a request-local copy after catalog filtering and before native protocol lowering/schema projection. Map definitions, selected top-level properties/required keys, tool choice and structured historical tool calls/results together. Keep the captured internal execution snapshot unchanged. Session context hooks can alias a definition by moving its original definition object to a new key (`model-request.ts` identity mapping), but that alone does not reverse parameter-key changes or canonicalize persisted streamed events.

Inbound reverse mapping belongs at the structured common-event boundary after protocol JSON parsing and **before** `runner/step.ts` calls `publisher.publish(event)`. Prefer a request-local route/event wrapper for Claude rather than changing all providers or rewriting raw SSE. Map `tool-input-start` names and final local `tool-call` name/input consistently; leave argument delta bytes alone until the complete structured input can be reversed. Preserve IDs, provider-executed flags, text/thinking/signatures, opaque provider context and non-tool events. Canonical history then maps outward on subsequent requests without double renaming.

Actual execution order is `step.ts` publish → prepared `executeTool` → `Tool.Snapshot.execute` → `beforeExecute` hook → advertised-definition/internal-name lookup → `tool/runtime.ts:decodeInput` → leaf permission/execution. Reverse mapping after `decodeInput` is too late; an execution-only repair hook also leaves publication/history in provider spelling.

Code Mode is not a bag of extra native definitions: `Tool.snapshot` advertises `execute({ code })`, while `CodeModeTool.runtime` exposes the separate exact-path `tools` catalog and validates its host tool inputs. Keep that internal catalog/program contract canonical unless deliberately adapting discovery and runtime aliases together. Do not regex-rewrite JavaScript programs. Map only the native `execute` wrapper's presentation if using the initial-capitalization fallback. Current subagent tool is not an assumed v1 `task` name; choose mappings from the actual captured catalog (`subagent`, `shell`, `patch`, etc.). Coordinate shell-search catalog filtering before Claude presentation.
