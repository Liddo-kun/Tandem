# Browser-fetch live acceptance — 2026-10-04

## Result and scope

Six bounded, real main-agent workflows passed on the already-running isolated
4098 server supplied as PID 659, including the rebuilt normal-catalog policy fix.
No implementation fixes were needed in this pass. No builds, restarts, low-level
tests, mocks, credentials changes, production changes or application UI checks
were performed.

Each case created an ordinary `build` session through the `api` / `unwrap` helpers
in `/tmp/tandem/v2/live-session.py`, with `openai/gpt-5.6-sol` and allow-`*` session
permissions. Prompt metadata disabled parent correction only. Successful captures
used the tool's normal `web-fetcher` child, configured as
`openai/gpt-5.6-sol#medium`; no direct reader/model invocation replaced that path.

Evidence:

- Driver: `/tmp/tandem/v2/browser-live.py`.
- API snapshots, tab-ID timelines, child metadata/context, results and audit:
  `/tmp/tandem/v2/browser-live/`; consolidated `audit.json` is the evidence index.
- Final-send request dumps: `/tmp/tandem/v2/request-dumps/integrated-2/`.
- Case logs: `/tmp/tandem/v2/browser-live-{docs,visual,pdf,invalid,cancel-navigation,cancel-reader}.log`.
- Runtime artifacts: `/tmp/tandem/v2/tandem/webfetch/`.

## Executed cases

| Case | Main session | Observed result |
| --- | --- | --- |
| Documentation, targeted `format:text` | `ses_efa819076fferogKm8K2eRZtbS` | React `https://react.dev/reference/react/useEffect`, HTTP 200 / ready / regular Chromium. Correct `useEffect(setup, dependencies?)`, dependency-change/unmount/development cleanup and Strict Mode caveat. Four PNG slices saved. |
| JS-rendered visual extraction, `screenshot:true` | `ses_efa810703ffeijb0KPz7ZwMLU1` | `https://www.chartjs.org/docs/latest/samples/bar/vertical.html`, HTTP 200 / ready. Reader correctly identified the canvas title, Dataset 1 pink / Dataset 2 light blue, and seven month groups January–July. These legend/month details were absent from captured page text. Screenshot was independently opened and compared. Reader accurately noted that no bars were visible in this capture. |
| Small public PDF | `ses_efa807f2affeI6qgaLuleYXIbp` | `https://www.w3.org/WAI/ER/tests/xhtml/testfiles/resources/pdf/dummy.pdf`, HTTP 200. Returned “Dummy PDF file” and the actual downloaded path. Saved file is 13,264 bytes, `%PDF-1.4`; independent `pdftotext -layout` agrees exactly. |
| Invalid URL | `ses_efa800a6cffeSG9zXwCwZvF6iK` | A real `webfetch` call with `not-a-valid-url` returned tool error `Invalid URL`, with no browser tab or child created. Main agent reported the error without retrying. |
| Cancel during owned-tab capture/navigation window | `ses_efa7feb7affeWwv4PASSXeCGUL` | Called the React `useState` reference. Interrupted immediately after observing the new owned tab, before a reader existed. Interrupt succeeded; tool settled as `aborted: Tool execution interrupted`; parent outcome `interrupted`; tab removed. The observation establishes cancellation while the native capture owned a tab, not a precisely instrumented network-navigation subphase. |
| Cancel active reader | `ses_efa7fd891ffeDIUFjl3U8duRyM` | React `useEffect` capture completed and a normal reader was created with a real outgoing model request. Parent interrupt settled with the same aborted tool result, removed the reader and left the parent idle/interrupted. |

The React page verifies rendered documentation extraction, but is not claimed to
be JS-only text. The Chart.js canvas establishes actual JS-rendered visual content.
No buttons were pressed on the sample. Animated bar-value extraction remains
unverified; the captured blank plot is not evidence that its data values were zero.

### Saved artifacts

- Documentation prefix:
  `bf-1791093540670-c2124aec-5283-46f0-b060-677cfb961f5b-initial-desktop-`.
  Slices 1–4 are each 937×1600, respectively 180,302 / 319,922 / 289,723 /
  175,470 bytes. Order is recorded in the capture header and output paths.
- Visual screenshot:
  `bf-1791093574695-23c74aa3-a42b-4c2e-96a5-3b0795127523-initial-desktop-1.png`,
  937×1302, 125,767 bytes.
- PDF:
  `bf-1791093608426-20ed0c02-b157-4e6a-833a-d7af9a5d56fa-initial-desktop-dummy.pdf`.
  Its accompanying 952×1181 PNG is the download-notice capture, not a PDF-page
  rendering. All paths above are under the runtime artifact directory.

The PDF exercised the implemented browser-cookie/user-agent download path and
real `pdftotext`. A public document does not establish authenticated-cookie
necessity or authenticated-download acceptance.

## Tab ownership and final cleanup

Regular Chromium CDP 9223 started with five page tabs, ten total targets. Before
and after **each** case, both complete target-ID sets and page-ID sets matched.
The five pre-existing page IDs were:

```text
2BE45F140A3B0579F512CD281E25F009
72951CAF39941F47D1C5B92696FEF219
7F7339E0E51AC233C1B030254F3EB657
D242AABF3FA77CAD9138D09AD9F6AA5D
D6EDF897D2757B85ACB0C8F853392D8B
```

| Case | Page count before / peak / after | Owned tab ID observed; absent afterward |
| --- | --- | --- |
| docs | 5 / 6 / 5 | `4779EAF9898AA0E570B77BD08AE802FD` |
| visual | 5 / 6 / 5 | `C8169CD365FDAD72D8C2FEF4A07E80CD` |
| pdf | 5 / 6 / 5 | `B3574D84BE3495951E736A9B4241C820` |
| invalid | 5 / 5 / 5 | none |
| cancel-navigation | 5 / 6 / 5 | `E6C1C1A6DE0C89009C5B871AF68B621B` |
| cancel-reader | 5 / 6 / 5 | `46533E953265B346152F48E3D4F97131` |

All six main sessions were rechecked idle with settled outcomes; each has zero
remaining children. The four observed reader IDs all return HTTP 404 after
settlement:

- docs: `ses_efa8169eeffe3VhSCddpV4jUeV`
- visual: `ses_efa80e549ffeBlT3Ue7Cf0tz64`
- pdf: `ses_efa80654affeX24uM23bTjIjUy`
- cancel-reader: `ses_efa7fb8e7ffeAeFwDBytrAXxpv`

Android CDP 9225 returned `RemoteDisconnected` for target-list requests, so no
Android baseline/count or fallback acceptance is claimed. It was not repaired or
driven. Private user-tab URLs and OAuth callback codes were not inspected or
printed. No clearly eligible already-logged-in read-only page was identified in
the regular browser; no login was initiated. Authenticated content is unverified.

## Final-send isolation evidence

Audit inspected 14 final-send dumps attributed to these six parents and four
readers: ten parent requests and four reader requests.

- Every parent request omits `fetch_page` despite allow-`*` session permissions.
  This live result verifies the rebuilt `BrowserFetchPlugin.Policy` catalog fix.
- Every reader request has exactly `fetch_page` and `read`; instructions equal
  `browser-fetch/web-fetcher.md` exactly, with only the supplied user message in
  input. No ambient project AGENTS, skills, MCP guidance, main-agent identity or
  Corrector instructions appear in the reader system/input.
- Reader creation metadata contains `tandemAuxiliary: browser-reader`, the correct
  parent owner, `tandemBareContext: true` and `tandemCorrectorDisabled: true`.
  Permissions deny all except raw fetch and scratch-scoped read/external-directory.
- One PNG is directly attached to the visual reader's initial request. Other
  reader requests have zero attached images. All ten parent requests have zero
  image attachments; the parent receives the answer/source/paths, not screenshot
  bytes or a child transcript.
- Only expected `build` and `web-fetcher` primary requests were observed for these
  sessions; no Corrector child or attributed Corrector request was observed.
  Reader isolation is established at the final-send boundary; this pass did not
  independently query the durable instruction-baseline tables.

Key reader dumps in `integrated-2`:

```text
docs:          1791093544506-9da3b343-8792-401b-b179-79d123f31ac9.json
visual:        1791093578519-c29b47e2-2b70-4111-b722-61174492617b.json
pdf:           1791093611238-f4dc5339-caff-4065-84b2-f188591ebe4e.json
cancel-reader: 1791093655378-9b4f4e98-d1b8-4e74-9358-6daf52aef313.json
```

## Remaining case inventory

The browser-fetch README's full acceptance matrix is broader than this bounded
assignment. Do not mark the entire feature accepted from these six cases.

- Full-main-content/no-prompt behavior and `format:html` comparison; prior
  example.com targeted success is separate evidence, not a fresh no-prompt check.
- Already-authenticated read-only page and authenticated PDF; no eligible logged-in
  page was established in this pass.
- Scanned/no-text PDF and actual PDF visual reading.
- Redirect/final-URL behavior, desktop-to-Android fallback and natural refusal
  handling; no rate-limit probes were performed.
- Actual raw `fetch_page` follow-up execution, overflow-file Read, nearby
  instruction exclusion, configured model/system/request overrides and hidden
  agent-picker behavior. Final catalogs and standard bare-reader requests passed.
- Follow-up/search budgets and retention thresholds; not exercised with high-volume
  calls or synthetic substitutes.
- Cancellation specifically during document transfer or queued browser ownership;
  concurrent calls/serialization and timeout cleanup. Native capture cancellation
  and active-reader cancellation passed.
- Lazy/animated visual completeness beyond the captured chart, and four-slice
  truncation behavior on pages requiring more visible content.
- Web/Android tool cards, reload and streamed continuation belong to the master;
  no application UI acceptance was attempted here.
- Browser opt-out and process-death/orphan behavior require separate acceptance.

Browser ownership is released: all newly owned tabs are closed and all assigned
sessions are idle. Existing user tabs remain intact.
