# Tandem Agent Notes

Shared follow-through rules live here. Environment-specific repo guidance lives in `contextW.md` for Windows desktop work and `contextL.md` for Ubuntu/Linux/proot work.

- At the start of a session, read `contextL.md` when running from Ubuntu/Linux/proot, or `contextW.md` when running from Windows. Do not repeat startup reading on each follow-up turn.
- If editing package-specific code, also check the nearest nested `AGENTS.md` for that package.
- Keep platform details in those context files; do not duplicate them here.

## Build And Install

- When Jon says "Install", run the platform's documented build/install commands directly using the established context. Do not restart discovery or repeat completed verification; stop only for a concrete deployment blocker.
- Use staged replacement, verify the installed version, and leave the running service alone unless a restart is explicitly requested.
