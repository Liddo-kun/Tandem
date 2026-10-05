# Installed Android v1/v2: bounded live performance comparison

Measured **2026-10-04, approximately 20:34–20:53 tablet local time**, using the installed production v1 and final native-regression v2 APK. **No overall speed winner is established.** V2 had a lower median first-observed usable Home upper bound; Activity launches were essentially alike. The same frozen 241-message coding conversation rendered and scrolled in both clients, and both accepted native typing. The sample is small and screenshot/driver overhead is material.

## Conditions and preservation

- Tablet: Lenovo Y700 Gen4, Android 15; native screenshots **1904 × 3040**, portrait **rotation lock 0** throughout. Battery declined from roughly 20% to 17%; power/thermal conditions were not controlled laboratory conditions.
- Clients: `app.liddokun.tandem` and `app.liddokun.tandem.v2`. Packaged v2 entry observed over CDP: **`index-DPpjYKUn.js`**. No APK, application source, dependency, build configuration or installed binary was changed.
- **Only one client process ran at a time.** The other package was explicitly force-stopped before switching. Both server processes remained running. APK assets/app data are separate; the system WebView implementation and device resources are shared.
- V1 WebView debugging was unavailable: forwarding its PID-specific socket on 9226 produced a socket hang-up, and no WebView devtools socket was listed while only v1 ran. Production debug settings were not changed. Native screenshot polling, native input and Android `gfxinfo` supplied the cross-client measurements; CDP was used only for v2 inspection/preparation/cleanup.
- V1 originally opened on **Home**, selected project unchanged, with **seven existing tabs** and **14 empty persisted draft stores**. These were captured read-only before interaction. V2 originally occupied the foreground on Home with eight tabs. Private state/screenshots stay in scratch rather than this note.
- V1's saved zoom was **90%**, versus v2 **100%**. An initial three-pair cold-launch series at those unequal preferences is retained but **excluded from the matched table**. V1 was temporarily changed through its hardware zoom controls to 100%, then restored to 90%. The matched series and transcript/input workflows used **100% on both**.
- The coding session **`ses_f082ce8c0ffekcRZeZSobuT35B`** had **241 messages** in both the consistent history copy and daily database (metadata-only daily inspection). The ordered message IDs, creation times and update times also matched exactly; their metadata SHA-256 is `2c2bbe7ae120efdec739702d539947c53af49164674b3879f35e68eeba541644`. The already-migrated history copy was backed up into a separate scratch database, exported through an isolated server on 4099 with separate XDG roots and no copied provider credentials, then imported normally into v2/4098 at a scratch directory with deny-all tool permissions. The export server was stopped before measurement. No prompt was submitted or model execution requested.
- Migration preserved 241 messages: 30 user, 209 assistant, one compaction, one system. This is matched historical conversation data, not identical renderer output: tool grouping, layout, paging and visible message density differ between versions. V1's Home lists and v2's Home lists also have different data volumes.

## Cold process start: three alternating pairs at 100%

Each pair ran v1 then v2. Both packages were force-stopped before the measured app was launched with `am start -W`; caches/data were retained. These are **cold process starts with warm disk/server caches**, not first installs or cold-device boots.

The visual criterion was **Home search control and populated session rows visibly rendered**, rather than splash, blank shell, or Activity creation alone. After launch, seven native screenshots were taken, with 150 ms between captures. The same driver was used for both. Each screenshot records command-start and command-return time relative to the host's launch-command invocation.

| Metric | v1 samples | v1 median | v2 samples | v2 median |
| --- | --- | ---: | --- | ---: |
| Android Activity `TotalTime` | 106, 82, 80 ms | **82 ms** | 85, 92, 86 ms | **86 ms** |
| First qualifying screenshot: capture-start → return | 1068→1332, 1884→2144, 1710→1964 ms | — | 1188→1432, 1289→1550, 1148→1396 ms | — |
| **First-observed usable Home, conservative upper bound** | 1332, 2144, 1964 ms | **1964 ms** | 1432, 1550, 1396 ms | **1432 ms** |

Every qualifying Home image was poll 1; poll 0 still showed the Android launcher. **Do not treat the screenshot capture-start→return interval as the true render-time interval.** The image samples an unspecified instant inside the command; encoding/transfer continues afterward. In this series, poll-0 acquisition alone took **777–1623 ms**, preventing observation of much of startup. Subsequent captures took roughly 244–280 ms near the first usable observation. Polling both adds load and supplies only loose bounds.

Thus, the observed upper-bound median was 532 ms lower for v2, but the data **do not establish a 532 ms startup improvement**. One pair favored v1, and the initial unequal-zoom series also demonstrated substantial timing variation. Activity timing is reported separately and is not a usable-start measurement. No startup FPS, input-ready event, or CDP first-paint comparison is claimed.

## Opening the matched frozen conversation

One bounded native opening observation per version, after each client had returned to Home and settled. V1 opened its already-existing third tab with one native tap; v2 opened the imported Home row with one native tap. Both showed the end of the same final answer plus the empty composer. V1 has seven restored tabs, v2 temporarily nine; navigation/data-cache conditions are not identical.

| Observation | v1 | v2 |
| --- | ---: | ---: |
| Native tap command, including driver | 33 ms | 33 ms |
| First transcript + composer image: capture-start → return | 485→795 ms | 783→1052 ms |
| Conservative observed-ready upper bound | **795 ms** | **1052 ms** |

V1's preceding image still showed Home. V2's preceding image showed the session shell/composer but **no transcript**, which correctly failed the criterion. This is one sample, not a session-opening median or evidence of a reliable regression.

### Separate first-import observation

Immediately after importing, the v2 composer became available in **419 ms** according to a CDP click-to-textbox check, **but the transcript remained blank**, including a later native screenshot. The session message API returned data successfully. One WebView reload made the historical transcript render, after which the normal measured native opening above worked. The 419 ms check is **not counted as usable conversation opening**. Root cause and reproducibility remain unverified; this is a first-import refresh observation, not a source diagnosis. No source fix or repeated debugging campaign was attempted.

## Native long-transcript scrolling

Starting near the latest answer, each version received the same three downward-finger swipes, physical coordinates `(950,950) → (950,2100)`, **600 ms requested gesture duration**, with 200 ms spacing. Earlier historical content was visibly exposed in both native before/after screenshots. V2 inspection after scrolling showed a roughly **8173 CSS-pixel scroll extent**, 830-pixel viewport and scrollTop 5824; native gestures, not programmatic scrolling, moved it.

Android `dumpsys gfxinfo <package> reset` reset diagnostic counters immediately before the three swipes, then `framestats` was collected. Each diagnostic observation window was about **2.54 seconds**.

| Metric | v1 | v2 |
| --- | ---: | ---: |
| Native swipe command times | 632, 641, 640 ms | 630, 642, 639 ms |
| Median command time, includes requested 600 ms + driver | **640 ms** | **639 ms** |
| Android reported frames rendered | 364 | 348 |
| Android frame-duration p50 / p90 / p95 / p99 | **12 / 13 / 13 / 15 ms** | **7 / 9 / 12 / 16 ms** |
| Android current janky-frame counter | **1 / 364 (0.27%)** | **3 / 348 (0.86%)** |
| Android legacy janky-frame counter | 30 / 364 (8.24%) | 10 / 348 (2.87%) |

These are **Android app-rendering diagnostic counters**, not a Chromium frame-pacing trace or independently measured display FPS. Current and legacy jank definitions give different summaries; they should not be conflated. V2's lower central frame-duration bins coexist with a slightly higher current jank count and p99. The versions render tools differently and expose different text per viewport. **One short scroll window per app is insufficient for a substantial smoothness improvement/regression claim.**

## Composer typing

Both began with an empty composer. The same native tap focused it, followed by an 800 ms wait and native `input text` injection of **34 characters**. No Enter/Send action was used. The installed IME capitalized the initial letter in both. A native screenshot after each injection showed the complete text. Ctrl+A/Delete cleared the temporary text after each sample, and Back dismissed the keyboard.

| Metric | v1 samples / median | v2 samples / median |
| --- | --- | --- |
| Native input-command completion, driver included | 113, 120, 129 ms / **120 ms** | 103, 110, 103 ms / **103 ms** |
| Complete text observed by screenshot return | 375, 385, 400 ms / **385 ms** | 384, 379, 360 ms / **379 ms** |

This measures **batch injection/command completion and a visual upper bound**, not per-key input-to-paint latency. IME/viewport animation was visible in some screenshots. The 17 ms command-median difference and 6 ms visual-upper-bound difference do not establish a meaningful responsiveness change. Both completed the workflow without a submitted prompt or retained benchmark draft. A separate CDP `.fill()` comparison was not attempted because v1 lacked CDP; comparing CDP fill on v2 against native typing on v1 would mix drivers.

## Restoration and ownership release

- **Daily v1:** original Home view and selected project visually restored; original **90% zoom** verified from persisted settings. All **14 original draft files have identical SHA-256 values**, with no new draft files. The **seven open tabs, tab info and closed-tab list are exactly unchanged**. Normal UI navigation updated `tabs.recent`; it was not manually rewritten. This is restoration of the requested view/open tabs/drafts, not a claim that every application cache or recency record is byte-identical. V1 was then force-stopped.
- **V2:** temporary imported session still exported **241 messages** before cleanup. Its owned tab was closed and the owned session deleted through **4098**, returning HTTP 204. No existing session or PTY was closed/deleted; this benchmark created no PTY. Original **eight-tab array exactly restored**, Home foregrounded at 100%, rotation lock 0. Final Android PID: **22533**.
- **Servers unchanged:** daily **4097 PID 23799**, started **2026-10-02 14:06:58**; development **4098 PID 14283**, started **2026-10-04 16:09:12**. Neither was stopped/restarted. Port 4099 was no longer listening. The original migrated `history-copy.db` was not overwritten; the temporary exporter operated on a new scratch backup.
- Temporary v1 CDP forward **9226 removed**. Existing v2 CDP forward **9224 points to final PID 22533**. Android/browser ownership was explicitly released after native verification of the final Home state. Heavy-build/device-driving hold ended then.

## Evidence and limits

Scratch root: **`/tmp/tandem/v2/performance-live`**, access restricted to the owner. It contains private state/screenshots and copied historical data; do not attach wholesale to a public issue/release.

- `matched100/cold.json`, `cold100.log`, and six `matched100/*-sheet.png` files: matched launch samples and visually reviewed contact sheets; full-resolution individual polls are retained.
- Root `cold.json`, `cold.log`, `*-cold-*-sheet.png`: excluded 90%-versus-100% exploratory series.
- `v1-open.json`, `v2-open.json`, `*-open-sheet.png`: native session opening polls.
- `*-scroll.json`, `*-scroll-gfx.txt`, `*-scroll-before.png`, `*-scroll-after.png`: gestures, frame diagnostics and visual ground truth.
- `*-type.json`, `*-2-type.json`, `*-3-type.json`, `*-typing-sheet.png`: three injection samples and screenshots per version.
- `*-original-native-state.json`, `*-restored-native-state.json`, `v1-restored.png`, `v2-restored.png`: preservation evidence. Credential-bearing `server` entries are excluded from captured native state.
- `frozen-metadata.json`, `transfer.json`, `export-copy.db`, `export-server.log`, `import-result.json`: frozen-metadata and isolated-copy/import provenance. `import.py` stopped its export server in `finally`. Its final PATCH succeeded with an empty response, causing the scratch driver's JSON decoder to throw afterward; inspection confirmed that the import/title/permissions had succeeded. The cleanup driver initially used an unsupported message limit, then used normal export to verify 241 messages and completed deletion.
- Scratch drivers: `cold.py`, `open-native.py`, `scroll.py`, `type.py`, `state.py`, `v2.mjs`, `cleanup-v2.js` and the small per-action JS files. They are workflow evidence, not added tests or product code.

This completes a **small installed-client comparison**, not a full performance characterization. Resume latency, true per-keystroke input-to-paint distributions, browser frame pacing, first-install startup and statistically reliable end-to-end speed differences remain unmeasured. No low-level tests, builds, installs, production prompts or product-source edits were performed.
