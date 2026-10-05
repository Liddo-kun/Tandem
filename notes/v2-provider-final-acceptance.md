# Final bounded backend/provider acceptance — 2026-10-04

## Result

Completed against existing server4098, PID14283, approximately 13:22–13:27 UTC. Process environment confirms `TANDEM_DUMP_REQUEST=/tmp/tandem/v2/request-dumps/integrated-2` and `TANDEM_CLAUDE_BASH_SEARCH=0`. All four owned sessions ended with a newest `idle` message and outcome `succeeded`.

**Passed:** real Claude and Sol generate + summary-compaction APIs, post-compaction Read calls, Claude final HTTP transport with adaptive thinking and explicit off, outgoing generic GPT/Astra instruction content, and natural OpenAI OAuth refresh followed by a separate successful tool-using prompt and persisted refreshed expiry.

**Unverified:** actual AI-SDK Anthropic bridge (the configured override normalizes to native), Anthropic natural refresh (outside its window at completion), and native `/responses/compact`/in-band compaction. No demonstrated source defect or source-ready fix from this assignment.

No builds, restarts, extra servers, GUI/device operations, low-level tests, auth redo, forced expiry, commits or production changes. No shared implementation files or global configuration were edited. Temporary project config files were reset to `{}` after acceptance; the global Claude plugin, saved provider choices and image OAuth credential were retained.

## Sessions

| Case | Session | Actual result |
| --- | --- | --- |
| Claude adaptive | `ses_ef8ebe4bdffepMi85Ot3PG7MuV` | `anthropic/claude-sonnet-5-5#low`; initial Read, generate, completed manual summary compaction, subsequent Read |
| Claude off | `ses_ef8ebbbfcffevbWRAzZZRQ9Dh1` | `anthropic/claude-sonnet-5#none`; actual completed Read |
| Attempted SDK override | `ses_ef8eb236bffehFfcS0CT8bqDeL` | Actual Read succeeds, but model resolves to native Anthropic |
| Sol | `ses_ef8eb236affeAx7nXJ6ioEh4oU` | `openai/gpt-5.6-sol`; four completed Reads across initial, post-compaction, refresh-window and post-refresh prompts |
| Existing Astra, inspection only | `ses_efa0c9f91ffeAET5Ayj8silsMt` | Persisted successful Read, one PNG user file, three attributed primary dumps; attachment present in final resumed input |

Projects: `/tmp/tandem/v2/provider-final/{native,sdk}`. Safe fixture AGENTS only confines operations to owned scratch and prohibits tests/delegation. Explicit top-level prompt metadata disables Corrector for these fixture prompts.

## Generate and compaction

Used normal `POST /api/session/:id/generate` with `{ "prompt": "Return exactly PROVIDER_FINAL_GENERATE_OK, no other text." }`, and `POST /api/session/:id/compact` with `{}`, followed by normal experimental Session wait.

Both generate calls returned exactly `PROVIDER_FINAL_GENERATE_OK`. That marker is absent from persisted Session history. Both compactions persisted `status: completed`, `reason: manual`, nonempty text summaries, and correct selected models. Claude summary length: 567 characters; Sol: 362. Sol's stored `responseId`/`serviceTier` provider state is ordinary response state, **not proof of native compaction**. Both subsequent prompts completed real Read calls.

Exact final-send files, all under `/tmp/tandem/v2/request-dumps/integrated-2/`:

| Operation | File | Attribution / wire route |
| --- | --- | --- |
| Claude generate | `1791120144034-932cfabf-8e20-4eeb-800f-0e0d949d9357.json` | Own Claude session, build, `kind: generate`, `/v1/messages` |
| Claude compaction | `1791120146107-fd2357e1-d7c2-4c52-9449-692ca9bda78e.json` | Same session/model, `kind: compaction`, `/v1/messages` |
| Sol generate | `1791120202414-532e4ca6-fdd3-4e7e-aff3-db7b6d51f009.json` | Own Sol session, build, `kind: generate`, `/v1/responses` |
| Sol compaction | `1791120205495-f2b2ab34-2bfc-4c66-834d-76a051fedced.json` | Same session/model, `kind: compaction`, `/v1/responses` |

These are actual successful **summary-compaction** workflows. No `/responses/compact` request or native compaction edit was observed; neither is claimed accepted.

## Claude final HTTP probe

Normal Promise plugin: `/tmp/tandem/v2/provider-final/probe/{package.json,server.js}`. Appended by each owned project's plural `plugins` directory list, after the retained global auth plugin. Uses only public `ctx.session.hook("http.request", ...)`, observes the final Request, and does not modify it. Reads a cloned JSON body only to derive thinking/clearing booleans. Never writes headers, token values or request-body bytes. Safe output: `transport.jsonl`.

All ten observed requests pass:

- Authorization is a nonempty Bearer header; `x-api-key` is absent.
- User-agent has `claude-cli/` prefix.
- Canonical HTTPS Anthropic `/v1/messages` URL; query `beta=true` at the actual hook boundary. Diagnostic dumps intentionally strip that query.
- Required `oauth-2025-04-20` and `interleaved-thinking-2025-05-14` beta tokens are present. These match `REQUIRED_BETAS` in the auth plugin's `src/constants.ts`.
- Eight adaptive requests have `clear_thinking_20251015` with `keep: all`, `context-management-2025-06-27`, and `thinking-binding-controls-2026-08-01`.
- Two explicit-off requests have disabled thinking, no clear-thinking edit and no context-management beta. They retain both required auth beta tokens.

Adaptive coverage includes main/tool continuation, generate, compaction, resumed main and the native-normalized SDK attempt. Header/query observations are backed by successful Session results and correspondingly attributed final dumps; success alone was not treated as header proof.

## Actual GPT instructions and tools

Inspected eleven primary requests: eight Sol and three from the existing Astra session. Every request contains the corresponding complete current prompt-file segments surrounding the expanded `${OPENCODE_TOOL_GUIDANCE}` slot (`gpt.txt` versus `gpt-astra.txt`). All pass:

- Jon's licensed-physician, failed-standard-treatment, non-FDA-approved/off-label context.
- Plain communication, scope discipline and no unsolicited caveat/checklist instructions.
- No routine tests by default; high-risk exception and project restrictions retained.
- Actual runtime temp guidance is `/tmp/tandem/v2/tandem`; the directory exists. This is the process's isolated Tandem scratch root, not the fixture project's path.
- Relative Markdown image path, `%20`, no invented URLs/base64, explicit image-capable Read for model inspection; Markdown display alone does not inject image bytes.
- Dedicated-tool guidance expanded, with no unresolved placeholder. Native catalog includes `glob`, `grep`, `imagegen`, `patch`, `question`, `read`, `shell`, `skill`, `subagent`, `webfetch`, `websearch`, `execute`.

Representative Sol first request: `1791120170217-6db1cdd5-da25-47f0-8500-579c0a7b72ce.json`.

Astra first request: `1791101203149-a810748d-830a-4fd7-97e0-3c9552155754.json`. Read-result continuation: `1791101207472-f7f89acc-f585-41c1-a7bc-07396f54ea8e.json`. PNG-containing resumed request: `1791101361662-558d39ce-15ff-4894-acf4-386d4a63ac4b.json`. Existing Session history has one completed canonical Read and one persisted `image/png` user file. No new interaction with that Session or UI was performed.

## AI-SDK route limitation

Own SDK project used:

```json
{"plugins":["/tmp/tandem/v2/provider-final/probe"],"providers":{"anthropic":{"package":"aisdk:@ai-sdk/anthropic"}}}
```

After actual successful Read, queried `/api/model` with each project's `location[directory]`. Both native and SDK projects report `@opencode/ai/providers/anthropic` for the selected model. Evidence: `model-packages.json`.

Source agrees: `packages/core/src/aisdk-native.ts:19–29,54–57,138–145` rewrites recognized AI-SDK Anthropic packages to native. This config cannot exercise the legacy bridge. No alternative package, bypass, new key, architecture expansion or global provider change was introduced. AI-SDK final-send acceptance remains unverified, not failed.

## Natural OAuth refresh

`GET /api/credential` was consumed only in memory. Saved records contain credential IDs, integration IDs, active/type, expiry and SHA-256 hashes; no access/refresh values. Before snapshot: 13:22:00 UTC. Final: 13:26:44 UTC.

### OpenAI — passed

Same active credential `cred_102a66879001KAmCIwGbvgG8Af` throughout:

| Observation | Expiry (milliseconds) | Access SHA-256 prefix | Refresh SHA-256 prefix |
| --- | --- | --- | --- |
| Before, and 13:23:35 | `1791120521278` | `e5dfff323f4ec6b9d` | `f69b152e3f878c02c` |
| 13:24:23, after real Read in normal refresh window | `1791123855987` | `c0d260469dd4b12a2` | `59bff8a00ca5092d8` |
| 13:25:31, after a separate subsequent tool-using prompt; again at final snapshot | `1791123855987` | Same refreshed hash | Same refreshed hash |

The independent subsequent Read is `call_msF1VZHxYPXQ8xPgnw1IIUrD`, persisted completed. Its primary request starts in `1791120323159-d8b650b2-f6b7-4b04-a3c4-550d795e9014.json`; the final inspection includes the following continuation. This establishes rotation + successful use + persisted expiry, not merely concurrent valid calls. No claim is made about which caller won a concurrent refresh lock.

### Anthropic — unverified this run

Same active credential `cred_1056e8291001PlSxUvESRaLAZc`; expiry remains `1791121290889`, both hashes unchanged. Five-minute window begins about 13:36:30 UTC, later than this bounded run. Claude calls before then are successful valid-token calls, not refresh proof. No artificial expiry/time change or duplicate grant was attempted.

`tandem-openai-images` credential `cred_1054217c10010NBQsQxIIleGHI` remains active with unchanged hashes and expiry `1791953579964`.

## Evidence and cleanup

All scratch: `/tmp/tandem/v2/provider-final/`.

- `run.py`: actual create/prompt/wait/generate/compact helper; reuses `live-session.py` API/unwrap.
- `inspect.py`, `inspection.json`: final Session idleness, compaction records, tool IDs, instruction checks, transport checks, dump references.
- `*-session.txt`, `*-evidence.json`, `*-generate.json`, `*-compact-admission.json`: actual API evidence.
- `credentials-{before,after-sol,after-sol-resume,openai-window,after-refresh-tool,final}.json`: safe hash/expiry snapshots.
- `transport.jsonl`: ten credential-safe final HTTP observations.
- `model-packages.json`: location-specific native normalization evidence.

Final inspection: 24 attributed dumps including existing Astra title/main records; all inspected files mode `0600`, no dumped headers, no current credential bytes found in those files by in-memory comparison. This current-token scan is not a blanket claim about every historical credential or every diagnostic file.

Owned project plugin/package overrides were removed by resetting both `opencode.json` files to `{}`. Probe code and evidence remain for reproducibility. All owned sessions were idle/succeeded before cleanup. Global/default provider choice, credentials beyond normal OpenAI rotation, running server and master UI/performance work were not modified.
