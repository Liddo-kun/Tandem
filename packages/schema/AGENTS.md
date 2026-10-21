# Schema Package Guide

`@opencode/schema` owns browser-safe wire and storage contracts shared by protocol, server, core, and generated SDKs. Keep runtime behavior, service layers, side effects, and host-local implementation details in the domain package that owns them.

## Boundary and versions

- Preserve the dependency direction: `@opencode/schema <- @opencode/protocol <- @opencode/server`. Schema values are serializable contract definitions, not service implementations or registries.
- Current contracts are unversioned (`Session`, `Permission.Request`). Retained legacy contracts are named `V1` (`SessionV1`) and live under `src/v1/`; current code must not depend on that subtree. Do not name new contracts `V2`.
- V1-only events such as `message.updated` and `message.part.*` stay out of the current Protocol/SDK event surface.

## Module shape

- One canonical exported value per contract. No bridge aliases, duplicate definitions or wrapper facades; a Core facade re-exports the exact Schema value.
- Use flat top-level exports plus the namespace projection pattern (`export * as SessionMessage from "./session-message"`). Import the namespace and read canonical members (`Plugin.ID`, `Question.Info`); resolve collisions by qualifying members, not with aliases such as `SessionSchema`.
- Exported schema values use `PascalCase`; schema-building functions and combinators use `camelCase`.

## Contract rules

- Optional object properties use the package `optional(...)` helper so encoded objects omit `undefined` keys. Convenience defaults are decode-only with `Schema.withDecodingDefault(...)`.
- Public `Schema.Struct` records use same-name interfaces:

  ```ts
  export interface Info extends Schema.Schema.Type<typeof Info> {}
  export const Info = Schema.Struct({ ... })
  ```

- Public contracts are readonly; do not use `Schema.mutable(...)` for runtime convenience.
- Avoid `Schema.Any`: use `Schema.Json` for JSON-serializable values and `Schema.Unknown` for opaque ones.
- Closed string sets use `Schema.Literals(...)`. If arbitrary strings are valid, document the field as arbitrary.
- ID constructors expose `create()`. New generated ID schemas validate exactly the prefix they emit, including the underscore; do not tighten existing loose ID validators.
- Reusable public schemas get stable, unique, domain-qualified identifiers such as `Model.Ref`.
