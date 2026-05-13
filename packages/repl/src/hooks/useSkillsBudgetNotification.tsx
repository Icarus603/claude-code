/**
 * Hook for surfacing skill-listing budget truncation warnings.
 *
 * Port of ant v2.1.131 Ws7 (4142.js) + pSK (5025.js): when the skill
 * listing had to be truncated to fit the token budget, surface a
 * one-shot notification so the user can decide whether to disable
 * some skills.
 *
 * The notification queue lives in app-host context; this hook is the
 * REPL-side consumer of the skillsBudgetWarning diagnostic builder.
 */
import * as React from 'react'
import { useAppState } from '../appStateHooks.js'
import { useNotifications } from '../notifications.js'
import {
  buildSkillsBudgetWarning,
  SKILL_BUDGET_NOTIFICATION_KEY,
} from '../diagnostics/skillsBudgetWarning.js'

/**
 * Watches AppState for `skillsBudgetStats` (set during startup skill
 * loading) and pushes a single notification when the budget mode
 * indicates truncation.
 */
export function useSkillsBudgetNotification(): void {
  const stats = useAppState(s => (s as { skillsBudgetStats?: unknown }).skillsBudgetStats)
  const { addNotification } = useNotifications()
  const shownRef = React.useRef(false)
  React.useEffect(() => {
    if (shownRef.current) return
    if (!stats) return
    const warning = buildSkillsBudgetWarning(stats as Parameters<typeof buildSkillsBudgetWarning>[0])
    if (!warning) return
    shownRef.current = true
    // Notification's `color` field is narrowed by source; warning.color is
    // 'warning' literal — the structural overlap is partial so we route
    // through `unknown` per ant Ws7's loose typing for the diagnostic
    // notification surface.
    const payload: unknown = {
      type: 'text',
      key: SKILL_BUDGET_NOTIFICATION_KEY,
      text: warning.text,
      color: warning.color,
      timeoutMs: warning.timeoutMs,
    }
    addNotification(payload as Parameters<typeof addNotification>[0])
  }, [stats, addNotification])
}
