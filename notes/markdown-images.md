# Local images in assistant replies

## Contract

Assistant text in the shared session UI supports saved images using ordinary Markdown:

```markdown
![Number-card preview](xem-truoc-the-so-1-10.png)
![A filename with spaces](thẻ%20số.png)
```

The image must exist inside the session working directory. Paths are resolved by
the connected server's existing `file.read` endpoint, not against the web page URL
or the client computer's filesystem. Browser-supported raster formats and SVG
work. Remote image URLs retain normal browser behavior. PDF/Word download links
are not implemented by this feature; an image preview is not a file transfer.

The shared environment prompt in `packages/opencode/src/session/system.ts`
documents this for all providers, rather than maintaining model-specific copies.
The text explicitly scopes the capability to Tandem's web UI; the terminal still
receives ordinary Markdown.

## Implementation

- `DirectoryDataProvider` supplies the existing authenticated SDK file reader.
  Its identity changes with the scoped SDK, invalidating image caches when a
  server or directory changes.
- `TextPartDisplay` opts assistant text into local image loading. User text,
  reasoning, standalone Markdown and tool-output Markdown do not opt in.
- `markdown-images.ts` prepares already-sanitized HTML in an inert template,
  removing local image sources before insertion. The browser never makes a
  spurious request to `/server/.../session/preview.png`.
- Reads stay outside Solid resources so they cannot suspend and detach the
  timeline. A mounted Markdown component deduplicates reads by path, releases
  unused entries, and ignores late results after disposal or retargeting.
- MIME-checked raster content uses the existing media helper. UTF-8 SVG text is
  displayed as an image data URL, not injected as HTML. Backend filesystem
  containment and authentication are unchanged. Image bytes stay out of the
  model's context unless a tool explicitly reads the image for the model.
- Missing/rejected files retain the image's alt text. They neither crash the
  conversation nor fall back to fetching a local filename from the web origin.
- Rendering reads live files; it does not persist an immutable attachment copy.

`imagegen`'s existing tool-result thumbnail remains independently supported.
Preserve its local Suspense boundary; see `notes/imagegen.md` and `log.md`.

## Live verification

Verified with real agent sessions and actual Bash, apply-patch and Read tool calls,
then inspected the normal session UI in Jon's desktop Chromium over CDP `:9223`.
Temporary scripts, transcripts, screenshots and network observations are under
`/tmp/tandem/markdown-image-live/`.

- `ses_f1d02890dffehYvGpUAUX5O3wH`: agent created a 600×240 PNG and emitted a
  relative Markdown image. Before the change, Chromium requested a session-relative
  web URL, received the SPA response, and reported natural dimensions 0×0.
  The patched UI fetched `file/content?path=preview.png` and displayed 600×240.
- `ses_f1cfb8310ffe9G7UoptTYcB55b`: PNG with Vietnamese characters and a space,
  JPEG, SVG, a remote Python website logo, an intentionally missing local image,
  and a literal Markdown example inside a code block. All valid images decoded;
  missing content retained alt text; code blocks triggered no image request.
  Reload and a further streamed response preserved the images without console
  errors or a resource/remount loop.
- `ses_f1cf32f1affeHNXQ8qOI1XjBWr`: the actual Uyen preview was inspected by Read
  and then embedded by the agent. The production-built UI displayed 1215×574
  from the Uyen directory, including with the production CSP.

The production build was served on a loopback-only temporary same-origin proxy
to the real backend, without installing or restarting Tandem. A basic production
baseline comparison on the same circles session recorded 2.83 s to visible
Markdown, 564 DOM nodes and ~70.6 MB JS heap on the installed UI; the changed
production UI recorded 3.35 s, 541 nodes and ~56.7 MB, including one image file
request. These single-run startup timings use different serving paths and are
smoke observations, not a controlled performance-regression measurement.

`packages/session-ui` typecheck and `packages/app` production build passed.
No low-level tests were added or run.

## Installation

Installed Linux ARM64 build `0.0.0-dev-202609271345` at
`/usr/local/bin/tandem`, including the embedded web UI and the shortened,
client-independent image instruction. The installed binary's SHA-256 matches
the build output. Rollback binary:
`/usr/local/bin/tandem.rollback-20260927-204617`.
The running service was left untouched; it picks up this build on its next restart.
