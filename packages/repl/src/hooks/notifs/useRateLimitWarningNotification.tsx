import * as React from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNotifications } from '@claude-code/repl/notifications.js'
import { Text } from '@anthropic/ink'
import {
  getRateLimitWarning,
  getUsingOverageText,
} from '@claude-code/provider/claudeAiLimits.js'
import { useClaudeAiLimits } from '@claude-code/provider/claudeAiLimitsHook.js'
import { getSubscriptionType } from '@claude-code/provider/authAlias.js'
import { hasClaudeAiBillingAccess } from '@claude-code/provider/billing.js'
import { getIsRemoteMode } from '@claude-code/app-host/bootstrap/state.js'

export function useRateLimitWarningNotification(model: string): void {
  const { addNotification } = useNotifications()
  const claudeAiLimits = useClaudeAiLimits()
  // claudeAiLimits reference is stable until statusListeners fire (API
  // response), so these skip the Intl formatting work on most REPL renders.
  const rateLimitWarning = useMemo(
    () => getRateLimitWarning(claudeAiLimits, model),
    [claudeAiLimits, model],
  )
  const usingOverageText = useMemo(
    () => getUsingOverageText(claudeAiLimits),
    [claudeAiLimits],
  )
  const shownWarningRef = useRef<string | null>(null)
  const subscriptionType = getSubscriptionType()
  const hasBillingAccess = hasClaudeAiBillingAccess()
  const isTeamOrEnterprise =
    subscriptionType === 'team' || subscriptionType === 'enterprise'

  // Track overage mode transitions
  const [hasShownOverageNotification, setHasShownOverageNotification] =
    useState(false)

  // Show immediate notification when entering overage mode
  useEffect(() => {
    if (getIsRemoteMode()) return
    if (
      claudeAiLimits.isUsingOverage &&
      !hasShownOverageNotification &&
      (!isTeamOrEnterprise || hasBillingAccess)
    ) {
      addNotification({
        key: 'limit-reached',
        text: usingOverageText,
        priority: 'immediate',
      })
      setHasShownOverageNotification(true)
    } else if (!claudeAiLimits.isUsingOverage && hasShownOverageNotification) {
      // Reset when no longer in overage mode
      setHasShownOverageNotification(false)
    }
  }, [
    claudeAiLimits.isUsingOverage,
    usingOverageText,
    hasShownOverageNotification,
    addNotification,
    hasBillingAccess,
    isTeamOrEnterprise,
  ])

  // Show warning notification for approaching limits
  useEffect(() => {
    if (getIsRemoteMode()) return
    if (rateLimitWarning && rateLimitWarning !== shownWarningRef.current) {
      shownWarningRef.current = rateLimitWarning
      addNotification({
        key: 'rate-limit-warning',
        jsx: (
          <Text>
            <Text color="warning">{rateLimitWarning}</Text>
          </Text>
        ),
        priority: 'high',
      })
    }
  }, [rateLimitWarning, addNotification])
}
