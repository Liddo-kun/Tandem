// Reused from Tandem v1 e4cff28994: Claude Code 2.1.220's validated flag/fallback policy.
export interface Binaries { ugrep: string; bfs: string; grep: string }
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`

export function grepShim(bin: Binaries) {
  return [
    "#!/bin/sh",
    'for _a in "$@"; do',
    '  case "$_a" in',
    `    -*-filter*|-*-pager*|-*-view*|-*-format-open*|-*-config*|---*|-@*|-*-save-config*|-[Zz]*|-[!-]*[Zz]*|--null|--null-data) exec ${quote(bin.grep)} "$@" ;;`,
    "  esac", "done",
    `exec ${quote(bin.ugrep)} -G --ignore-files --hidden -I --exclude-dir=.git --exclude-dir=.svn --exclude-dir=.hg --exclude-dir=.bzr --exclude-dir=.jj --exclude-dir=.sl "$@"`, "",
  ].join("\n")
}

export function findShim(bin: Binaries, regextype: string) {
  return ["#!/bin/sh", `exec ${quote(bin.bfs)} -S dfs -regextype ${regextype} "$@"`, ""].join("\n")
}
