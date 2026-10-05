// UPSTREAM-DIVERGENCE: Shared Tandem wordmark replaces upstream animation dependencies.
import { Logo } from "@opencode/ui/logo"

// UPSTREAM-DIVERGENCE: Remove upstream letter-specific animation in favor of the shared Tandem wordmark.
export function AnimatedWordmark(_props: { active: boolean }) {
  return <Logo class="settings-about-wordmark" />
}
