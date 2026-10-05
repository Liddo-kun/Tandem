# Claude plugin-only custom-endpoint TLS — 2026-10-04

## Result

**Passed after one external-plugin adapter fix:** real native Claude Read and
generate through an owned loopback self-signed HTTPS reverse proxy; verified-TLS
negative control; another provider's real Read and unchanged catalog; ordinary
process fetch certificate verification; official-endpoint restoration.

All sessions used `/tmp/tandem/v2/live-session.py` API helpers and the normal
create/prompt/wait flow. No mocked model responses or low-level tests. No host/core
changes, builds, GUI/APK work, credential copying, auth redo, forced expiry,
commits or publishing. Exclusive 4098 restart ownership was explicitly authorized.

## Live evidence

Scratch: `/tmp/tandem/v2/tls-live/`, directories `0700`, files `0600`, including
the self-signed certificate/private key. Proxy PID **19629**, bound exclusively to
`127.0.0.1:33481`. Its request body and auth headers existed only in memory. It
forwarded the actual path/query and payload to `https://api.anthropic.com`, using
Python's default CA context with certificate and hostname verification enabled.
Only safe route/header/TLS booleans and response status were logged.

| Case | Session | Result |
| --- | --- | --- |
| Verified custom endpoint, insecure unset | `ses_ef8489ca5ffelA2pXGCrClDT8y` | Idle/failed as expected; `provider.transport`, `DEPTH_ZERO_SELF_SIGNED_CERT: self signed certificate`; zero HTTP requests reached proxy |
| Insecure before adapter fix | `ses_ef846e964ffeY0kmlBlUtTFnTS` | Idle/failed before HTTP; nominal `LanguageModel` schema mismatch |
| Insecure after fix | `ses_ef845c426ffewfeUyIurCwz26v` | Idle/succeeded; completed Read `toolu_0179VdmjVLfzobZaJmXHQUXx`, exact fixture marker; generate returned `TLS_LIVE_GENERATE_OK` |
| Sol while insecure active | `ses_ef8458d26ffeqVfnyW0aT24USz` | Idle/succeeded; completed Read `call_0BfWitNjHM3sYSsmM6fIRGvQ`, exact fixture marker |
| Official endpoint restored | `ses_ef8450a2dffeVSP3sQea9BbUrq` | Idle/succeeded; completed Read `toolu_019spBsiXrZLv66pMWWUPxyZ`, exact fixture marker |

Claude used `anthropic/claude-sonnet-5-5#low`; Sol used `openai/gpt-5.6-sol`.
Prompt metadata disabled Corrector for these owned sessions.

`proxy.jsonl` has exactly three `/v1/messages` upstream responses, all **200**:
initial Claude request, tool-result continuation, and generate. All three show
Bearer present, `x-api-key` absent, CLI user-agent, both required OAuth/interleaved
thinking betas, `beta=true`, and verified official upstream TLS.

Final-send dumps retained in `/tmp/tandem/v2/request-dumps/integrated-2/`:

| Operation | File |
| --- | --- |
| Insecure Claude primary | `1791131008451-6b5d1c31-befd-475c-b8ad-09e9e5b81403.json` |
| Insecure Claude continuation | `1791131010767-113be7da-ab8e-44e3-8b77-d6a089207a57.json` |
| Insecure Claude generate | `1791131020458-f1910527-5fb8-42f8-8719-cce61fb125e9.json` |

`inspection.json` contains the full owned dump index with route, attribution and
file mode, session error, catalog comparisons and restoration checks. The public
project-local Promise probe used only `ctx.session.hook("http.request", ...)` and
an ordinary independent `fetch` to the same self-signed origin. All 18 observations
(control, insecure Claude, Sol and restored Claude) rejected the certificate;
none reached the proxy's HTTP probe handler. This proves ordinary process fetch
verification remained enabled, not API-key or every possible transport isolation.

Catalog comparison covered 40 entries: identical provider/model IDs; every
non-Anthropic entry identical; Anthropic entries differed only in package while
insecure was active. The restored catalog exactly matched verified-control state.
Only hashes and public IDs/package paths were saved, not model settings or keys.
The initial cold catalog call returned zero entries; it was not used as baseline.

## External source fix

Only implementation file changed by this task:
`/home/jon/code/opencode-anthropic-auth-v2/src/insecure-provider.ts`.

The host's compiled model and source-loaded provider use separate nominal
`LanguageModel` constructors. The provider's original prepare calls
`LLMRequest.update`, which rejected the host model. The adapter now reconstructs
that field using the external public constructor while preserving resolved model
ID, provider, route, defaults and compatibility, then delegates to the original
prepare. No global class/schema/fetch patch; no additional transport hook. Existing
final-origin check and per-send `FetchHttpClient.RequestInit` scope are retained.

`V2-TRANSPORT.md` was updated to describe this demonstrated boundary and acceptance.
Auth exchange and refresh source remain unchanged, explicitly
`tls.rejectUnauthorized: true` at their fixed token endpoint.

One post-fix focused typecheck was attempted. It failed in current imported host
sources (`effort-updates`, media, Anthropic compaction, partial JSON, executor,
media-protocol, options and media-type) and existing `src/v2.ts:84,88,91` branded-ID
uses. No error was reported in the changed adapter. These unrelated diagnostics
were not expanded into this assignment. Live packaged workflow acceptance passed.

Master follow-through resolved those source-check diagnostics: v2 auth's tsconfig now matches
the host's `noUncheckedIndexedAccess:false`, and the Promise plugin's type-only `DeepMutable`
preserves branded primitives. External `bun run types --project tsconfig.v2.json` and host Plugin
`bun typecheck` both pass. Evidence: `/tmp/tandem/v2/{auth,plugin}-final-typecheck.log`.

## Unverified and operational observations

- API-key connection isolation: no API-key case available; not exercised.
- OAuth refresh while insecure is active: not induced. Existing Claude credential
  `cred_1056e8291001PlSxUvESRaLAZc` remains active with expiry `1791149798133`, matching
  the previously naturally rotated credential. No token values or hashes saved.
- Summary/native compaction, redirects, media and other custom provider packages
  were outside this bounded run. Generate is the auxiliary coverage here.
- Inotify subscription warnings occurred, but did not block explicit-restart live
  workflows. Limits were never raised: instances **128**, watches **77755**.

## Restoration and exact process ownership

Restart helper `/tmp/tandem/v2/restart-development.py 0` was used throughout. Server
sequence: **10164 → 19798 → 21143 → 21875 → 22324 → 22769**. It verified isolated
roots, terminated the old server, and bounded old-PID cleanup before each launch.

Final healthy **4098 PID 22769** is the sole process whose arg0 is the isolated
development binary and whose arguments contain `serve`. `/api/session/active`
returned `{}`. Both `ANTHROPIC_BASE_URL` and `ANTHROPIC_INSECURE` are absent from its
actual environment. `TANDEM_CLAUDE_BASH_SEARCH=0` and
`TANDEM_DUMP_REQUEST=/tmp/tandem/v2/request-dumps/integrated-2` remain in place.

Official-endpoint Read passed on PID 22324. The final restart to 22769 removed the
temporary project observation plugin from memory after its `opencode.json` was
reset to `{}`. Proxy PID **19629** was identity-checked and stopped by exact PID;
no other proxy/process was targeted. Reusable scratch source/evidence remains.

Daily **4097 PID 23799** remained present and its health endpoint returned 200
throughout restarts. Its binary, credentials and configuration were untouched.
Isolated `environment.json` and global provider/search configuration were not
edited; the existing Exa default was preserved. Final provider inventory includes
Exa. No APK, CLI binary, device or persistent watcher-limit changes.
