// UPSTREAM-DIVERGENCE: Tandem is a rebranded fork of opencode. This module is the single
// source of truth for the product name, CLI command, and the per-user directory name used
// for config/data/cache/state. Keeping it isolated means future upstream merges only ever
// touch the one or two call sites that import it, not scattered string literals.
export const Brand = {
  /** Human-facing product name (banners, titles). */
  name: "Tandem",
  /** CLI command / scriptName shown in help and usage. */
  command: "tandem",
  /**
   * XDG app directory segment. Drives ~/.config/<dir>, ~/.local/share/<dir>,
   * ~/.cache/<dir>, ~/.local/state/<dir>. MUST differ from "opencode" so Tandem
   * and official opencode can coexist without sharing auth/sessions/storage.
   */
  dir: "tandem",
} as const
