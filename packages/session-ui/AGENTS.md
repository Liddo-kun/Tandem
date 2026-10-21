## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for visible copy, placeholders, accessible labels, tooltips, menus, dialogs, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies.
- Never change existing English text or keys unless the task asks for a copy change; when migrating copy to i18n, keep it byte-for-byte.
- Render count-sensitive copy through `i18n.plural(baseKey, count, params)`. Never pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `i18n.t(...)`; `pluralForm(...)` is reserved for components that animate individual grammatical forms.

## Typography

- Use `--line-height-compact` (`16px`) for `13px` transcript, tool, notice, and truncation text. Use `--line-height-base` (`20px`) for body text.
- Never copy Figma's generated `leading-none` onto text. Inter descenders clip when a solid `13px` line box meets `overflow: hidden`, `overflow: clip`, or truncation.
- Keep fixed row dimensions explicit; correct inner line metrics do not require transforms, negative margins, or paint-space compensation.
- `TextShimmer` inherits font metrics, so put typography overrides on its parent.
