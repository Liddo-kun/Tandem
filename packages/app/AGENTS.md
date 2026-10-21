## Priorities

- Prioritise, in this order: stability, simplicity, performance.

## Debugging

- Debug against the development server (4098) and the Tandem Dev app. Leave the daily server (4097), its app and the Tandem v1 fallback (4095) alone unless Jon asks.

## Local Dev

- Use the root development launcher and explicit server URL. Follow `contextL.md` or `contextW.md`; do not use daily service discovery or assume port 4096.
- `serve` embeds the locally built shared app. For frontend iteration, configure the Vite frontend to connect to the development backend.

## SolidJS

- Always prefer `createStore` over multiple `createSignal` calls

## Typography

- Use `--line-height-compact` (`16px`) for `13px` compact UI text and `--line-height-base` (`20px`) for body text.
- Do not use `leading-none`, `line-height: 1`, or a `13px` line height for normal text. Inter descenders clip inside truncation and overflow containers.
- Keep control and row heights explicit. Fix font metrics directly rather than using transforms, negative margins, or clip-padding compensation.

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
