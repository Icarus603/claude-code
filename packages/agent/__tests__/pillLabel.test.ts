import { describe, expect, test } from 'bun:test'
import { getPillLabel, pillNeedsCta } from '../tasks/pillLabel.js'
import { DIAMOND_FILLED, DIAMOND_OPEN } from '@claude-code/output/constants/figures.js'

// We supply unsafe-cast `BackgroundTaskState` shapes — pillLabel only reads
// the discriminator + a few branch-specific fields, never the full task
// state. The cast keeps these fixtures terse without pulling in the
// full task-state schema.
type Task = Parameters<typeof getPillLabel>[0][number]

function bash(kind: 'shell' | 'monitor' = 'shell'): Task {
  return { type: 'local_bash', kind } as Task
}
function teammate(teamName: string): Task {
  return {
    type: 'in_process_teammate',
    identity: { teamName },
  } as Task
}
function localAgent(): Task {
  return { type: 'local_agent' } as Task
}
function remoteAgent(opts: {
  isUltraplan?: boolean
  ultraplanPhase?: 'plan_ready' | 'needs_input'
} = {}): Task {
  return {
    type: 'remote_agent',
    isUltraplan: opts.isUltraplan,
    ultraplanPhase: opts.ultraplanPhase,
  } as Task
}
function workflow(): Task {
  return { type: 'local_workflow' } as Task
}
function monitorMcp(): Task {
  return { type: 'monitor_mcp' } as Task
}
function dream(): Task {
  return { type: 'dream' } as Task
}

describe('getPillLabel — local_bash', () => {
  test('1 shell', () => {
    expect(getPillLabel([bash('shell')])).toBe('1 shell')
  })
  test('2 shells (plural)', () => {
    expect(getPillLabel([bash('shell'), bash('shell')])).toBe('2 shells')
  })
  test('1 monitor only', () => {
    expect(getPillLabel([bash('monitor')])).toBe('1 monitor')
  })
  test('2 monitors (plural)', () => {
    expect(getPillLabel([bash('monitor'), bash('monitor')])).toBe('2 monitors')
  })
  test('mixed shell + monitor — joined by ", "', () => {
    expect(
      getPillLabel([bash('shell'), bash('shell'), bash('monitor')]),
    ).toBe('2 shells, 1 monitor')
  })
})

describe('getPillLabel — in_process_teammate', () => {
  test('all members in 1 team', () => {
    expect(
      getPillLabel([teammate('alpha'), teammate('alpha'), teammate('alpha')]),
    ).toBe('1 team')
  })
  test('members spread across multiple teams', () => {
    expect(
      getPillLabel([teammate('alpha'), teammate('beta'), teammate('alpha')]),
    ).toBe('2 teams')
  })
})

describe('getPillLabel — local_agent', () => {
  test('1 local agent', () => {
    expect(getPillLabel([localAgent()])).toBe('1 local agent')
  })
  test('2 local agents (plural)', () => {
    expect(getPillLabel([localAgent(), localAgent()])).toBe('2 local agents')
  })
})

describe('getPillLabel — remote_agent (ultraplan branch)', () => {
  test('single ultraplan, plan_ready phase → DIAMOND_FILLED', () => {
    const label = getPillLabel([
      remoteAgent({ isUltraplan: true, ultraplanPhase: 'plan_ready' }),
    ])
    expect(label).toContain(DIAMOND_FILLED)
    expect(label).toContain('ultraplan ready')
  })
  test('single ultraplan, needs_input phase → DIAMOND_OPEN', () => {
    const label = getPillLabel([
      remoteAgent({ isUltraplan: true, ultraplanPhase: 'needs_input' }),
    ])
    expect(label).toContain(DIAMOND_OPEN)
    expect(label).toContain('ultraplan needs your input')
  })
  test('single ultraplan, no phase → DIAMOND_OPEN + plain "ultraplan"', () => {
    const label = getPillLabel([remoteAgent({ isUltraplan: true })])
    expect(label).toBe(`${DIAMOND_OPEN} ultraplan`)
  })
  test('single non-ultraplan remote_agent → 1 cloud session', () => {
    expect(getPillLabel([remoteAgent()])).toBe(`${DIAMOND_OPEN} 1 cloud session`)
  })
  test('multiple remote_agents → N cloud sessions (plural)', () => {
    expect(getPillLabel([remoteAgent(), remoteAgent()])).toBe(
      `${DIAMOND_OPEN} 2 cloud sessions`,
    )
  })
})

describe('getPillLabel — local_workflow / monitor_mcp / dream', () => {
  test('1 background workflow', () => {
    expect(getPillLabel([workflow()])).toBe('1 background workflow')
  })
  test('multiple workflows (plural)', () => {
    expect(getPillLabel([workflow(), workflow()])).toBe(
      '2 background workflows',
    )
  })
  test('monitor_mcp single', () => {
    expect(getPillLabel([monitorMcp()])).toBe('1 monitor')
  })
  test('monitor_mcp plural', () => {
    expect(getPillLabel([monitorMcp(), monitorMcp(), monitorMcp()])).toBe(
      '3 monitors',
    )
  })
  test('dream — singular regardless of count', () => {
    expect(getPillLabel([dream()])).toBe('dreaming')
    expect(getPillLabel([dream(), dream()])).toBe('dreaming')
  })
})

describe('getPillLabel — heterogeneous fallback', () => {
  test('mixed types (1 task) → "1 background task"', () => {
    expect(getPillLabel([bash('shell'), localAgent()])).toBe(
      '2 background tasks',
    )
  })
  test('mixed types (single) — when types are NOT all same, falls back', () => {
    // 1 task, but allSameType is true (it's only one type) — actually that
    // takes the per-type branch. To force fallback we need ≥2 tasks with
    // different types. This test verifies the fallback shape.
    const result = getPillLabel([
      bash('shell'),
      teammate('alpha'),
      localAgent(),
    ])
    expect(result).toBe('3 background tasks')
  })
})

describe('pillNeedsCta', () => {
  test('returns false for 0 tasks', () => {
    expect(pillNeedsCta([])).toBe(false)
  })
  test('returns false for 2+ tasks', () => {
    expect(
      pillNeedsCta([
        remoteAgent({ isUltraplan: true, ultraplanPhase: 'plan_ready' }),
        remoteAgent({ isUltraplan: true, ultraplanPhase: 'plan_ready' }),
      ]),
    ).toBe(false)
  })
  test('returns false for non-remote_agent', () => {
    expect(pillNeedsCta([bash('shell')])).toBe(false)
  })
  test('returns false for non-ultraplan remote_agent', () => {
    expect(pillNeedsCta([remoteAgent()])).toBe(false)
  })
  test('returns true for ultraplan + plan_ready phase', () => {
    expect(
      pillNeedsCta([
        remoteAgent({ isUltraplan: true, ultraplanPhase: 'plan_ready' }),
      ]),
    ).toBe(true)
  })
  test('returns true for ultraplan + needs_input phase', () => {
    expect(
      pillNeedsCta([
        remoteAgent({ isUltraplan: true, ultraplanPhase: 'needs_input' }),
      ]),
    ).toBe(true)
  })
  test('returns false for ultraplan with no phase set', () => {
    expect(pillNeedsCta([remoteAgent({ isUltraplan: true })])).toBe(false)
  })
})
