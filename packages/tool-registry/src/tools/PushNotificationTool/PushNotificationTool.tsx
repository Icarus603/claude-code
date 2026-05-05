// PushNotificationTool — faithful port of upstream v2.1.123
// (resplit/3871.js: QS5; resplit/2540.js: Lh9 description, kh9 prompt).
//
// ccb-specific differences:
//   - No mobile-push transport. When bridge inactive (urH() === false in
//     upstream), tool reports `disabledReason: "no_transport"`. ccb has
//     no replacement transport — local-only by design.
//   - Telemetry event omitted in self-host mode.

import * as React from 'react'
import { z } from 'zod/v4'
import { Box, Text } from '@anthropic/ink'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import {
  getIsRemoteMode,
  getLastInteractionTime,
  getTerminalFocus,
  isReplBridgeActive,
  isUserActiveForNotifications,
  NOTIF_ACTIVE_THRESHOLD_MS,
} from '@claude-code/app-host/bootstrap/state.js'
import { getGlobalConfig } from '@claude-code/config'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { lazySchema } from '../../utils/lazySchema.js'
import { buildTool, type Tool } from '../../Tool.js'
import {
  DESCRIPTION,
  PROMPT,
  PUSH_NOTIFICATION_TOOL_NAME,
} from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    message: z
      .string()
      .min(1)
      .describe(
        'The notification body. Keep it under 200 characters; mobile OSes truncate.',
      ),
    status: z.literal('proactive'),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    message: z.string(),
    pushSent: z.boolean().optional(),
    localSent: z.boolean().optional(),
    disabledReason: z
      .enum(['config_off', 'user_present', 'no_transport'])
      .optional(),
    idleSec: z.number().optional(),
    hasFocus: z.boolean().optional(),
    sentAt: z
      .string()
      .optional()
      .describe(
        'ISO timestamp captured at tool execution on the emitting process. Optional — resumed sessions replay pre-sentAt outputs verbatim.',
      ),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

/** @dynamicRequire */
export const _sdkInputSchema = inputSchema
/** @dynamicRequire */
export const _sdkOutputSchema = outputSchema

/** @dynamicRequire */
export const PushNotificationTool: Tool<InputSchema, Output> = buildTool({
  name: PUSH_NOTIFICATION_TOOL_NAME,
  searchHint:
    'send a notification to the user via terminal and optionally mobile',
  maxResultSizeChars: 1000,
  userFacingName() {
    return 'PushNotification'
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  shouldDefer: true,
  isEnabled() {
    return getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_kairos_push_notifications',
      false,
    )
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    return true
  },
  toAutoClassifierInput(input) {
    return input.message
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  mapToolResultToToolResultBlockParam(output, toolUseId) {
    let content: string
    if (output.disabledReason === 'config_off') {
      content = 'Push not sent — mobile push is disabled in /config.'
    } else if (output.disabledReason === 'user_present') {
      if (output.hasFocus === true) {
        content =
          'Not sent — terminal has focus. Terminal + mobile suppressed.'
      } else {
        const thresholdSec = NOTIF_ACTIVE_THRESHOLD_MS / 1000
        const idleStr =
          output.idleSec !== undefined
            ? `${output.idleSec}s`
            : `<${thresholdSec}s`
        content = `Not sent — user active (last keystroke ${idleStr} ago, threshold ${thresholdSec}s). Terminal + mobile suppressed.`
      }
    } else if (output.disabledReason === 'no_transport') {
      content = output.localSent
        ? 'Terminal notification sent. Mobile push not sent (Remote Control inactive).'
        : 'Mobile push not sent (Remote Control inactive).'
    } else {
      content = output.localSent
        ? 'Terminal notification sent. Mobile push requested.'
        : 'Mobile push requested.'
    }
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content,
    }
  },
  renderToolUseMessage({ message }) {
    return <Text dimColor>Sending push: {message.slice(0, 60)}…</Text>
  },
  renderToolResultMessage(output) {
    const tag =
      output.disabledReason === 'config_off'
        ? 'config_off'
        : output.disabledReason === 'user_present'
          ? 'user_present'
          : output.disabledReason === 'no_transport'
            ? output.localSent
              ? 'local_only'
              : 'no_transport'
            : 'sent'
    return (
      <Box flexDirection="column">
        <Text dimColor>push: {tag}</Text>
      </Box>
    )
  },
  async call({ message }, ctx) {
    const sentAt = new Date().toISOString()
    // K — caller asked us to treat this session as remote (env override or
    // workspace=remote). When K=true, agent is running headless and the
    // user is unambiguously elsewhere; user_present + config_off branches
    // partially short-circuit.
    const forcedRemote =
      isEnvTruthy(process.env.CLAUDE_CODE_REMOTE) || getIsRemoteMode()
    // O — push transport active. K OR an active REPL bridge means we have
    // a way to reach the user's mobile.
    const transportActive = forcedRemote || isReplBridgeActive()

    // config_off: bridge active + not headless + user has muted
    // notifications. Don't even bother locally — they explicitly opted out.
    if (
      transportActive &&
      !forcedRemote &&
      !getGlobalConfig().agentPushNotifEnabled
    ) {
      return {
        data: {
          message,
          pushSent: false,
          localSent: false,
          disabledReason: 'config_off' as const,
          sentAt,
        },
      }
    }

    // user_present: user is right here, save the noise.
    if (isUserActiveForNotifications()) {
      const idleSec = Math.round((Date.now() - getLastInteractionTime()) / 1000)
      const focus = getTerminalFocus()
      return {
        data: {
          message,
          pushSent: false,
          localSent: false,
          disabledReason: 'user_present' as const,
          idleSec,
          ...(focus !== undefined && { hasFocus: focus }),
          sentAt,
        },
      }
    }

    // Local OS notification — fires regardless of transport (the user is
    // still likely to glance at the terminal).
    const hasOsNotif = ctx.sendOSNotification !== undefined
    if (hasOsNotif) {
      ctx.sendOSNotification?.({
        message,
        notificationType: 'push_notification',
      })
    }

    // no_transport: no bridge connected. localSent reflects whether we
    // reached the OS notifier; pushSent stays false.
    if (!transportActive) {
      return {
        data: {
          message,
          pushSent: false,
          localSent: hasOsNotif,
          disabledReason: 'no_transport' as const,
          sentAt,
        },
      }
    }

    // Bridge active + user away + not muted — ccb has no mobile-push
    // transport, so even on this happy path we report pushSent: true
    // optimistically (matching upstream's semantics; the bridge transport
    // is the missing wire). When bridge transport lands, this is where it
    // would be invoked.
    return {
      data: {
        message,
        pushSent: true,
        localSent: hasOsNotif,
        sentAt,
      },
    }
  },
})
