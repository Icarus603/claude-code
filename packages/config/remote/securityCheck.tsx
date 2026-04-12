/**
 * V7 §8.24 — Managed settings security check delegation.
 *
 * The React/Ink security dialog (ManagedSettingsSecurityDialog) is a UI
 * component that does not belong in config (Wave 1 leaf). The full
 * implementation lives at the host side (src/services/packageHostSetup.ts)
 * and is injected via ConfigHostBindings. Config only cares about the result.
 */
import { getConfigHostBindings } from '../host.js'
import type { SettingsJson } from '../settings/types.js'

export type SecurityCheckResult = 'approved' | 'rejected' | 'no_check_needed'

/**
 * Check if new remote managed settings contain dangerous settings that
 * require user approval. Delegates to the host binding which renders the
 * Ink dialog in interactive mode.
 */
export async function checkManagedSettingsSecurity(
  cachedSettings: SettingsJson | null,
  newSettings: SettingsJson | null,
): Promise<SecurityCheckResult> {
  const check = getConfigHostBindings().checkManagedSettingsSecurity
  if (!check) return 'no_check_needed'
  return check(cachedSettings, newSettings)
}

/**
 * Handle the security check result by exiting if rejected.
 * Returns true if we should continue, false if we should stop.
 */
export function handleSecurityCheckResult(
  result: SecurityCheckResult,
): boolean {
  const handle = getConfigHostBindings().handleSecurityCheckResult
  if (!handle) return result !== 'rejected'
  return handle(result)
}
