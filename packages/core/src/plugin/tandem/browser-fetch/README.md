# Browser-backed webfetch

This plugin replaces the built-in `webfetch` with a Chrome-backed fetcher for
JavaScript-rendered and logged-in pages. It captures page text and screenshots,
then asks a hidden `web-fetcher` agent for the answer. Documents are downloaded
with browser cookies; PDFs use `pdftotext -layout` when available.

## Configuration

- `TANDEM_BROWSER_FETCH=0` disables the plugin and leaves upstream `webfetch` active. The default is on.
- Desktop CDP defaults to `127.0.0.1:9223`. `TANDEM_BROWSER_FETCH_ENDPOINT=host:port` selects an existing endpoint and disables automatic Android fallback.
- `TANDEM_BROWSER_FETCH_LAUNCHER` defaults to `~/.local/bin/chromium-x`.
- Android CDP defaults to `127.0.0.1:9222`. `TANDEM_BROWSER_FETCH_ANDROID_ENDPOINT=host:port` selects an existing endpoint.
- `agents["web-fetcher"]` may override the model, system prompt, and request settings. Its default model is `openai/gpt-5.6-sol#medium`, with medium text verbosity.
- PDF text extraction needs `pdftotext` from `poppler-utils`. Without it, the downloaded path is still returned.

## Implementation

- `plugin.ts` registers `webfetch`, the internal `fetch_page` follow-up tool, the reader agent, permissions, cleanup, and artifact retention.
- `cdp-fetch.ts` owns CDP bootstrap, navigation, capture, document download, limits, and tab cleanup.
- `web-fetcher.md` is the bundled reader prompt.
- `../auxiliary.ts` supplies bare-session policy and reader defaults.
- `packages/session-ui/src/tools/webfetch.tsx` renders the answer, source, and saved paths.

Browser work is serialized process-wide, including bootstrap and tab cleanup. Only
owned tabs are closed. An existing profile owner is never killed or unlocked.
Desktop unavailability or a persistent placeholder may fall back to Android, but
an explicit desktop endpoint never does. Rate-limit pages are not retried.

Each fetch captures at most four 1600px-high slices. Page text is capped at 2 MiB,
and only 100 KB is placed inline; overflow is saved. Downloads are capped at 50 MiB,
each PNG at 12 MiB, and all artifacts for one call at 128 MiB. The reader may make
12 follow-up fetches, including at most five search-engine fetches. Failed attempts
consume these budgets.

Artifacts live under `<Global.tmp>/webfetch/`. Idle retention keeps at most 300
owned files, 512 MiB, and seven days; active calls pin their files. Documents use
bounded HTTP with browser cookies and user agent, not Chromium's network stack, so
browser-only headers, POST state, client certificates, or TLS state may not carry.
Lazy below-fold content is not scrolled into view. Process death cannot run cleanup.

## Debugging

Errors identify CDP bootstrap, navigation, extraction, reader timeout, and budget
failures. Inspect `<Global.tmp>/webfetch/` for screenshots, downloads, and overflow
text. The result metadata records final URL, HTTP status, page state, answer, and
paths. A tab-close failure is logged as `webfetch owned-tab cleanup failed`.
