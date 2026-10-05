# Plain-HTTP web startup and acceptance — 2026-10-04

## Result and ownership handoff

**Master packaged follow-through passed:** the actual served origin `http://192.168.1.85:4098/`
now shows the normal connection form, rejects a wrong password and connects successfully with the
saved development credential. Evidence: `/tmp/tandem/v2/web-packaged-{reload,login}.log`. The
source-only deployment status below describes the earlier worker checkpoint.

**Source fix verified; integrated deployment pending.** Only this worker's production change is the `fetch` adapter in `packages/app/src/runtime/platform/web.ts`. Existing branding changes in that file were preserved. No SDK, Protocol, backend, or `packages/client/src/solid/data.ts` edits were made.

Desktop Chromium CDP **9223** and Android device ownership is released. The one owned desktop app tab is preserved at **http://192.168.1.85:4098/**, still running the unchanged integrated-build-3 frontend and therefore showing its reproducible unauthenticated Loading state. Playwright disconnected. No other tabs, Chrome OAuth CDP 9225, or Android app/device state were driven. Temporary Vite processes on 4108 and 4109 have been stopped. No CLI/APK builds, service restarts, commits, provider authorization, provider-default seeding, or browser credential injection were performed.

## Demonstrated cause

Baseline on the real served LAN origin:

- `isSecureContext=false`, `crypto.subtle` absent, `navigator.clipboard` absent.
- Static assets load with 200; Projects / Add project / Loading / Settings remains indefinitely.
- `/api/event` repeatedly times out, and `/api/info` does not deliver a 401 to the app.
- Backend independently answers unauthenticated requests with **401**, `WWW-Authenticate: Basic realm="Secure Area"`.
- CDP `Fetch.authRequired` confirms native **basic** challenges for both `/api/event` and `/api/info`. Diagnostically cancelling those challenges (without providing credentials) immediately exposes the existing app connection form. Disabling interception and reloading reproduces Loading. A distinct same-origin fetch using `credentials: "omit"` returns **401** normally.

Thus this is the browser's ambient Basic-auth challenge path blocking application-level auth detection, not absence of SubtleCrypto or Clipboard APIs. The initial parallel same-URL fetch comparison also stalled both probes and is not relied upon as evidence; the final unique-URL probe and CDP challenge trace establish the cause.

Evidence under `/tmp/tandem/v2/`:

- `web-baseline.log`, `web-baseline.mjs`: unchanged build startup/network and repeated event-stream timeouts.
- `web-challenge.log`: backend challenge reaches an omit-credentials probe.
- **`web-auth-cause.log`, `web-auth-cause.mjs`**: explicit native challenge events, form after challenge cancellation, reproduction after interception removal, omit probe 401.

## Fix

The web platform now supplies a fetch adapter that sets `credentials: "omit"`, retaining the existing explicit Basic `Authorization` header from the saved/server-form connection. This keeps credentials application-owned and lets 401 responses reach `checkServerHealth` and the already-existing `ConnectServerScreen`. Request body, abort signal and other options pass through. The no-op `preconnect` property matches the existing browser-fetch adapter convention required by Bun's fetch type.

The adapter applies only to the web platform. No auth bypass, response mock, broad CORS policy change, or new auth UI was introduced.

## Real source workflow

Unchanged backend: **192.168.1.85:4098**, supplied master server PID 24838 / integrated-build-3. Source app ran with pinned Bun 1.4.2 and Node/Vite from existing dependencies.

### Plain-HTTP same-origin deployment shape

Temporary **http://192.168.1.85:4108** Vite app used `/tmp/tandem/v2/web-vite.config.mts`: a normal `/api` proxy to **http://192.168.1.85:4098**, `changeOrigin: true`, no auth/header injection or response rewriting. Environment selected server host 192.168.1.85 and port 4108 so browser API traffic remained same-origin, matching the served production UI topology. Real backend authentication remained mandatory. The LAN origin remained insecure throughout.

1. With no saved credentials, the normal URL/password connection form appeared.
2. Deliberately wrong password returned 401 and the form's valid-credentials error.
3. Real password was read from the isolated password file and typed into the form, never printed. Clicking Connect yielded 200 `/api/info`, 200 event stream, projects and session inventory. No storage was manually seeded.
4. Added the acceptance workspace with the real project picker. Selected **GPT-6-Astra** through the model menu; created and submitted a new session through the composer.
5. **Session `ses_efa0c9f91ffeAET5Ayj8silsMt`**, title “Plain-HTTP web acceptance marker retrieval”, performed an actual **Read** of `/tmp/tandem/v2/acceptance-workspace/web-http-marker.txt`, returning `WEB_HTTP_LIVE_20261004`.

Evidence: `web-source-proxy.log`, `web-login.log`, `web-session-finished.log`. Interaction drivers: `web-source.mjs`, `web-login.mjs`, `web-ui.mjs`.

### Images and clipboard

- **PASS copy fallback:** clicked the real **Copy response** button for the marker response with `navigator.clipboard` absent. Read-only X11 inspection (`DISPLAY=:0 xclip -selection clipboard -o`) returned exactly `WEB_HTTP_LIVE_20261004`. No OS clipboard injection or replacement writer was used. Existing fallback needed no changes.
- **PASS file-picker image attachment:** used **Add images and files → Images and files**, real file chooser, selecting `/tmp/tandem/v2/acceptance-workspace/reference inputs/green triangle.png`. Draft preview was a loaded **Blob URL**, 1254×1254.
- **PASS submitted image:** sent through the composer. GPT-6-Astra answered “The image shows a green triangle pointing upward.”
- **PASS authenticated spaced-path rendering:** response Markdown referenced the server image with encoded spaces. Browser fetched **200** `/api/fs/read/reference%20inputs/green%20triangle.png?location[directory]=…`; rendered image “Green triangle” was a loaded **Blob URL**, 1254×1254.
- **PASS reload:** normal saved connection reloaded without sign-in; attachment remained loaded as a data URL and server-rendered image reloaded as a Blob URL. Security APIs remained absent and no page errors were observed.

Evidence: `web-copy.log`, `web-attachment.log`, `web-image-result.log`, **`web-images-reload.log`**. Drivers: `web-attachment.mjs`, `web-images-reload.mjs`. Clipboard value above was directly observed from read-only xclip output.

### Actual CORS

- **PASS rejection:** direct requests from the unlisted LAN Vite origin `http://192.168.1.85:4108` to backend 4098 were blocked by CORS, with backend 401 and no `Access-Control-Allow-Origin`. This was a temporary dev-origin allowlist mismatch; it was not changed or misreported as a successful connection. Evidence: `web-source-inspect.log`.
- **PASS allowed origin/auth:** a separate temporary source Vite on **http://localhost:4109** targeted backend **http://192.168.1.85:4098 directly, without a proxy**. The normal form appeared after 401 with `Access-Control-Allow-Origin: http://localhost:4109`. Form submission produced real **204 OPTIONS** allowing `authorization`, then **200** info, event stream, projects and sessions. Evidence: **`web-cors.log`**, `web-cors.mjs`.
- The localhost-origin control verifies actual backend CORS and explicit Basic-header behavior. It is not the insecure-context acceptance; that was the LAN-origin run above.

## Checks and pending deployment

- Focused `packages/app` **`bun run typecheck` passed** after live session verification (`web-typecheck.log`). No low-level tests were added or run.
- Temporary Vite parent/child PIDs **29425/29427** (4108) and **4949/4950** (4109) were terminated by exact PID after confirming their command lines. Earlier unsuccessful startup processes had already exited; initial direct-CORS Vite 27995/27996 was stopped before switching topology.
- Master still needs to build/deploy the integrated frontend containing this adapter and repeat the normal password-form flow at **http://192.168.1.85:4098/**. The running build was deliberately not replaced. The final tab is left there, with no credentials seeded at that origin, ready for this fresh-auth check.
- To find the real acceptance session after deployment, use title/session ID above; it is in `/tmp/tandem/v2/acceptance-workspace`. Temporary frontend connection state was saved only through the ordinary UI at the two temporary origins.
