# Optional v1 history import — live copy result

Date: 2026-10-04.

## Result and quick decision

**Master follow-through: the quick copy/import succeeded.** A consistent SQLite backup opened
the original with `mode=ro` and copied it in **4.18 seconds**. The isolated v2 runtime on4099
migrated **432/432 sessions and14,300 messages in23.24 seconds**, without migration warnings.
Its configuration, data/cache/state, database and random password were separate; no credentials
were imported. The copy runtime was stopped after inspection.

API inspection opened30 small matching verification/smoke conversations and counted their migrated
tools. One three-message/two-tool smoke conversation was exported through the normal v2 API,
imported into4098 at `/tmp/tandem/v2/history-continuation`, and continued with saved v2 ChatGPT
login. Session `ses_f37c0f76bffeODtIKx562cVvPt` completed an actual Read and returned
`HISTORY_IMPORTED_READ_OK`. Old history remained; no old task was resumed.

Attachment/client inspection subsequently passed: two historical PDFs and one PNG were preserved
byte-for-byte; the PNG opened in the viewer. The approved optional `session.created.hasHistory`
flag fixes first-open hydration without reload, with ordinary New-session and immediate imported
continuation regressions passing. See `v2-import-ui-fix.md`. Evidence:
`/tmp/tandem/v2/history-import/{result,candidate-inspection,continuation}.json`,
`history-import-driver.log`, `history-continuation.log` and copied `history-copy.db`.
The original database was never migrated in place or written by the master.

This supersedes the initial size-only gate below. The observed import is fast enough to retain
as the straightforward candidate for agreed cut-over. The optional trial checklist is complete;
take a fresh backup for cut-over rather than using this historical trial copy.

### Earlier worker investigation

The initial worker inspected a **2,936,012,800-byte (2.73GiB)** database and6.3MB WAL, then stopped
before copying it. The following boundaries and source review describe that earlier pass only.

## Evidence and boundaries

- Metadata-only `stat` inspected `/home/jon/.local/share/tandem/opencode-dev.db`
  and its WAL. The original was never opened by SQLite or a v2 runtime, queried,
  checkpointed, or written by this worker.
- No backup/copy, isolated runtime, password, service registration, or scratch
  database was created. The large-size stop preceded those operations.
- No auth files/tokens were read or copied, and no model session was submitted.
  Tool/attachment counts, API conversation inspection, one-session transfer to
  4098, and a continued Read are **unverified**, not successful or failed checks.
- Process inspection confirmed master **PID 659**, command `tandem`, started
  `2026-10-04 12:55:25`; ports **4098** and **4097** were listening. Port 4099
  was unused. No process was started, stopped, signalled, or restarted.
- Existing v2 logins were left untouched; login availability was not separately
  exercised. No device/browser GUI was used.
- Installed binary metadata: `~/.local/share/tandem-v2/development/bin/tandem`,
  224,512,296 bytes, modified `2026-10-04 12:54:40 +0700`. It was not executed,
  rebuilt, replaced, or installed by this worker.
- Git HEAD remained `40679546d4db07ba9dfb17160051c9a3109c438f`, branch
  `tandem-v2`. Version constants and pinned baseline were not changed.
  Existing dirty worktree changes were left alone. This note is the only file
  authored by this worker; no tests, commits, or publication were performed.

## Migration contract inspected

Read root `AGENTS.md`/`contextL.md` in both the starting daily checkout and v2,
the optional acceptance scope, CLI `AGENTS.md`, and the relevant implementation:

- `packages/cli/src/database-path.ts:4–12`: `OPENCODE_DB` selects the database;
  relative names resolve beneath the configured data root, while absolute paths
  can select an external file. Any future attempt must explicitly select only
  a consistent SQLite backup under `/tmp/tandem/v2/history-import`, with all
  config/data/cache/state/service roots independently isolated.
- `packages/core/src/database/migration.ts:22–145`: an existing `session` or
  `session_v2` table triggers in-place migrations. The old Drizzle journal is
  translated when necessary; an unmatched legacy timestamp is fatal. Each
  pending schema migration runs transactionally. No compatibility outcome for
  this daily database is claimed from source inspection.
- `packages/core/src/database/v1-migration.bun.ts:493–521,534–663`: the v1 data
  importer runs in a scoped background fiber, reports required/running/error/
  completed state, clears old events on first migration, and persists a
  `migration.v1-v2` cursor. It imports sessions one at a time, reading all
  messages and parts of each session into memory, transforming and writing v2
  projections inside that session's transaction. It is not a read-only history
  viewer. Large individual conversations can still be expensive despite the
  per-session cursor.
- The same file, `222–269,315–359,392–455`: invalid messages/parts and orphan
  parts produce skipped-row warnings; user files and assistant tools have
  explicit transformations. Non-`data:` user file URLs become unavailable-file
  text rather than usable attachments. Migration success alone therefore would
  not establish attachment/tool fidelity.
- `packages/server/src/handlers/migration.ts:6–13` exposes importer status;
  server availability alone is insufficient evidence of completed import.

The investigation stopped after this bounded contract review. No private
conversation contents or credentials were included in evidence.
