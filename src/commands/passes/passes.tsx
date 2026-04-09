import * as React from 'react'
import { Passes } from '../../components/Passes/Passes.js'
import { logEvent } from '../../services/eventLogger.js'
import { getCachedRemainingPasses } from '../../services/api/referral.js'
import type { LocalJSXCommandOnDone } from '../../types/command.js'
import { getGlobalConfig, saveGlobalConfig } from '@claude-code/config'

export async function call(
  onDone: LocalJSXCommandOnDone,
): Promise<React.ReactNode> {
  // Mark that user has visited /passes so we stop showing the upsell
  const config = getGlobalConfig()
  const isFirstVisit = !config.hasVisitedPasses
  if (isFirstVisit) {
    const remaining = getCachedRemainingPasses()
    saveGlobalConfig(current => ({
      ...current,
      hasVisitedPasses: true,
      passesLastSeenRemaining: remaining ?? current.passesLastSeenRemaining,
    }))
  }
  logEvent('tengu_guest_passes_visited', { is_first_visit: isFirstVisit })
  return <Passes onDone={onDone} />
}
