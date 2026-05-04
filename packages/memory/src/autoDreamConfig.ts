// Autoremembered as a settings flag — controls the user-facing toggle in
// `/memory`'s "Auto-dream: on/off" row. With the cron-driven `/dream`
// (subsystem 1 of the KAIROS port, May 2026), this flag is purely a UI
// hint: it tells the model whether the user wants nightly consolidation.
// The actual scheduling lives in `.claude/scheduled_tasks.json` via the
// `/dream nightly` flow.

import { getInitialSettings } from '@claude-code/config/settings'

export function isAutoDreamEnabled(): boolean {
  // Default true — auto-memory users want consolidation unless they say
  // otherwise. Same default as the legacy stop-hook implementation.
  return getInitialSettings().autoDreamEnabled !== false
}
