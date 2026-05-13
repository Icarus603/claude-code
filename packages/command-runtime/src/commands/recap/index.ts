/**
 * `/recap` slash command — port of ant v2.1.139 C0K (4704.js).
 *
 * Generates the "while you were away" one-liner on demand. Reuses the
 * generateAwaySummary pipeline (packages/agent/awaySummary.ts) that the
 * auto-idle UI also uses, so behaviour stays consistent with the existing
 * tengu_sedge_lantern-gated card.
 *
 * Gated on tengu_sedge_lantern just like the idle path (ant 4704.js:9).
 */
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import type { Command } from '../../runtime.js'

const recap: Command = {
  type: 'local',
  name: 'recap',
  description: 'Generate a one-line session recap now',
  // ant 4704.js:9 — isEnabled: f_("tengu_sedge_lantern", true). The idle
  // path additionally checks tengu_sedge_lantern_holdback (3180.js:14);
  // mirror both so /recap and the away-summary card move together.
  isEnabled: () => {
    const enabled = getFeatureValue_CACHED_MAY_BE_STALE('tengu_sedge_lantern')
    const holdback = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_sedge_lantern_holdback',
    )
    return enabled === true && holdback !== true
  },
  supportsNonInteractive: false,
  load: () => import('./recap.js'),
}

export default recap
