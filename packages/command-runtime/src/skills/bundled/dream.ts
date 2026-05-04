// /dream skill — three sub-modes ported from upstream v2.1.123
// (bun-demincer/work/claude-code-2.1.123/resplit/5084.js: lh3/nh3/ih3/rh3).
//
//   1. /dream            — manual consolidation now (foreground; full tools)
//   2. /dream nightly    — emit instructions telling the model to use
//                          CronList/CronDelete/CronCreate to install (or
//                          renew) a recurring "/dream consolidate" cron
//   3. /dream consolidate — same as (1) but without the manual-mode preface,
//                          fired by cron tick or invoked manually
//
// The cron-driven path replaces ccb's prior stop-hook-driven autoDream.

import { feature } from 'bun:bundle'
import { isAutoMemoryEnabled } from '@claude-code/memory'
import { buildConsolidationPrompt, getAutoMemPath } from '@claude-code/memory'
import { isTeamMemoryEnabled } from '@claude-code/memory'
import { getOriginalCwd } from '@claude-code/app-host/bootstrap/state.js'
import { getIsRemoteMode } from '@claude-code/app-host/bootstrap/state.js'
import { getProjectDir } from '@claude-code/storage/sessionStorage.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { DEFAULT_CRON_JITTER_CONFIG } from '@claude-code/agent/scheduler'
import { CRON_CREATE_TOOL_NAME, CRON_DELETE_TOOL_NAME, CRON_LIST_TOOL_NAME } from '@claude-code/tool-registry/tools/ScheduleCronTool/prompt.js'
import { registerBundledSkill } from '../bundledSkills.js'

const DREAM_PROMPT_PREFIX = `# Dream: Memory Consolidation (manual run)

You are performing a manual dream — a reflective pass over your memory files. Unlike the automatic background dream, this run has full tool permissions and the user is watching. Synthesize what you've learned recently into durable, well-organized memories so that future sessions can orient quickly.

`

const SCHEDULE_KEYWORD = 'nightly'
const CONSOLIDATE_KEYWORD = 'consolidate'

// Upstream lh3 — three-condition AND: not remote, auto-memory on, KAIROS
// dream gate true (default false; ccb pins true via LOCAL_GATE_DEFAULTS).
function isDreamSkillEnabled(): boolean {
  if (getIsRemoteMode()) return false
  if (!isAutoMemoryEnabled()) return false
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_kairos_dream', false)
}

// Upstream nh3 — pick a random minute in the 0–360 range and split into
// (minute, hour). Means the cron fires at any minute between 00:00 and 05:59
// local time. Spreading reduces thundering-herd impact for users who run
// multiple ccb sessions on the same machine.
function generateNightlyCron(): string {
  const minuteOfDay = Math.floor(Math.random() * 360)
  const minute = minuteOfDay % 60
  const hour = Math.floor(minuteOfDay / 60)
  return `${minute} ${hour} * * *`
}

function formatLocalTime(cron: string): string {
  const [m = '0', h = '3'] = cron.split(' ')
  const hour = Number.parseInt(h, 10)
  const minute = Number.parseInt(m, 10)
  const ampm = hour < 12 ? 'am' : 'pm'
  const display = hour === 0 ? 12 : hour > 12 ? hour - 12 : hour
  return `${display}:${minute.toString().padStart(2, '0')}${ampm}`
}

function buildSchedulePrompt(
  memoryRoot: string,
  transcriptDir: string,
  cron: string,
  extra: string,
  teamMemoryEnabled: boolean,
): string {
  const localTime = formatLocalTime(cron)
  const expiryDays = Math.round(
    DEFAULT_CRON_JITTER_CONFIG.recurringMaxAgeMs / (24 * 60 * 60 * 1000),
  )
  return `# Dream: Schedule Nightly Consolidation

The user wants to set up a recurring nightly memory consolidation job.

**Step 1 — Dedup any existing nightly job**

Call ${CRON_LIST_TOOL_NAME} and check for an existing task with prompt \`"/dream consolidate"\`. If one exists, delete it with ${CRON_DELETE_TOOL_NAME} first so renewal doesn't leave overlapping jobs.

**Step 2 — Schedule**

Call ${CRON_CREATE_TOOL_NAME} with:
- \`cron\`: \`"${cron}"\`
- \`prompt\`: \`"/dream consolidate"\`
- \`recurring\`: true
- \`durable\`: true

(The \`consolidate\` suffix means the cron-fired prompt won't match scheduling keywords when it fires (so it runs the consolidation path), and resolves via the primary skill name on both bundled and disk skills.)

**Step 3 — Confirm**

Tell the user:
- /dream will run nightly at ~${localTime} local to consolidate and organize memories
- The schedule persists across sessions (written to .claude/scheduled_tasks.json)
- Recurring tasks auto-expire after ${expiryDays} days — re-run \`/dream nightly\` to renew
- Cancel anytime with ${CRON_DELETE_TOOL_NAME} (include the job ID)

**Step 4 — Run an immediate consolidation**

${buildConsolidationPrompt(memoryRoot, transcriptDir, extra, teamMemoryEnabled)}`
}

export function registerDreamSkill(): void {
  registerBundledSkill({
    name: 'dream',
    aliases: ['learn'],
    description:
      'Reflective memory consolidation — review recent activity, synthesize learnings into typed memory files, and prune stale entries.',
    whenToUse:
      'When the user wants Claude to reflect on and consolidate its memories, organize topic files, prune stale entries, or schedule nightly consolidation. Trigger phrases: "dream", "learn", "dream nightly", "consolidate memories", "learn from your experiences", "organize your memories".',
    argumentHint: '[nightly]',
    userInvocable: true,
    isEnabled: () => {
      // KAIROS_DREAM build flag controls whether the skill compiles in.
      // Runtime gate (lh3 equivalent) controls whether it shows in the UI.
      if (!feature('KAIROS_DREAM')) {
        // Pre-KAIROS path: simple manual /dream still works whenever
        // auto-memory is on, regardless of tengu_kairos_dream gate.
        return isAutoMemoryEnabled()
      }
      return isDreamSkillEnabled()
    },
    async getPromptForCommand(args) {
      const memoryRoot = getAutoMemPath()
      const transcriptDir = getProjectDir(getOriginalCwd())
      const teamMemoryEnabled = isTeamMemoryEnabled()
      const trimmed = args.trim()

      // /dream consolidate — same body as /dream but no manual-mode preface.
      // Used both by cron-fired ticks and manual reruns of the same prompt.
      const consolidateOnly = trimmed === CONSOLIDATE_KEYWORD
      const restAfterKeyword = consolidateOnly
        ? ''
        : trimmed.startsWith(`${CONSOLIDATE_KEYWORD} `)
          ? trimmed.slice(CONSOLIDATE_KEYWORD.length + 1).trim()
          : trimmed

      // /dream nightly [extra] — emit scheduling instructions, gated on
      // KAIROS_DREAM (no point telling the model to schedule a cron when
      // the cron-driven path isn't compiled in).
      if (
        feature('KAIROS_DREAM') &&
        (trimmed === SCHEDULE_KEYWORD ||
          trimmed.startsWith(`${SCHEDULE_KEYWORD} `))
      ) {
        const extra = trimmed.startsWith(`${SCHEDULE_KEYWORD} `)
          ? trimmed.slice(SCHEDULE_KEYWORD.length + 1).trim()
          : ''
        const cron = generateNightlyCron()
        return [
          {
            type: 'text',
            text: buildSchedulePrompt(
              memoryRoot,
              transcriptDir,
              cron,
              extra,
              teamMemoryEnabled,
            ),
          },
        ]
      }

      // /dream consolidate [extra] — bare consolidation prompt, no preface.
      if (consolidateOnly || (trimmed.startsWith(`${CONSOLIDATE_KEYWORD} `))) {
        return [
          {
            type: 'text',
            text: buildConsolidationPrompt(
              memoryRoot,
              transcriptDir,
              restAfterKeyword,
              teamMemoryEnabled,
            ),
          },
        ]
      }

      // /dream [extra] — manual run with prefix.
      const basePrompt = buildConsolidationPrompt(
        memoryRoot,
        transcriptDir,
        '',
        teamMemoryEnabled,
      )
      let prompt = DREAM_PROMPT_PREFIX + basePrompt
      if (trimmed) {
        prompt += `\n\n## Additional context from user\n\n${trimmed}`
      }
      return [{ type: 'text', text: prompt }]
    },
  })
}
