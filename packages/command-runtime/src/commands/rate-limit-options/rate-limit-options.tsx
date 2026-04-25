import React, { useMemo, useState } from 'react'
import type {
  CommandResultDisplay,
  LocalJSXCommandContext,
} from '@claude-code/command-runtime/runtime'
import {
  type OptionWithDescription,
  Select,
} from '@claude-code/repl/components/CustomSelect/select.js'
import { Dialog } from '@anthropic/ink'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { logEvent } from '@claude-code/local-observability'
import { useClaudeAiLimits } from '@claude-code/provider/claudeAiLimitsHook.js'
import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'
import type { LocalJSXCommandOnDone } from '@claude-code/agent/command.js'
import {
  getOauthAccountInfo,
  getRateLimitTier,
  getSubscriptionType,
} from '@claude-code/provider/authAlias.js'
import { hasClaudeAiBillingAccess } from '@claude-code/provider/billing.js'
import { call as extraUsageCall } from '@claude-code/command-runtime/commands/extra-usage/extra-usage.js'
import { extraUsage } from '@claude-code/repl/extraUsage.js'
import upgrade from '@claude-code/command-runtime/commands/upgrade/index.js'
import { call as upgradeCall } from '@claude-code/command-runtime/commands/upgrade/upgrade.js'

type RateLimitOptionsMenuOptionType = 'upgrade' | 'extra-usage' | 'cancel'

type RateLimitOptionsMenuProps = {
  onDone: (
    result?: string,
    options?:
      | {
          display?: CommandResultDisplay | undefined
        }
      | undefined,
  ) => void
  context: ToolUseContext & LocalJSXCommandContext
}

function RateLimitOptionsMenu({
  onDone,
  context,
}: RateLimitOptionsMenuProps): React.ReactNode {
  const [subCommandJSX, setSubCommandJSX] = useState<React.ReactNode>(null)
  const claudeAiLimits = useClaudeAiLimits()
  const subscriptionType = getSubscriptionType()
  const rateLimitTier = getRateLimitTier()
  const hasExtraUsageEnabled =
    getOauthAccountInfo()?.hasExtraUsageEnabled === true
  const isMax = subscriptionType === 'max'
  const isMax20x = isMax && rateLimitTier === 'default_claude_max_20x'
  const isTeamOrEnterprise =
    subscriptionType === 'team' || subscriptionType === 'enterprise'
  const buyFirst = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_jade_anvil_4',
    false,
  )

  const options = useMemo<
    OptionWithDescription<RateLimitOptionsMenuOptionType>[]
  >(() => {
    const actionOptions: OptionWithDescription<RateLimitOptionsMenuOptionType>[] =
      []

    if (extraUsage.isEnabled()) {
      const hasBillingAccess = hasClaudeAiBillingAccess()
      const needsToRequestFromAdmin = isTeamOrEnterprise && !hasBillingAccess
      // Org spend cap depleted - non-admins can't request more since there's nothing to allocate
      // - out_of_credits: wallet empty
      // - org_level_disabled_until: org spend cap hit for the month
      // - org_service_zero_credit_limit: org service has zero credit limit
      const isOrgSpendCapDepleted =
        claudeAiLimits.overageDisabledReason === 'out_of_credits' ||
        claudeAiLimits.overageDisabledReason === 'org_level_disabled_until' ||
        claudeAiLimits.overageDisabledReason === 'org_service_zero_credit_limit'

      // Hide for non-admin Team/Enterprise users when org spend cap is depleted
      if (needsToRequestFromAdmin && isOrgSpendCapDepleted) {
        // Don't show extra-usage option
      } else {
        const isOverageState =
          claudeAiLimits.overageStatus === 'rejected' ||
          claudeAiLimits.overageStatus === 'allowed_warning'

        let label: string
        if (needsToRequestFromAdmin) {
          label = isOverageState ? 'Request more' : 'Request extra usage'
        } else {
          label = hasExtraUsageEnabled
            ? 'Add funds to continue with extra usage'
            : 'Switch to extra usage'
        }

        actionOptions.push({
          label,
          value: 'extra-usage',
        })
      }
    }

    if (!isMax20x && !isTeamOrEnterprise && upgrade.isEnabled()) {
      actionOptions.push({
        label: 'Upgrade your plan',
        value: 'upgrade',
      })
    }

    const cancelOption: OptionWithDescription<RateLimitOptionsMenuOptionType> =
      {
        label: 'Stop and wait for limit to reset',
        value: 'cancel',
      }

    if (buyFirst) {
      return [...actionOptions, cancelOption]
    }
    return [cancelOption, ...actionOptions]
  }, [
    buyFirst,
    isMax20x,
    isTeamOrEnterprise,
    hasExtraUsageEnabled,
    claudeAiLimits.overageStatus,
    claudeAiLimits.overageDisabledReason,
  ])

  function handleCancel(): void {
    logEvent('tengu_rate_limit_options_menu_cancel', {})
    onDone(undefined, { display: 'skip' })
  }

  function handleSelect(value: RateLimitOptionsMenuOptionType): void {
    if (value === 'upgrade') {
      logEvent('tengu_rate_limit_options_menu_select_upgrade', {})
      void upgradeCall(onDone, context).then(jsx => {
        if (jsx) {
          setSubCommandJSX(jsx)
        }
      })
    } else if (value === 'extra-usage') {
      logEvent('tengu_rate_limit_options_menu_select_extra_usage', {})
      void extraUsageCall(onDone, context).then(jsx => {
        if (jsx) {
          setSubCommandJSX(jsx)
        }
      })
    } else if (value === 'cancel') {
      handleCancel()
    }
  }

  if (subCommandJSX) {
    return subCommandJSX
  }

  return (
    <Dialog
      title="What do you want to do?"
      onCancel={handleCancel}
      color="suggestion"
    >
      <Select<RateLimitOptionsMenuOptionType>
        options={options}
        onChange={handleSelect}
        visibleOptionCount={options.length}
      />
    </Dialog>
  )
}

export async function call(
  onDone: LocalJSXCommandOnDone,
  context: ToolUseContext & LocalJSXCommandContext,
): Promise<React.ReactNode> {
  return <RateLimitOptionsMenu onDone={onDone} context={context} />
}
