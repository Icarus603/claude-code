// ScheduleWakeupTool — port of upstream v2.1.123 (resplit/3863.js).
// Signs the LLM up to be re-invoked at a clamped, cron-aligned future
// timestamp, in /loop dynamic-pacing mode. Tool returns null/zero output
// when the loop has aged out or the runtime gate is off — the model
// should treat that as "loop ended".

import * as React from 'react'
import { z } from 'zod/v4'
import { Text } from '@anthropic/ink'
import {
  isLoopDynamicEnabled,
  scheduleLoopWakeup,
} from '@claude-code/agent/scheduler'
import { lazySchema } from '../../utils/lazySchema.js'
import { buildTool, type Tool } from '../../Tool.js'
import { DESCRIPTION, PROMPT, SCHEDULE_WAKEUP_TOOL_NAME } from './prompt.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    delaySeconds: z
      .number()
      .describe(
        'Seconds from now to wake up. Clamped to [60, 3600]. The runtime aligns to whole minutes and may pull the wakeup back from the prompt-cache TTL boundary.',
      ),
    reason: z
      .string()
      .describe(
        'One short sentence on what you chose and why. Shown to the user and recorded in telemetry.',
      ),
    prompt: z
      .string()
      .describe(
        'The /loop prompt to fire next. Pass `<<autonomous-loop-dynamic>>` for an autonomous loop with no user-supplied task.',
      ),
  }),
)

type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    scheduledFor: z.number(),
    clampedDelaySeconds: z.number(),
    wasClamped: z.boolean(),
  }),
)

type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

export const _sdkInputSchema = inputSchema
export const _sdkOutputSchema = outputSchema

export const ScheduleWakeupTool: Tool<InputSchema, Output> = buildTool({
  name: SCHEDULE_WAKEUP_TOOL_NAME,
  searchHint:
    'self-pace next iteration: pick a delay before resuming work or running the next /loop tick',
  maxResultSizeChars: 1000,
  shouldDefer: true,
  isEnabled() {
    return isLoopDynamicEnabled()
  },
  isConcurrencySafe() {
    return true
  },
  isReadOnly() {
    // Doesn't touch files; only mutates session state.
    return true
  },
  userFacingName() {
    return ''
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  async description() {
    return DESCRIPTION
  },
  async prompt() {
    return PROMPT
  },
  async checkPermissions(input) {
    return { behavior: 'allow', updatedInput: input }
  },
  renderToolUseMessage() {
    // Stay quiet; the result message is the only useful surface here.
    return null
  },
  renderToolResultMessage(output) {
    if (output.scheduledFor === 0) {
      return <Text dimColor>loop ended</Text>
    }
    const time = new Date(output.scheduledFor).toTimeString().slice(0, 8)
    const inSec = Math.max(
      0,
      Math.round((output.scheduledFor - Date.now()) / 1000),
    )
    const clampedNote = output.wasClamped
      ? ` (clamped to ${output.clampedDelaySeconds}s)`
      : ''
    return (
      <Text dimColor>
        next wakeup {time} (in {inSec}s){clampedNote}
      </Text>
    )
  },
  mapToolResultToToolResultBlockParam(output, toolUseId) {
    if (output.scheduledFor === 0) {
      return {
        tool_use_id: toolUseId,
        type: 'tool_result',
        content:
          "Wakeup not scheduled. Either the /loop dynamic runtime gate is off or the loop reached its maximum duration — the loop has ended; do not re-issue.",
      }
    }
    const time = new Date(output.scheduledFor).toTimeString().slice(0, 8)
    const inSec = Math.max(
      0,
      Math.round((output.scheduledFor - Date.now()) / 1000),
    )
    const clampedNote = output.wasClamped
      ? ` (clamped to ${output.clampedDelaySeconds}s from your requested value)`
      : ''
    return {
      tool_use_id: toolUseId,
      type: 'tool_result',
      content: `Next wakeup scheduled for ${time} (in ${inSec}s)${clampedNote}.`,
    }
  },
  async call({ delaySeconds, reason, prompt }) {
    if (!isLoopDynamicEnabled()) {
      return {
        data: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false },
      }
    }
    const result = scheduleLoopWakeup(delaySeconds, prompt, reason) ?? null
    if (result === null) {
      return {
        data: { scheduledFor: 0, clampedDelaySeconds: 0, wasClamped: false },
      }
    }
    return {
      data: {
        scheduledFor: result.scheduledFor,
        clampedDelaySeconds: result.clampedDelaySeconds,
        wasClamped: result.wasClamped,
      },
    }
  },
})
