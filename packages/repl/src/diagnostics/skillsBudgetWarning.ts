/**
 * Skills budget warning — ported from ant v2.1.131 Ws7 (4142.js) +
 * pSK (5025.js). Surfaces a notification when the skill-listing
 * descriptions had to be truncated to fit the token budget.
 *
 * `budgetMode` semantics:
 *   - `fits`     — everything fit; no warning.
 *   - `truncate` — some descriptions trimmed to fit max desc chars.
 *   - `priority` — full set kept, but only highest-priority skills.
 *   - `drop`     — entire low-priority skills dropped from listing.
 *
 * Notification key `skill-budget-truncation`, priority `medium`,
 * `timeoutMs: 10000`. Matches ant BSK constant.
 */

export type SkillsBudgetMode = 'fits' | 'truncate' | 'priority' | 'drop'

export type SkillsBudgetStats = {
  budgetMode: SkillsBudgetMode
  cappedSkills: string[]
  budgetTruncatedSkills: string[]
  skillListingMaxDescChars?: number
  skillListingBudgetFraction?: number
}

export const SKILL_BUDGET_NOTIFICATION_KEY = 'skill-budget-truncation'
const SKILL_BUDGET_NOTIFICATION_TIMEOUT_MS = 10_000

export type SkillsBudgetWarning = {
  key: string
  text: string
  color: 'warning'
  priority: 'medium'
  timeoutMs: number
}

/**
 * Build a notification payload from skill-listing stats. Returns null
 * when `budgetMode === 'fits'` and no skills were capped — the listing
 * fit cleanly, no warning needed.
 */
export function buildSkillsBudgetWarning(
  stats: SkillsBudgetStats,
): SkillsBudgetWarning | null {
  if (
    stats.budgetMode === 'fits' &&
    stats.cappedSkills.length === 0 &&
    stats.budgetTruncatedSkills.length === 0
  ) {
    return null
  }
  let text: string
  if (stats.budgetMode === 'truncate' || stats.budgetTruncatedSkills.length > 0) {
    text = `Some skill descriptions were shortened to fit the token budget${stats.skillListingMaxDescChars ? ` (skillListingMaxDescChars = ${stats.skillListingMaxDescChars})` : ''}.`
  } else if (
    stats.budgetMode === 'drop' ||
    stats.budgetMode === 'priority'
  ) {
    text = `Skill listing will be truncated — ${stats.cappedSkills.length} skill(s) dropped to fit the token budget.`
  } else {
    return null
  }
  return {
    key: SKILL_BUDGET_NOTIFICATION_KEY,
    text,
    color: 'warning',
    priority: 'medium',
    timeoutMs: SKILL_BUDGET_NOTIFICATION_TIMEOUT_MS,
  }
}
