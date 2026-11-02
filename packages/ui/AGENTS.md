## Localization

- NEVER hardcode user-visible English strings in production code. ALWAYS use an i18n key for component defaults, visible copy, placeholders, accessible labels, tooltips, dialogs, toasts, empty states, and displayed errors.
- Feature work adds English source strings only. Leave non-English keys absent so the runtime English fallback applies.
- Never change existing English text or keys unless the task asks for a copy change; when migrating copy to i18n, keep it byte-for-byte.
- Render count-sensitive copy through `plural(baseKey, count, params)`. Never pass `.zero`, `.one`, `.two`, `.few`, `.many`, or `.other` variants to `t(...)`; `pluralForm(...)` is reserved for components that animate individual grammatical forms.
- Use `tDynamic(...)` when runtime-generated English source copy has keyed non-English alternatives. Do not branch on the active locale in feature code.

## Typography

- Use the shared typography metrics instead of copying solid line heights from design exports: `--line-height-tight` is `12px`, `--line-height-compact` is `16px`, and `--line-height-base` is `20px`.
- Inter text at `13px` must use at least the compact `16px` line height. A `13px` solid line box can clip `g`, `j`, `p`, `q`, and `y` when the text or an ancestor truncates or hides overflow.
- Reserve `line-height: 1` and `leading-none` for non-text glyphs, icons, or deliberately reviewed display marks. Do not compensate text with transforms, negative margins, or clip-padding hacks.
- `TextShimmer` inherits font metrics. Put typography overrides on its parent when they must supersede the component defaults.
- Fonts follow the Fonts section of `packages/app/AGENTS.md`: use `var(--font-family-sans)` or `var(--font-family-mono)` and their aliases, never a literal family, and never add font files or `@font-face` rules here.
