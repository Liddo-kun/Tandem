## Priorities

- Prioritise, in this order: stability, simplicity, performance.

## Debugging

- Debug against the development server (4098) and the Tandem Dev app. Leave the daily server (4097), its app and the Tandem v1 fallback (4095) alone unless Jon asks.

## Local Dev

- Use the root development launcher and explicit server URL. Follow `contextL.md` or `contextW.md`; do not use daily service discovery or assume port 4096.
- `serve` embeds the locally built shared app. For frontend iteration, configure the Vite frontend to connect to the development backend.

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Suspense

A flash, a blanked area, a dialog that resizes or a reset scroll on first open almost always means a read entered Suspense. Do not ship UI that reads async data without the guard below.

- Reading `resource()` suspends while it loads. So does `resource.latest` until the resource has resolved once: before the first value, `latest` behaves like a plain read. `resource.loading` and `resource.state` never suspend.
- Guard every render-time read on state, and show the data you already have until then:

  ```ts
  const loaded = () => resource.state === "ready" || resource.state === "refreshing"
  const items = () => (loaded() ? resource.latest : cached) ?? []
  ```

  Precedent: `src/new-session/workspace/controller.ts` (`worktreesLoaded`).

- When the source can change (a drilled project, a selected session), include its key in the fetched value and use the result only when the key matches. Otherwise `latest` shows the previous key's data while the next loads.
- A `<Suspense>` boundary only chooses what blanks; it does not prevent the suspension. Without a local boundary, the nearest one is often a whole dialog or route.
- Suspend only on purpose, on first load, with a comment that says why.

## Typography

- Use `--line-height-compact` (`16px`) for `13px` compact UI text and `--line-height-base` (`20px`) for body text.
- Do not use `leading-none`, `line-height: 1`, or a `13px` line height for normal text. Inter descenders clip inside truncation and overflow containers.
- Keep control and row heights explicit. Fix font metrics directly rather than using transforms, negative margins, or clip-padding compensation.

## Fonts

Users choose three fonts in Settings > Appearance. Every surface uses one of these roles. This section is the single source for font rules across `app`, `ui`, `session-ui`, `gui-plugins` and `desktop`.

| Role          | Use for                                                            | Use                                                                                                   |
| ------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| UI font       | Prose, labels, titles, controls                                    | Inherit, or `var(--font-family-sans)`, `var(--v2-font-family-sans)`, `font-sans`                      |
| Code font     | Shell commands, code, paths shown as code, diffs, logs, tool input | `var(--font-family-mono)`, `var(--v2-font-family-code)`, `font-mono`, or a `<code>` / `<pre>` element |
| Terminal font | Terminal output only                                               | `appearance.font("mono")` from the GUI plugin SDK                                                     |

- Never write a literal family (`Inter`, `"IBM Plex Mono"`, `monospace`, `Menlo`, `system-ui`) in production CSS, classes, inline styles, canvas `font` strings or widget options. A literal ignores the user's setting.
- Never add an `@font-face`, font file, or font package outside `packages/app/src/index.css`. That file is the only place the app ships faces: Inter (variable), IBM Plex Mono Text (weights below 600), Bold (600 and up) and Text Italic, and JetBrainsMono Nerd Font Mono Regular and Bold. If a design needs a face that is not shipped, add it there and say why in the PR.
- Show shell commands with the timeline shell metrics: code font, `13px`, weight `440`, `-0.04px` letter spacing. Do not invent another size for the same content.
- Prefer weight tokens (`font-medium`, `var(--font-weight-medium)`) over literal weights. Mono at `600` or more renders IBM Plex Mono Bold, so reserve it for real emphasis.
- Do not read font settings directly. `src/settings/model.tsx` writes them to the CSS variables above, and the plugin host passes the terminal font through `appearance.font`.

## Loading Indicators

This section is the single source for loading indicators across `app`, `ui`, `session-ui`, `gui-plugins` and `desktop`.

- The dot-matrix `Spinner` (`@opencode/ui/spinner`, and `SessionProgressIndicatorV2` and `ActivityRing`, which render it) means the AI is working: a running session, turn, subagent or tool call. Use it only for those states.
- Every other loading state uses `Loader` (`@opencode/ui/loader`): page, pane and file loads, browser reload, search, connecting, authenticating, sending, installing. Use a purpose-built indicator only when the state has one, such as the titlebar update ring.
- Choose the indicator at each call site. Never restyle a shared indicator (`Loader`, `ActivityRing`, `Spinner`) to look like another one; that silently changes every caller.

## Scrolling

This section is the single source for scroll containers across `app`, `ui`, `session-ui`, `gui-plugins` and `desktop`.

- Scroll with a plain element: `overflow-y-auto` (or `overflow-x-auto`, `overflow-auto`) plus `min-h-0` or a max height. `packages/ui/src/styles/scrollbar.css` gives every native scrollbar the shared thumb. Do not add `ScrollView` to fix how a scrollbar looks.
- Mark each scroll container with `data-scrollable`. Nested-scroll handling (the timeline, Home, `createAutoScroll`) uses it to let the inner container scroll first.
- Use one element when it both sizes and scrolls. Add an outer wrapper only for something that must stay put while the content scrolls, such as `::before` and `::after` edge fades: the wrapper is `relative flex flex-col min-h-0` and owns the fades, and the inner element is `min-h-0 flex-1 overflow-y-auto`.
- A native scrollbar takes 8px from layout while the content overflows. Where text would visibly rewrap at that moment (the composer, settings search), add `scrollbar-gutter: stable` and subtract `var(--scrollbar-size, 0px)` from the end padding.
- A ref runs before the element's children render and before it is in the document. Restore a scroll position from `onMount` or a frame later, not in the ref.
- `ScrollView` (`@opencode/ui/scroll-view`) is only for the session timeline and Home, which draw the thumb in an external track (`thumbContainer`) and, in the timeline, correct it for virtualized rows. Use it again only for one of those needs.
- Never set `scrollbar-width: thin`, `scrollbar-width: auto` or `scrollbar-color`. Chromium then ignores the shared style and draws the native Windows scrollbar. Hide a scrollbar only with `no-scrollbar` or `scrollbar-width: none`.

## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies.
- Never change existing English text or keys unless the task asks for a copy change; when migrating copy to i18n, keep it byte-for-byte.
- Use `language.t(...)` for ordinary copy and `language.plural(baseKey, count, params)` for count-sensitive copy. Feature code must not inspect the locale, call `Intl.PluralRules`, pick plural-category keys such as `.one` or `.other`, or concatenate sentence fragments. Use complete phrases with placeholders only for irreducible values (names, paths, counts); if the API cannot express a phrase, extend the shared language module rather than product code.

## Tests

The root real-workflow verification rule takes precedence: no low-level test writing/running unless Jon requests it. Build as necessary for a real session/client workflow; static checks alone are not acceptance.

When Jon asks for a test:

- Test each behavior once, at the strongest boundary that observes it: the area's e2e keeper suite, or the owning module's unit test. Extend an existing table or keeper case before creating a file.
- Never add production seams for tests: no test-only exports, parameters such as `now`, `delay` or `budget`, flags, globals, or `data-*` attributes. Control time with `setSystemTime` from `bun:test` and drive the real entry point.
- A regression test must fail on the code before the fix.
