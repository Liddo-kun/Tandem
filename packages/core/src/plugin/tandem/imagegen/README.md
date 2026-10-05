# Imagegen v2 source handoff

Native OAuth generation has now produced real files, but its terminal tool state failed to persist.
The bounded follow-up fix is source-ready, awaiting a master-scheduled rebuild and real acceptance.
See **First-generation terminal-state diagnosis** below; earlier source-only handoffs are historical.

## Files and integration

- `plugin.ts`: Effect v4 plugin, current credential selection, dynamic tool/skill registration,
  permissions, credential refresh delegation and text/metadata-only results.
- `auth.ts`: separate Codex browser PKCE/manual callback login and refresh implementation.
- `imagegen.ts`: OpenCode public image API for API keys, native Codex Images and masked Responses transports;
  PNG validation, observed dimensions/alpha, JPEG/WebP display copies and non-overwriting saves.
- `photon.ts`: lazy codec using v2's existing `#photon-wasm` packaging boundary.
- `description.md`, `imagegen-skill.md`: bundled tool description and skill.
- `packages/session-ui/src/tools/imagegen.tsx`: authenticated local-image Blob preview and lightbox.
- `packages/session-ui/src/tools/tool-renderer.tsx`: only the imagegen import/export and registry
  registration were added by this worker; existing webfetch edits belong to their prior owner.

Master should add to `core/src/plugin/internal.ts`:

```ts
import { ImagegenPlugin } from "./tandem/imagegen/plugin.js"
import { ImagegenAuth } from "./tandem/imagegen/auth.js"
```

Add `ImagegenAuth.AuthPlugin` followed by `ImagegenPlugin.Plugin` in `pre`, after `BrowserFetchPlugin.Plugin` and before
`WebSearchTool.Plugin`. This is after provider methods and built-in skills, and before
`ConfigSkillPlugin.Plugin` in `post`, so configured/user skills override the bundled `imagegen` ID.
No `post` plugin or new service/layer entry is needed: required services are already supplied by
the internal plugin host. The public wildcard Core export already covers this module.

Session UI already imports/exports `ImagegenRenderer` from `./imagegen`, and registers
`{ name: "imagegen", render: ImagegenRenderer }` immediately after webfetch and before websearch.
There are no dependency/lockfile changes required: Photon and `#photon-wasm` already exist in Core.

## Credential and schema contract

Priority is the latest stored `openai` API key (active keys sort last), `OPENAI_API_KEY`, then the
active OAuth connection belonging to **`tandem-openai-images`**. Keys use v2's Credential service.
The image OAuth value must have method `codex` and metadata `clientID` equal to
`app_EMoamEEZ73f0CkXaXp7hrann`. No OAuth credential from `openai` is considered. With only the normal
conversation token-sharing login, neither the bundled tool nor bundled skill is advertised.
User-authored skills remain user-owned and can override the bundled skill.

Jon approved this separate login after refreshed conversation credentials failed all three probes:
public Responses 400 `subscription_sharing_unsupported_capability` for `image_generation`, public
Images 401 `hardened_oauth_rule_missing`, native Codex Images 401 `no_matching_rule`. These are
evidence against reusing conversation credentials, not proof that the new login works in v2.

The auth plugin only registers a separate integration/method. It does not register chat models,
alter `openai`, switch its active credential, or add conversation transport hooks. Saving/activating
an image login affects only `tandem-openai-images`.

OAuth refresh/persistence is delegated to `ctx.integration.connection.resolve`. Its normal five-minute
expiry window invokes this method's refresh handler at `https://auth.openai.com/oauth/token` with the
Codex client ID. Returned access/refresh tokens, expiry and optional account routing ID are saved by
the host. An omitted rotated refresh token retains the existing one; initial login requires one.
JWT claims are decoded only as routing hints, never used as verified identity. No v1 credential
imports, direct auth-file reads, token copying, or independent credential writes are used.

The current host does not serialize `connection.resolve`. A module-level keyed mutex wraps the
image tool's complete host resolution (read → refresh → save), shared across Location instances.
Resolution is uninterruptible once admitted to the lock, with a 30-second token HTTP timeout, so
tool cancellation cannot discard a successfully rotated token before host persistence. Waiting
calls remain interruptible. The image engine receives only access/client/account routing material,
never the refresh token. This is process-local coordination; independent processes sharing one
credential database, or other plugins directly resolving the same credential, are not serialized
by this image-tool lock. The host refresh ownership/API is unchanged.

API controls require width/height (positive multiples of 16, each at most 3840; aspect at most 3:1;
655360–8294400 pixels) and optional quality `medium|high|xhigh|max` (default high). Both modes expose
prompt, at most ten input paths, a first-input PNG alpha mask and transparency (default false).
Input paths use Location/session-directory resolution and upstream read/external-directory policy.
Masks must decode, match the first source dimensions and contain editable alpha pixels.

Credential updated/switched events reload the tool and skill together. Prompt admission rechecks
availability; the request context checks that the captured schema matches the current mode and
removes stale definitions rather than advertising invalid controls. A mode switch during an
already-advertised call fails explicitly; the next snapshot receives the new schema.

## Login API and callback constraints

Registration is master's change in `core/src/plugin/internal.ts`; keep both auth and tool plugins.
The auth integration remains discoverable even with `TANDEM_IMAGEGEN=0` (which disables tool/skill).
Use the existing authenticated v2 API with the same Location query on every request:

1. `GET /api/integration/tandem-openai-images` lists **OpenAI Images (ChatGPT)** and method `codex`.
2. `POST /api/integration/tandem-openai-images/connect/oauth` with
   `{"methodID":"codex"}` (optional `label`) returns an attempt with `mode:"code"`, `attemptID`,
   authorization URL, instructions and a five-minute expiry. Jon opens/authorizes that URL.
3. `POST /api/integration/tandem-openai-images/connect/oauth/<attemptID>/complete` with
   `{"code":"http://localhost:1455/auth/callback?code=...&state=..."}` submits the **entire callback URL**.
   This invokes the existing host completion/persistence flow; never write credentials by hand.
4. `GET /api/integration/tandem-openai-images/connect/oauth/<attemptID>` reads status;
   `DELETE` at that path cancels. Attempts are in-memory and must finish on the same running host/Location.

Plugin API equivalents are `ctx.integration.oauth.connect({integrationID, methodID})`,
`.complete({integrationID, attemptID, code: fullCallbackURL})`, `.status(...)`, `.cancel(...)`.

This ports v1's Codex client, authorization/token endpoints, scope (`openid profile email offline_access`),
S256 PKCE and authorize flags. It uses the normal v2 **manual callback** mode rather than
v1's process-global callback server: every attempt owns its own random verifier/state. It does not open
a browser or listen on port 1455. The fixed registered redirect is exactly
`http://localhost:1455/auth/callback`; a browser connection-refused page after approval is expected.
Copy its address bar into the completion form. A remote browser can use the same procedure.
Do not have another Codex/OAuth listener on that port while authorizing, since it could consume the redirect.

Bare codes, a different redirect origin/path, fragments/userinfo, duplicate/missing state or code,
state from another attempt, provider errors, and expired callbacks are rejected before token exchange.
No `code#state` shortcut or automatic callback listener/device-code method is implemented.
An invalid submitted callback can settle the host attempt as failed; start a fresh attempt.
Authorization codes, full callback URLs and returned tokens must stay out of evidence/logs.

Environment controls:

- `TANDEM_IMAGEGEN=0|false|off|no`: disables the bundled tool and skill.
- `OPENAI_API_KEY`: second-priority key, reevaluated during resolution.
- `TANDEM_IMAGEGEN_OAUTH_MODEL`: legacy masked Responses host, default `gpt-5.5`.
- `TANDEM_IMAGEGEN_JPEG_QUALITY`: 1–100, default 90; invalid/empty values use the default.

The public Images request model is `gpt-image-2.5-sunburst`; one output is requested (`n=1`).
API-key mode uses `@opencode/ai/promise` (`ai.image.generate`) with the public OpenAI provider
facade; OpenCode owns generations/edits encoding, reference/mask uploads and response decoding.
Size, quality (including `xhigh`/`max`), background, PNG format and low moderation are retained.
OpenCode exposes reported quality/background, output format/size and token usage, but not revised
prompts, request/generation IDs or reported model/action. Those unavailable API-key fields remain
absent/null in the tool result; API-key images no longer have a revised-prompt caption. OAuth
metadata and captions are unchanged. Usage remains internal to the image API, as before this
tool does not report or account for it.
Native Codex size/quality are `auto`; its `gpt-image-2` compatibility field does not verify the
serving model. Masked OAuth requests use the retained Responses image tool. Mask + transparent in
legacy OAuth is rejected explicitly, rather than pretending it is supported.

## Output/UI contract

The original is saved as `<session directory>/imagegen/<sanitized callID>.png`; existing stems
receive a numeric suffix and exclusive writes prevent overwrites. A smaller same-dimension display
copy is optional: JPEG only for observed opaque output, WebP for observed alpha. Failure to create
the optional copy retains the PNG as the display path. Native transparency must contain real alpha
pixels or the call fails. No crop/resize or background removal is performed.

Model-visible content contains display/original paths, actual PNG dimensions, backend-reported
quality/model when present, requested API settings separately, and a changed reported prompt.
Metadata includes `path`, `originalPath`, `size`, `observed` dimensions/alpha, `requested`, `reported`,
`quality` (null when unknown), request/generation IDs, mode/transport and changed `revisedPrompt`.
No image attachment, data URI, base64 or model-readable image payload is returned.

The imagegen body uses the existing `createMarkdownImages(markdown.readImage)` and
`createImagePreview()` infrastructure. It creates the reader after the deferred card body mounts,
uses Blob URLs, cancels/revokes on cleanup and has no resource/Suspense loader. The existing ordinary
Markdown image infrastructure is reused without edits; no old `DataProvider.readFile` loader or
media route was restored. Raw path and returned revised prompt are displayed; preview/accessibility
copy comes from existing upstream preview infrastructure.

## Static-check evidence

The earlier image-tool worker attempted one source-only check through `bun typecheck` in
`/tmp/tandem/v2/imagegen-typecheck`; log: `/tmp/tandem/v2/imagegen-typecheck.log`.
It traversed the imported Core/UI graph and produced configuration/unrelated diagnostics (DOM and
ESNext library declarations and existing Bun types), plus imagegen diagnostics. The imagegen
findings were corrected: text asset uses the existing Markdown declaration, JSON response decoding
validates unknown values, installed Effect uses `Schema.fromJsonString`, and API/OAuth registration
branches are separate for input inference. No rerun was performed under the one-check limit.
A clean source typecheck is therefore **not claimed**; master should verify during integration.

The separate-image-auth implementation ran its one permitted source-only check with pinned Bun
1.4.2 via `bun run typecheck` in `/tmp/tandem/v2/imagegen-auth-sourcecheck` (no emit, no runtime
execution). Log: `/tmp/tandem/v2/imagegen-auth-sourcecheck.log`. **No imagegen diagnostics** were
reported. The imported graph still failed on eight unrelated declarations: Codemode Uint8Array
base64/hex and RegExp.escape, Core's `BunFetchRequestInit`, and Util's Bun global. No rerun, build,
login/provider/image request, browser/device action, test, restart or commit was performed.

## Source-ready handoff / remaining gaps

- This bounded revision changes only `auth.ts`, `plugin.ts`, `imagegen.ts`, `imagegen-skill.md` and
  this README within the owned imagegen directory. Auth registration is still master's shared-file task.
- The separate image login is now saved/active and first native generation succeeded (see below). Token refresh,
  simultaneous image calls, dynamic schemas/skills, generation/edit/mask/transparency and UI/context
  isolation remain unverified in v2. Source completion is not feature acceptance.
- Login currently requires copying the full callback URL; no automatic loopback or device-code flow.
  Process-local refresh serialization does not coordinate separate servers sharing a database.
- Masked OAuth transparency remains explicitly unsupported. Native size/quality/model remain
  backend-managed; no additional controls or verified-serving-model claim were introduced.
- The master-owned progress ledger and registration were not edited by this worker.

## Master real-workflow acceptance prescription

Use the isolated V2 runtime and explicit development server, with request inspection enabled only
as appropriate. Do not publish or inspect authorization headers/token values in evidence.

1. **Availability/priority:** in one running Location, exercise absent credentials, stored key,
   environment key, separate image OAuth, conversation-only OAuth and `TANDEM_IMAGEGEN` opt-out. Inspect each next
   actual request's tool schema/skill list. Stored key must win over environment/OAuth; API mode
   must require width/height; OAuth must omit them/quality. Change credential modes between steps
   and check that no stale controls are sent. Confirm a user `imagegen` skill overrides the bundle.
2. **Built-in token sharing:** with only the conversation login, inspect a real agent request and
   confirm no bundled imagegen tool/skill. Authorize the separate image login through the API above;
   verify persistence, tool/skill appearance and that the original conversation login remains active.
3. **API generation:** request one clearly recognizable composition with width/height 1024×1024,
   default quality high. Inspect actual PNG signature/dimensions, `n=1`, saved original/display paths,
   reported/requested metadata and available request/generation IDs. Missing quality remains null.
   Repeat a call ID/save collision only through an authorized real workflow if practical; existing
   PNG/copies must not be overwritten.
4. **Reference editing:** use the saved original PNG, preferably under a directory/path containing
   spaces, with one targeted change and explicit preservation constraints. Verify source resolution,
   edit endpoint and the actual edited image. Add multiple references if available; ten is the cap.
5. **Masked editing:** create a valid first-source-sized PNG alpha mask (transparent editable area),
   make a localized edit and visually compare preserved/changed regions. Verify mask bytes reach the
   actual edit request. Wrong dimensions, opaque masks and a mask without input must fail concretely.
    The separate image OAuth credential must use Responses for masks, never native Images.
6. **Native transparency:** request an isolated subject with `transparent:true` for generation and
   reference editing. Inspect actual alpha extrema/nonopaque-pixel count in PNG and any WebP copy,
   plus unchanged dimensions. A checkerboard appearance is not proof. Opaque backend output must
   fail. Legacy masked transparency must show its explicit unsupported error.
7. **Web/Android presentation:** open each card thumbnail/lightbox, verify display path and changed
   prompt caption when the backend actually revises it. Reload the session, stream a follow-up,
   collapse/reopen the card, and verify no conversation suspension/remount loop. Also display an
   ordinary local Markdown image with encoded spaces; missing images must not break the timeline.
8. **Context isolation:** inspect the next real provider-facing model request after merely opening
   the card/lightbox and Markdown preview. It must contain paths/text only, no returned image bytes
   or image attachment. Then explicitly Read a saved image and confirm only that deliberate action
   injects image data. Browser preview loading itself must never do so.
9. **Separate image OAuth:** after Jon authorizes, validate native generation/edit, Responses mask,
    transparency and expired-credential refresh/persistence, including simultaneous image calls from
    different Locations. Confirm observed model/quality never comes from request defaults. Before
    authorization/real validation, these cases remain unverified; never substitute conversation tokens.

Source review and the static-check attempt do not satisfy these acceptance steps.

## First-generation terminal-state diagnosis (2026-10-04)

### Observed evidence

- Isolated server `4098`, reported PID `10660`; session
  `ses_efabb6299ffel3PDQvgz3Pg0mm`, image call `call_m2NaEJmXnNyg7Dz7HjFPiHl6`,
  assistant message `msg_10544b11e001s8JfF07k5VRCxW`.
- Real generation saved `imagegen/call_m2NaEJmXnNyg7Dz7HjFPiHl6.{png,jpg}` under
  `/tmp/tandem/v2/acceptance-workspace/`; both are 1254×1254. The agent subsequently used glob,
  explicitly read the PNG, inspected dimensions with shell, and reached a final answer.
- Authenticated GET of the session returns `{data:{...,outcome:"succeeded"}}`. GET of the above
  message still returns imagegen `state.status:"running"`, empty metadata and no completion time.
  Read-only SQLite inspection of `session_message` confirms the same stored state: this is not a
  UI cache/renderer defect. No stored rows or old messages were repaired.
- The development database's `event` table is empty. `core/src/bus.ts` defaults event-payload
  retention (`persist`) to false while committing projections/sequence state. Therefore no retained
  historical success/failure event payload or exact thrown schema diagnostic is available here.
- Original evidence: `/tmp/tandem/v2/imagegen-generation.log` and
  `/tmp/tandem/v2/imagegen-generation-messages.json`. The latter includes large image bytes from
  the **explicit read**, not an imagegen result. Inspect selected fields, never dump it wholesale.
- Follow-up compact evidence: `/tmp/tandem/v2/imagegen-state-diagnosis.json`.

### Source diagnosis and bounded fix

`imagegen.ts:reportedSettings` previously emitted own keys for model, quality, background and
action even when their values were `undefined`. `plugin.ts` places that object inside tool
metadata. Unlike JSON.stringify (which silently omits those keys), the durable `session.tool.success`
schema requires `Record(String, Schema.Json)` metadata. `bus.ts` schema-encodes the complete event
before committing it. An omitted backend setting therefore makes publication fail after the files
have already been saved. This source-level failure path explains the persisted state; the original
transport response and thrown exception were not captured, so their exact missing key is unknown.

The tool adapter itself accepts string content and normalizes it to text content. There is no need
for an output schema, image attachment, base64, or a renderer workaround.

**Changed:** `reportedSettings` now omits absent backend settings. The masked Responses capture
also omits an unknown fallback model instead of reintroducing `model:undefined`. Present backend
values and existing `quality:null`/unknown semantics are preserved. Tool output remains small
paths/text/metadata only; generation bytes stay inside the transport/save implementation.

**Shared-core issue for master coordination:** `session/runner/publish-llm-event.ts:toolExecution`
sets `tool.settled = true` before `bus.publish(Tool.Success)`. When publication defects,
`failUnsettledTools` skips the already-settled call. In `runner/step.ts`, a non-interrupting local
tool defect need not fail the assistant/session after this skip. This combination permits a final
succeeded session with a stored running tool. Any shared-core fix must preserve its documented
concurrent check/mark ordering; do not simply move the mark past a yielding publish without review.
No shared-core, `plugin/internal.ts`, ledger or renderer edits were made by this follow-up.

The temporary `/tmp/tandem/v2/live-session.py` helper now unwraps session GET responses before
reading outcome (the old `OUTCOME None` was a wrapper bug). Its console tool summary no longer
prints file/data URIs; complete responses still go to its evidence JSON files.

### Verification boundary and next acceptance

This follow-up used lightweight authenticated GETs, read-only SQLite inspection, existing artifacts
and source tracing. No new generation, login, low-level tests, heavy build, restart, browser/APK
action or production-v1 change was performed. No post-fix runtime acceptance is claimed.

**Master: rebuild/deploy the isolated 4098 server when scheduled**, then run one real imagegen
session using the existing active `tandem-openai-images` credential. Do not repeat login or replace
the normal `openai` conversation token-sharing credential. Verify:

1. Imagegen itself reaches persisted `completed` with a completion time and JSON-safe metadata;
   missing backend settings are absent and unknown quality remains null.
2. Its result includes display/original paths and observed dimensions, contains text only, and
   remains small. For this check, tell the agent not to Read the generated image; an explicit Read
   would intentionally add bytes and obscure result-isolation inspection.
3. Reloading the session preserves completion; the UI card/lightbox loads via local-image preview.
   Master owns browser/device scheduling. The first generation's stuck record is not automatically
   repaired by this source fix.
4. Continue the broader unverified generation/edit/mask/transparency/refresh/availability matrix
   above. First native file creation alone does not establish those cases or full feature acceptance.
