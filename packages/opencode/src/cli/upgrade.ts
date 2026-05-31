// UPSTREAM-DIVERGENCE: Tandem does not auto-update. The upstream updater checks and installs from
// the official opencode releases (anomalyco/opencode) and package managers, which would notify the
// user about — or overwrite Tandem with — stock opencode. Tandem is updated manually from its own
// GitHub releases, so this startup hook is a no-op. (Upstream logic preserved in git history.)
export async function upgrade() {
  return
}
