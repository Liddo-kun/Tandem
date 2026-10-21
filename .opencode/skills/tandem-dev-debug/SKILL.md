---
name: tandem-dev-debug
description: Use when debugging Tandem's development server (port 4098): calling its API, reading its logs or database, or capturing heap snapshots and CPU profiles.
---

# Debugging the development server

Build, start and restart commands are in `contextL.md`. Everything here targets the development server; touch the daily one (4097) only when Jon asks.

## API

`bun script/tandem-v2.ts cli ...` runs the staged development CLI with the development environment and password. Always pass `--server`:

```sh
bun script/tandem-v2.ts cli api --server http://127.0.0.1:4098 get /api/info        # version, pid
bun script/tandem-v2.ts cli api --server http://127.0.0.1:4098 get /openapi.json    # routes and operation IDs
bun script/tandem-v2.ts cli api --server http://127.0.0.1:4098 <operationId> --param key=value -d '<json>'
```

Compare what a client renders with the raw session, message and event data to tell server state from client projection or rendering bugs.

## Logs and database

- Logs: `~/.local/share/tandem-v2/development/data/tandem/log/opencode.log` (daily: `~/.local/share/tandem/log/opencode.log`). Lines are `key=value`; filter by `run=<id>` for one process and `role=server|cli`. Set `OPENCODE_LOG_LEVEL=DEBUG` before starting the server for more detail.
- Database: `~/.local/share/tandem-v2/development/data/tandem/opencode.db` (tables include `session_v2`, `session_message`, `event`). `sqlite3` is not installed; open it read-only with `bun:sqlite` (`new Database(path, { readonly: true })`). Never point another server at it.

## Heap snapshots and CPU profiles

Get the server PID from `/api/info`, then:

- `kill -USR1 <pid>` writes `heap-<pid>-<timestamp>.heapsnapshot` to the log folder. Wait for `heap snapshot written` in the log before opening it.
- `kill -PROF <pid>` records a 10-second CPU profile, `cpu-<pid>-<timestamp>.cpuprofile`, logged as `CPU profile written`.

The log line's `path=` is authoritative. One snapshot shows what retains memory, not a leak: compare a baseline with a snapshot after a repeated workload, and compare heap size with RSS (`/proc/<pid>/smaps_rollup`). Install any analysis tooling under `/tmp/tandem`.
