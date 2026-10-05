# Android performance and build-output evidence

Measured **2026-10-04**, against existing outputs only. **No application-source change is justified by this pass.** The final native-regression APK is **16,373,553 bytes**, **1,740,633 bytes / 9.61% smaller than installed v1**, and **4,824 bytes / 0.0295% larger than first-checkpoint v2**. These are artifact-size differences, not runtime speed claims.

## APK identity and provenance

| Artifact | APK bytes | Provenance |
| --- | ---: | --- |
| Installed v1 | 18,114,186 | Previously recorded baseline in `v2-progress.md`; not pulled or relaunched in this pass |
| First working v2 | 16,368,729 | First signed checkpoint recorded in `v2-progress.md` |
| Final native-regression v2 | **16,373,553** | Measured `/tmp/tandem/v2/native-regressions.apk`; matches the current generated release APK byte count and SHA-256 |

Final APK SHA-256: `6009b5928a0990be3ddf97edab568e5a41f262a3078c33694a098839f372d954`.

Generated release path: `packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk`. Its mtime is **2026-10-04 12:55:03 UTC**; the retained copy's mtime is **12:55:52 UTC**. Application ID and installation evidence are in [native regressions](v2-native-regressions-final.md).

`/tmp/tandem/v2/native-build.log` and `android-build.log` identify Vite **8.2.2**, **5,642 transformed modules**, **4.82s** frontend build, and the matching `index-DPpjYKUn.js` output. These are existing build-log observations, not a fresh build benchmark. Vite reports the usual >500 kB chunk warning. The frontend files were written at **12:53:54–12:53:55 UTC**. The same entry filename was observed in the installed packaged WebView in the native-regression note. Together these associate the measured dist with the final build; this pass did not extract and byte-compare every embedded frontend asset from the native library.

The APK's `lib/arm64-v8a/libopencode_android_lib.so` is **14,745,864 bytes**, stored uncompressed in ZIP; `classes.dex` is **1,543,768 raw / 727,128 ZIP-compressed bytes**. Tauri's `src-tauri/tauri.conf.json` sets `frontendDist: "../dist"`. Embedded frontend bytes are part of native assets: absence of standalone APK `.js` entries says nothing about JS size. Neither `.so` size nor total APK size is a JS measurement.

## Final v2 frontend bytes

Every regular file under `packages/android/dist` is counted recursively, including public assets, worker outputs and optional chunks. **Compression columns sum files compressed separately**, using Node zlib **gzip level 6** and **Brotli quality 5**. These are reproducible size estimates, not measured HTTP transfer sizes or Tauri's exact embedded encoding. No files were written into dist. Decimal bytes throughout.

| Final v2 output | Files | Raw bytes | gzip-6 bytes | Brotli-5 bytes |
| --- | ---: | ---: | ---: | ---: |
| Entire dist | 1,609 | **34,886,737** | **10,124,064** | **9,449,105** |
| All JavaScript, including workers and optional chunks | 1,466 | **29,669,283** | **7,003,846** | **6,409,612** |
| All non-JS assets | 143 | **5,217,454** | **3,120,218** | **3,039,493** |
| CSS subset | 33 | 543,255 | 95,052 | 86,063 |
| Entry JS + transitive static JS imports | 52 | **1,387,329** | **438,281** | **410,762** |
| Entry `index-DPpjYKUn.js` alone | 1 | 651,257 | 201,574 | 184,124 |
| Initial `index-BPCeQQpk.css` | 1 | 372,216 | 60,231 | 54,417 |

The static closure is a **build-graph quantity**, not all work performed before first paint. `index.html` lists 51 modulepreloads, all inside that 52-file closure. Route selection and idle preloading can load dynamic chunks; workers, CSS, fonts and inline HTML script are excluded from the JS closure. No runtime network/CPU trace was taken.

Sorted inventory fingerprint (SHA-256 of `relative-name + NUL + file-SHA256 + LF`): `9c69c32be3e83da34b6a50db9693cec0e5591adc5699801df1bf204dc9067742`.

### Existing v1 output: dated snapshot, not installed-v1 attribution

Read-only `/home/jon/code/Tandem/packages/android/dist/index.html` selects `index-DsrXAL0J.js`. Its JS files have coherent **2026-09-30 08:38:18–08:38:20 UTC** timestamps, four days before this v2 measurement. The existing output is measurable, but no inspected manifest/log ties it to the **18,114,186-byte installed v1 APK** or proves it represents current v1 source. **A matched installed-v1 JS comparison is unavailable.** Do not use this table to claim a current-v1-to-v2 improvement or regression.

| Historical v1 dist snapshot | Files | Raw bytes | gzip-6 bytes | Brotli-5 bytes |
| --- | ---: | ---: | ---: | ---: |
| Entire dist | 952 | 36,151,072 | 11,107,422 | 10,467,631 |
| All JS | 836 | 29,381,699 | 6,396,851 | 5,833,216 |
| All non-JS | 116 | 6,769,373 | 4,710,571 | 4,634,415 |
| Entry/static JS closure | 1 | 2,802,898 | 837,614 | 746,289 |

Snapshot inventory fingerprint: `dc852c02a6773acd8497b58f4b4ecf9fdcf1c0086830be68490a153efcb9371a`. Different chunk organization and worker/public-asset inventories further prevent equating entry-file size with total JS or startup work.

## Import/build-graph findings

There is no retained Vite module manifest, sourcemap or module-size report in Android dist. The inspection used source imports plus an AST parse of actual emitted JS static imports/reexports and literal dynamic imports (including template literals). It is a chunk graph, not an exact source-module byte attribution. Worker `new URL(...)` edges and runtime conditions are not represented by ordinary import reachability; an unreached chunk in that graph is **not evidence of unused code**.

### Android and desktop boundaries

- `packages/android/vite.config.ts` consumes `@opencode/app/vite`, uses the shared public assets, targets `esnext`, and puts generated assets at dist root. `packages/app/vite.js` provides Solid/Tailwind, the app `@` alias and ES workers. Its `opencode-desktop:*` plugin names are build-time labels, not evidence of Electron shipping.
- `packages/android/src/entry-android.tsx` mounts one v2 `AppInterface`/`AppBaseProviders` through `@opencode/app`, with Tauri storage, haptics, notification, opener and mobile bridge integrations. `packages/app/src/index.ts` exports that app and v2 browser draft store. No old v1 entry/onboarding/composer is mounted by this path; focused imports did not reveal the old `@opencode-ai/*` adapters or `prompt-input-v2` path. This does not assert every compatibility branch was eliminated.
- `packages/app/src/runtime/extension/builtins.ts` imports **renderer** built-ins. `packages/gui-extensions/src/renderer.ts` eagerly registers small renderer entries; its separate `src/main.ts` owns main-process entries. Electron/Node integrations exist in the package's desktop main-side files, but this inspection found no import path from Android into those main integrations. The emitted chunk graph has no unresolved external import specifiers, including Electron. Without a module-level build report, this is bounded source/output evidence, not an exhaustive binary absence proof.
- Some **desktop-only renderer code and optional assets are still emitted**, because the shared built-in list is not filtered at Android build time. Browser and SSH setup return unless `App.platform === "desktop"`; updater returns without `Native`; WSL has `os: ["windows"]` and is filtered by `ExtensionRoot`. `runtime/extension/services.tsx` exposes Android as web to extensions and supplies `Native` only on desktop. These runtime guards do not remove their code from the APK.
- Concrete browser-only dynamic chunks `panel-BAnPT-re.js` and `model-CN4fVCIq.js` total **20,232 raw / 7,668 gzip / 7,303 Brotli bytes**. Updater `actions-9s3HUuxw.js` + `section-DiuQNN7T.js` total **2,991 / 1,327 / 1,194 bytes**. These are selected file sums, **not** exclusive totals for all desktop code or guaranteed APK savings. Eager entries, shared contracts and locales cannot be accurately attributed from this output alone. No demonstrated large unused desktop runtime warrants changing the shared registration boundary in this pass.
- Filename false positives: `desktop-Dlh5hvp9.js` (**1,826 bytes**) is a syntax grammar for `.desktop` files. `desktop-native-2tb-SDyq.js` (**7,994 bytes**, in the static closure) contains shared product/localization copy, corresponding to `runtime/i18n/desktop-native.ts` and product-copy imports; it is not an Electron integration.

### Substantial views already have dynamic boundaries

| Emitted JS chunk | Raw | gzip-6 | Brotli-5 | Source/graph interpretation |
| --- | ---: | ---: | ---: | --- |
| `route-DUxjqvGk.js` | 334,969 | 100,252 | 93,759 | Session route dynamically imported by `shell/routes/routes.tsx` |
| `file-CoKlQw5j.js` | 325,687 | 80,039 | 69,905 | Lazy session file component; preloaded with session route |
| `shell-CDWLGMJ3.js` | 135,159 | 35,406 | 32,929 | Lazy settings shell |
| `ghostty-web-Ch-lxWIv.js` | 1,379,577 | 423,762 | 373,761 | `terminal/model.ts` imports Ghostty on demand and caches its promise |
| `panel-DcVJkHgm.js` | 26,488 | 9,471 | 9,137 | Lazy terminal panel; renderer schedules idle preload and preload for restored open docks |
| `panel-mn8uqKj9.js` | 10,850 | 3,530 | 3,377 | Lazy wide review panel |
| `mobile-hDPp3E0X.js` | 16,883 | 5,608 | 5,401 | Lazy narrow review; review renderer idle-preloads the selected layout |
| `mermaid.core-DUtiTE2S.js` | 102,246 | 33,533 | 31,188 | Outside static entry closure; diagrams have additional separate chunks |

The review/file functionality is retained and used. `session-review-v2-*` naming is not proof of an obsolete v1 UI: those chunks are imported by current route/review/browser surfaces. Existing lazy loading is not equivalent to zero startup cost—idle preloads are explicit—but no timing evidence here supports moving those boundaries.

### Actual duplication observed, without an unused-code conclusion

- `wasm-BnjxR4X6.js` (**622,325 bytes**) and `wasm-S0UXjx1m.js` (**622,327 bytes**) contain the **same 622,148-character base64 payload** with different `var`/`const` wrappers. Combined estimates: **460,563 gzip / 340,959 Brotli bytes**. Both have real importers: `worker-C_r6akXb.js` imports the first; `markdown.worker-Dm8GceJH.js` and `worker-DGh4IHbq.js` import the second. This is cross-output/worker duplication, not an unused optional view. Sharing it would require coordinated build-graph work and verifying worker behavior and actual package savings; deleting a copy is not safe.
- The two C++ grammar chunks are **785,556** and **785,541 bytes** with different import edges, including a markdown-worker edge in one. Multiple locale stems likewise represent extension-owned dictionaries, not automatically duplicate UI implementations. Filename counts are not a removal criterion.
- Exact whole-file hash duplicates total only **18,553 redundant raw bytes**: four versioned/unversioned icon pairs and two 778-byte Mermaid class-diagram entry chunks. Retained names can have separate consumers; no deletion was made.

**Decision:** evidence-only. Desktop renderer residue and worker duplication are documented, but there is no demonstrated unused heavy bundle path with a clear, verified, low-risk source fix. No source, dependencies or build settings were changed.

## Follow-up: installed-client live comparison

The subsequently authorized [bounded installed-v1/v2 benchmark](v2-performance-live.md) ran one client at a time with the other force-stopped, preserving both servers. At matched 100% zoom, three cold-process samples gave Activity medians **82 ms v1 / 86 ms v2** and native first-observed usable-Home upper-bound medians **1964 ms / 1432 ms**. Screenshot overhead prevents treating those upper bounds as exact startup times or a proven speedup. The same 241-message historical coding conversation was opened/scrolled, native typing was sampled three times per app, and Android frame diagnostics were recorded. No overall speed winner is established. The daily client's Home, seven tabs, drafts and 90% zoom were restored; final foreground is v2 Home with its original eight tabs. See the linked note for limits, the first-import blank-transcript observation, cleanup and raw evidence locations.

## Existing same-tablet runtime observations

These are earlier **v2-to-v2 workflow samples**, not a matched v1/v2 performance study. Variants remain inline to avoid implying a single final-APK benchmark series.

| Metric and variant | Recorded samples | Interpretation |
| --- | --- | --- |
| **Cold Activity launch only** | First checkpoint v2: **105ms**; editor-controls pre-fix handoff: **97ms** → controls-final cold relaunch: **73ms**, other controls-final launches **96–267ms** | Android Activity timing, **not full rendered start**. No matched v1 sample or new cold-launch measurement of `native-regressions.apk` |
| Session opening: search → imagegen-settlement → Prompt available | Controls handoff **700ms** → controls-final **431ms**; **528ms** after its cold persistence check | Single workflows; different state/launch conditions, not a proven speedup; not measured again for the native-regression final APK |
| Composer controls workflow at 102% | **579ms → 603ms**, +24ms | Includes fill/End/Enter/beta, CDP snapshots and keyboard transitions; no statistical conclusion |
| Native-regression composer workflow | Fresh pre-fix **266ms** (prior **269/281ms**); first post-build **361ms**; repeats **300/258/289ms**, median **289ms** | Repeat median +23ms versus fresh baseline, +8ms versus prior 281ms; excludes settle wait and is a different workflow from 579/603ms. Too few samples for a regression/speedup claim |
| Native terminal scrolling in final APK | Earlier rows exposed by actual touch; same PTY preserved; keyboard-open swipes kept outer scroll/viewport stable | Functional regression fixed; this is not long-transcript FPS/frame-time evidence |

Sources: [Android controls](v2-android-controls-live.md), [native regressions](v2-native-regressions-final.md), first checkpoint in `v2-progress.md`. The native note also verifies the fixed composer cap in all six keyboard-open orientation/zoom cases. Those geometry results do not measure frame times.

**Status at this artifact-analysis pass:** matched installed-v1/final-v2 full rendered cold start, comparable session opening, long-transcript scroll/frame pacing, composer input latency and resume timing had not been measured. The [later live comparison](v2-performance-live.md) adds bounded native observations, but does not establish an overall performance win, precise browser input/frame latency or resume performance. No browser/device operation, app/server restart, build, dependency install or low-level test was performed during the artifact-analysis pass itself.

## Reproduction and retained scratch evidence

All analysis files are under `/tmp/tandem/v2`: `performance-measure.cjs`, `performance-measure.log`, `performance-v2.json`, `performance-v1.json`. JSON inventories contain every path, raw/compressed size, SHA-256, mtime, emitted import edges and static-closure membership. They contain no credentials. The script reads existing dist only and writes its reports to that scratch directory.

```sh
# Run from /home/jon/code/Tandem-v2; no build or install.
stat -c '%n | %s | %y' /tmp/tandem/v2/native-regressions.apk packages/android/dist/index.html /home/jon/code/Tandem/packages/android/dist/index.html
sha256sum /tmp/tandem/v2/native-regressions.apk packages/android/src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release.apk
timeout 120 node /tmp/tandem/v2/performance-measure.cjs > /tmp/tandem/v2/performance-measure.log
rg -n 'index-|modules transformed|built in|ghostty|larger than' /tmp/tandem/v2/android-build.log
rg -n 'lazy\(|import\(|onIdle|preload' packages/app/src/shell/routes/routes.tsx packages/gui-extensions/src/{terminal,review}/renderer.tsx packages/gui-extensions/src/terminal/model.ts
rg -n 'desktop|Native|os:' packages/gui-extensions/src/{browser,ssh,updater}/renderer.tsx packages/gui-extensions/src/wsl/index.ts
```

Standalone size reproduction if the scratch script is no longer retained:

```sh
node <<'JS'
const fs = require('node:fs'), path = require('node:path'), z = require('node:zlib')
function walk(root) {
  return fs.readdirSync(root, {withFileTypes:true}).flatMap(e => {
    const p = path.join(root, e.name)
    return e.isDirectory() ? walk(p) : [p]
  })
}
for (const root of ['packages/android/dist', '/home/jon/code/Tandem/packages/android/dist']) {
  const rows = walk(root).map(p => {
    const b = fs.readFileSync(p)
    return {js:p.endsWith('.js'), raw:b.length,
      gzip:z.gzipSync(b,{level:6}).length,
      brotli:z.brotliCompressSync(b,{params:{[z.constants.BROTLI_PARAM_QUALITY]:5}}).length}
  })
  for (const kind of ['all','js','non-js']) {
    const selected = rows.filter(r => kind === 'all' || r.js === (kind === 'js'))
    console.log(root, kind, selected.length,
      ...['raw','gzip','brotli'].map(k => selected.reduce((sum,r) => sum+r[k],0)))
  }
}
JS
```
