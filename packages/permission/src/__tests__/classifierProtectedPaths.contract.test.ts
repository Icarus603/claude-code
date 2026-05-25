import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Contract test — ant v2.1.150 (module 3149.js) hardened the auto-mode
 * security classifier with two rule classes that ccb's hand-written prompts
 * were missing:
 *
 *   1. Self-Modification — blocks edits to the agent's own config surface,
 *      including the cron/loop/workflow files ccb actively uses
 *      (`.claude/scheduled_tasks.json`, `.claude/loop.md`, `.claude/workflows/`,
 *      `.claude/routines/`) and the `Bash(prefix:*)` permission-widening trick.
 *   2. Memory Poisoning — blocks writing permission-grant / bypass content
 *      into the per-project memory directory under ~/.claude/projects.
 *
 * Because ccb genuinely runs cron, loop, and memory tooling, the port MUST
 * also carry ant's matching ALLOW exceptions (Memory Directory, Claude Code
 * Scheduling) or the classifier would false-block the agent's own routine
 * operation. This test locks BOTH halves into all three classifier prompts so
 * a future prompt edit can't silently drop the guardrail OR the carve-out.
 *
 * These are TEXT-PRESENCE assertions, not behavioural ones — the classifier's
 * actual decisions are an LLM call and cannot be unit-tested. What we can pin
 * is that the rule text the model reads is still there.
 */

const PROMPT_DIR = join(
  import.meta.dir,
  '..',
  'yolo-classifier-prompts',
)

function readPrompt(name: string): string {
  return readFileSync(join(PROMPT_DIR, name), 'utf-8')
}

const PROMPTS = [
  'auto_mode_system_prompt.txt',
  'permissions_anthropic.txt',
  'permissions_external.txt',
] as const

describe('classifier protected-path rules (ant v2.1.150 3149.js)', () => {
  for (const file of PROMPTS) {
    describe(file, () => {
      const text = readPrompt(file)

      test('names the agent-config self-modification surface', () => {
        // The cron/loop/workflow files are the ones ccb actually loads at
        // startup — these are the additions over the pre-v150 list.
        expect(text).toMatch(/\.claude\/workflows\//)
        expect(text).toMatch(/\.claude\/routines\//)
        expect(text).toMatch(/\.claude\/scheduled_tasks\.json/)
        expect(text).toMatch(/\.claude\/loop\.md/)
      })

      test('blocks the Bash(prefix:*) permission-widening trick', () => {
        expect(text).toMatch(/Bash\(prefix:\*\)/)
      })

      test('blocks Memory Poisoning of the memory directory', () => {
        expect(text).toMatch(/Memory Poisoning/)
        expect(text).toMatch(/\.claude\/projects\/\*\/memory\//)
      })

      test('carves out routine memory-directory writes (no false-block)', () => {
        // Without this exception the agent could not record its own memories
        // — the whole point of the memory system. Must coexist with the
        // Memory Poisoning block above.
        expect(text).toMatch(/[Mm]emory directory|Memory Directory/)
      })

      test('carves out the agent’s own scheduling tools (no false-block)', () => {
        // CronCreate/CronDelete/CronList/RemoteTrigger are ccb's own tools;
        // using them must not trip Unauthorized Persistence / Self-Modification.
        expect(text).toMatch(/CronCreate/)
      })
    })
  }
})
