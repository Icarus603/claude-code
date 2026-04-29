/**
 * Tests for cron tool prompt builders — pure helpers that build the
 * model-facing tool description/prompt depending on whether durable
 * (disk-persistent) cron is enabled.
 *
 * Wrong gating = either model gets told it can persist tasks when
 * the durable feature is off (silent task loss on session end), or
 * model is denied the durable: true option even though it's available.
 */
import { describe, expect, test } from 'bun:test'
import {
  buildCronCreateDescription,
  buildCronCreatePrompt,
  buildCronDeletePrompt,
  buildCronListPrompt,
  CRON_CREATE_TOOL_NAME,
  CRON_DELETE_TOOL_NAME,
  CRON_LIST_TOOL_NAME,
} from '../prompt.js'

describe('buildCronCreateDescription', () => {
  test('durable=true: mentions durable option + scheduled_tasks.json', () => {
    const r = buildCronCreateDescription(true)
    expect(r).toContain('durable: true')
    expect(r).toContain('.claude/scheduled_tasks.json')
    expect(r).toContain('session-only')
  })

  test('durable=false: NO durable mentions, session-only language', () => {
    const r = buildCronCreateDescription(false)
    expect(r).not.toContain('durable: true')
    expect(r).not.toContain('scheduled_tasks.json')
    expect(r).toContain('this Claude session')
  })

  test('both variants mention "Schedule" + "future"', () => {
    expect(buildCronCreateDescription(true)).toContain('Schedule')
    expect(buildCronCreateDescription(false)).toContain('Schedule')
  })
})

describe('buildCronCreatePrompt', () => {
  test('durable=true: includes durability section', () => {
    const r = buildCronCreatePrompt(true)
    expect(r).toContain('## Durability')
    expect(r).toContain('durable: true')
    expect(r).toContain('survives restarts')
  })

  test('durable=false: includes session-only section, NOT durability', () => {
    const r = buildCronCreatePrompt(false)
    expect(r).toContain('## Session-only')
    expect(r).not.toContain('## Durability')
    expect(r).not.toContain('durable: true')
  })

  test('always includes one-shot and recurring sections', () => {
    expect(buildCronCreatePrompt(true)).toContain('## One-shot tasks')
    expect(buildCronCreatePrompt(true)).toContain('## Recurring jobs')
    expect(buildCronCreatePrompt(false)).toContain('## One-shot tasks')
    expect(buildCronCreatePrompt(false)).toContain('## Recurring jobs')
  })

  test('always includes off-minute guidance (load distribution)', () => {
    // Documented contract: discourages :00 and :30 minute marks.
    const t = buildCronCreatePrompt(true)
    const f = buildCronCreatePrompt(false)
    expect(t).toContain('Avoid the :00 and :30')
    expect(f).toContain('Avoid the :00 and :30')
  })

  test('always returns a job ID + references CronDelete', () => {
    expect(buildCronCreatePrompt(true)).toContain(CRON_DELETE_TOOL_NAME)
    expect(buildCronCreatePrompt(false)).toContain(CRON_DELETE_TOOL_NAME)
  })

  test('always mentions max-age days for recurring tasks', () => {
    expect(buildCronCreatePrompt(true)).toMatch(/\d+-day limit/)
    expect(buildCronCreatePrompt(false)).toMatch(/\d+-day limit/)
  })

  test('durable=true: runtime note mentions catch-up + .claude/scheduled_tasks.json', () => {
    const r = buildCronCreatePrompt(true)
    expect(r).toContain('catch-up')
    expect(r).toContain('.claude/scheduled_tasks.json')
  })

  test('durable=false: runtime note OMITS durable details', () => {
    const r = buildCronCreatePrompt(false)
    expect(r).not.toContain('catch-up')
    expect(r).not.toContain('Durable jobs')
  })
})

describe('buildCronDeletePrompt', () => {
  test('always references CronCreate (round-trip pattern)', () => {
    expect(buildCronDeletePrompt(true)).toContain(CRON_CREATE_TOOL_NAME)
    expect(buildCronDeletePrompt(false)).toContain(CRON_CREATE_TOOL_NAME)
  })

  test('durable=true mentions both stores (durable + session-only)', () => {
    const r = buildCronDeletePrompt(true)
    expect(r).toContain('durable')
    expect(r).toContain('session-only')
  })

  test('durable=false mentions only in-memory session store', () => {
    const r = buildCronDeletePrompt(false)
    expect(r).toContain('in-memory')
    expect(r).not.toContain('.claude/scheduled_tasks.json')
  })
})

describe('buildCronListPrompt', () => {
  test('always references CronCreate', () => {
    expect(buildCronListPrompt(true)).toContain(CRON_CREATE_TOOL_NAME)
    expect(buildCronListPrompt(false)).toContain(CRON_CREATE_TOOL_NAME)
  })

  test('durable=true: mentions BOTH durable + session-only', () => {
    const r = buildCronListPrompt(true)
    expect(r).toContain('durable')
    expect(r).toContain('session-only')
    expect(r).toContain('.claude/scheduled_tasks.json')
  })

  test('durable=false: ONLY this session', () => {
    const r = buildCronListPrompt(false)
    expect(r).toContain('this session')
    expect(r).not.toContain('scheduled_tasks.json')
  })
})

describe('Tool name constants', () => {
  test('all three constants are short, exact strings', () => {
    expect(CRON_CREATE_TOOL_NAME).toBe('CronCreate')
    expect(CRON_DELETE_TOOL_NAME).toBe('CronDelete')
    expect(CRON_LIST_TOOL_NAME).toBe('CronList')
  })

  test('all three are CapitalCase', () => {
    expect(CRON_CREATE_TOOL_NAME[0]).toBe(CRON_CREATE_TOOL_NAME[0]?.toUpperCase())
    expect(CRON_DELETE_TOOL_NAME[0]).toBe(CRON_DELETE_TOOL_NAME[0]?.toUpperCase())
    expect(CRON_LIST_TOOL_NAME[0]).toBe(CRON_LIST_TOOL_NAME[0]?.toUpperCase())
  })
})
