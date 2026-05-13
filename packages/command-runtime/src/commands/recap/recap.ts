/**
 * `/recap` slash command body — calls generateAwaySummary on demand.
 * Mirrors ant v2.1.139 4703.js:bV3.
 */
import { generateAwaySummary } from '@claude-code/agent/awaySummary.js'
import type { LocalCommandCall } from '@claude-code/agent/command.js'

export const call: LocalCommandCall = async (_args, context) => {
  if (context.messages.length === 0) {
    return {
      type: 'text',
      value: 'Nothing to recap yet \u2014 send a message first.',
    }
  }
  try {
    const summary = await generateAwaySummary(
      context.messages,
      context.abortController.signal,
    )
    if (context.abortController.signal.aborted) {
      return { type: 'text', value: 'Recap cancelled.' }
    }
    if (summary === null) {
      return {
        type: 'text',
        value: "Couldn't generate a recap. Run with --debug for details.",
      }
    }
    return { type: 'text', value: summary }
  } catch (err) {
    if (context.abortController.signal.aborted) {
      return { type: 'text', value: 'Recap cancelled.' }
    }
    throw err
  }
}
