// /loop — recurring or self-paced prompt skill. Faithful port of upstream
// v2.1.123 (resplit/5085.js: registerLoopSkill / KS3 dynamic-mode body).
//
// When KAIROS_LOOP_DYNAMIC is off, behaves as the legacy ccb skill (only
// `[interval] <prompt>` accepted; bare prompts default to 10m). When on,
// adds two new modes:
//   - bare `/loop` → autonomous dynamic loop (sentinel + ScheduleWakeup)
//   - `/loop <prompt>` no interval → dynamic mode with that prompt

import {
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  DEFAULT_MAX_AGE_DAYS,
  isKairosCronEnabled,
} from '@claude-code/tool-registry/tools/ScheduleCronTool/prompt.js'
import { isLoopDynamicEnabled } from '@claude-code/agent/scheduler'
import {
  AUTONOMOUS_LOOP_DYNAMIC_SENTINEL,
  SCHEDULE_WAKEUP_TOOL_NAME,
} from '@claude-code/tool-registry/tools/ScheduleWakeupTool/prompt.js'
import { registerBundledSkill } from '../bundledSkills.js'

const DEFAULT_INTERVAL = '10m'

const INTERVAL_TABLE = `| Interval pattern      | Cron expression     | Notes                                    |
|-----------------------|---------------------|------------------------------------------|
| \`Nm\` where N ≤ 59   | \`*/N * * * *\`     | every N minutes                          |
| \`Nm\` where N ≥ 60   | \`0 */H * * *\`     | round to hours (H = N/60, must divide 24)|
| \`Nh\` where N ≤ 23   | \`0 */N * * *\`     | every N hours                            |
| \`Nd\`                | \`0 0 */N * *\`     | every N days at midnight local           |
| \`Ns\`                | treat as \`ceil(N/60)m\` | cron minimum granularity is 1 minute  |

**If the interval doesn't cleanly divide its unit** (e.g. \`7m\` → \`*/7 * * * *\` gives uneven gaps at :56→:00; \`90m\` → 1.5h which cron can't express), pick the nearest clean interval and tell the user what you rounded to before scheduling.`

const LEGACY_USAGE = `Usage: /loop [interval] <prompt>

Run a prompt or slash command on a recurring interval.

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, defaults to ${DEFAULT_INTERVAL}.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (defaults to ${DEFAULT_INTERVAL})
  /loop check the deploy every 20m`

const DYNAMIC_USAGE = `Usage: /loop [interval] <prompt>

Run a prompt or slash command on a recurring interval — or with no interval, let the model self-pace based on the task.

Intervals: Ns, Nm, Nh, Nd (e.g. 5m, 30m, 2h, 1d). Minimum granularity is 1 minute.
If no interval is specified, the model picks a delay between iterations based on what it's doing.

Examples:
  /loop 5m /babysit-prs
  /loop 30m check the deploy
  /loop 1h /standup 1
  /loop check the deploy          (dynamic — model picks delays)
  /loop check the deploy every 20m`

// Legacy (no KAIROS_LOOP_DYNAMIC) prompt body — defaults to 10m for any
// arg shape that doesn't carry an explicit interval.
function buildLegacyPrompt(args: string): string {
  return `# /loop — schedule a recurring prompt

Parse the input below into \`[interval] <prompt…>\` and schedule it with ${CRON_CREATE_TOOL_NAME}.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with \`every <N><unit>\` or \`every <N> <unit-word>\` (e.g. \`every 20m\`, \`every 5 minutes\`, \`every 2 hours\`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — \`check every PR\` has no interval.
3. **Default**: otherwise, interval is \`${DEFAULT_INTERVAL}\` and the entire input is the prompt.

If the resulting prompt is empty, show usage \`/loop [interval] <prompt>\` and stop — do not call ${CRON_CREATE_TOOL_NAME}.

Examples:
- \`5m /babysit-prs\` → interval \`5m\`, prompt \`/babysit-prs\` (rule 1)
- \`check the deploy every 20m\` → interval \`20m\`, prompt \`check the deploy\` (rule 2)
- \`run tests every 5 minutes\` → interval \`5m\`, prompt \`run tests\` (rule 2)
- \`check the deploy\` → interval \`${DEFAULT_INTERVAL}\`, prompt \`check the deploy\` (rule 3)
- \`check every PR\` → interval \`${DEFAULT_INTERVAL}\`, prompt \`check every PR\` (rule 3 — "every" not followed by time)
- \`5m\` → empty prompt → show usage

## Interval → cron

${INTERVAL_TABLE}

## Action

1. Call ${CRON_CREATE_TOOL_NAME} with:
   - \`cron\`: the expression from the table above
   - \`prompt\`: the parsed prompt from above, verbatim (slash commands are passed through unchanged)
   - \`recurring\`: \`true\`
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that they can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Input

${args}`
}

// KAIROS dynamic-mode prompt body — covers fixed-interval (rules 1, 2)
// AND dynamic mode (rule 3, no interval). Verbatim port of upstream KS3.
function buildDynamicPrompt(args: string): string {
  const dynamicSection = `The user wants you to self-pace. Decide what makes the next iteration worth running — a passage of time, or an observable event.

1. **Run the parsed prompt now.** If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.
2. **At the end of this turn, call ${SCHEDULE_WAKEUP_TOOL_NAME}** with:
   - \`delaySeconds\`: pick based on what you observed. Read the tool's own description for cache-aware delay guidance.
   - \`reason\`: one short sentence on why you picked that delay.
   - \`prompt\`: the full original /loop input verbatim, prefixed with \`/loop \` so the next firing re-enters this skill and continues the loop. For example, if the user typed \`/loop check the deploy\`, pass \`/loop check the deploy\` as the prompt.
3. **To stop the loop**, omit the ${SCHEDULE_WAKEUP_TOOL_NAME} call.
4. Briefly confirm: that you're self-pacing, that you ran the task now, and what fallback delay you picked.`

  return `# /loop — schedule a recurring or self-paced prompt

Parse the input below into \`[interval] <prompt…>\` and schedule it.

## Parsing (in priority order)

1. **Leading token**: if the first whitespace-delimited token matches \`^\\d+[smhd]$\` (e.g. \`5m\`, \`2h\`), that's the interval; the rest is the prompt.
2. **Trailing "every" clause**: otherwise, if the input ends with \`every <N><unit>\` or \`every <N> <unit-word>\` (e.g. \`every 20m\`, \`every 5 minutes\`, \`every 2 hours\`), extract that as the interval and strip it from the prompt. Only match when what follows "every" is a time expression — \`check every PR\` has no interval.
3. **No interval**: otherwise, the entire input is the prompt and you'll self-pace dynamically (see "Dynamic mode" below).

If the resulting prompt is empty, show usage \`/loop [interval] <prompt>\` and stop.

Examples:
- \`5m /babysit-prs\` → interval \`5m\`, prompt \`/babysit-prs\` (rule 1)
- \`check the deploy every 20m\` → interval \`20m\`, prompt \`check the deploy\` (rule 2)
- \`run tests every 5 minutes\` → interval \`5m\`, prompt \`run tests\` (rule 2)
- \`check the deploy\` → no interval → dynamic mode, prompt \`check the deploy\` (rule 3)
- \`check every PR\` → no interval → dynamic mode, prompt \`check every PR\` (rule 3 — "every" not followed by time)
- \`5m\` → empty prompt → show usage

## Fixed-interval mode (rules 1 and 2)

Convert the interval to a cron expression:

${INTERVAL_TABLE}

Then:
1. Call ${CRON_CREATE_TOOL_NAME} with: \`cron\` (the expression above), \`prompt\` (the parsed prompt verbatim), \`recurring: true\`.
2. Briefly confirm: what's scheduled, the cron expression, the human-readable cadence, that recurring tasks auto-expire after ${DEFAULT_MAX_AGE_DAYS} days, and that the user can cancel sooner with ${CRON_DELETE_TOOL_NAME} (include the job ID).
3. **Then immediately execute the parsed prompt now** — don't wait for the first cron fire. If it's a slash command, invoke it via the Skill tool; otherwise act on it directly.

## Dynamic mode (rule 3 — no interval)

${dynamicSection}

## Input

${args}`
}

// Bare /loop with no args under KAIROS — autonomous dynamic loop.
function buildAutonomousDynamicPrompt(): string {
  return `# /loop — autonomous default with dynamic pacing

The user invoked \`/loop\` with no prompt and no interval. Run the autonomous check now, then self-pace the next iteration via ${SCHEDULE_WAKEUP_TOOL_NAME} — no cron.

## Action

1. **Run the autonomous check now**, following the autonomous-loop instructions inlined below.
2. **At the end of this turn, call ${SCHEDULE_WAKEUP_TOOL_NAME}** with:
   - \`delaySeconds\`: pick based on what you observed this turn — quiet branch? wait longer. Lots in flight? wait shorter. Read the tool's own description for cache-aware delay guidance (default to 1200–1800s for idle ticks).
   - \`reason\`: one short sentence on why you picked that delay.
   - \`prompt\`: the literal string \`${AUTONOMOUS_LOOP_DYNAMIC_SENTINEL}\` — the dynamic-mode sentinel expands at fire time to the full instructions (first fire) or a dynamic-pacing-specific short reminder (subsequent fires). Do not pass the full instructions; that is handled automatically.
3. **To stop the loop**, omit the ${SCHEDULE_WAKEUP_TOOL_NAME} call.
4. Briefly confirm: that this is the autonomous default in dynamic-pacing mode, that you ran the check now, and what fallback delay you picked.`
}

export function registerLoopSkill(): void {
  registerBundledSkill({
    name: 'loop',
    aliases: ['proactive'],
    get description() {
      return isLoopDynamicEnabled()
        ? 'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo). Omit the interval to let the model self-pace.'
        : 'Run a prompt or slash command on a recurring interval (e.g. /loop 5m /foo, defaults to 10m)'
    },
    whenToUse:
      'When the user wants to set up a recurring task, poll for status, or run something repeatedly on an interval (e.g. "check the deploy every 5 minutes", "keep running /babysit-prs"). Do NOT invoke for one-off tasks.',
    argumentHint: '[interval] <prompt>',
    userInvocable: true,
    isEnabled: isKairosCronEnabled,
    async getPromptForCommand(args) {
      const trimmed = args.trim()
      if (isLoopDynamicEnabled()) {
        if (!trimmed) {
          return [{ type: 'text', text: buildAutonomousDynamicPrompt() }]
        }
        return [{ type: 'text', text: buildDynamicPrompt(trimmed) }]
      }
      // Legacy path (KAIROS_LOOP_DYNAMIC off): require [interval] <prompt>.
      if (!trimmed) {
        return [{ type: 'text', text: LEGACY_USAGE }]
      }
      return [{ type: 'text', text: buildLegacyPrompt(trimmed) }]
    },
  })
}

// Dynamic usage text exposed for tests and tooling. Not currently rendered
// in any code path (skill emits prompts above), but kept so a future help
// screen can pull from a single source.
export const DYNAMIC_USAGE_TEXT = DYNAMIC_USAGE
