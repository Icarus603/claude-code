import { describe, expect, mock, test } from 'bun:test'

// Contract: the steerable background-agent panel (CoordinatorTaskPanel) is the
// surface for `local_agent` tasks in every INTERACTIVE REPL session. This locks
// the alignment with ant 2.1.150 `F6H()` (3973.js) — ant gates the panel on
// `!nonInteractive && (env || GrowthBook tengu_copper_fox)`; the ccb decompiler
// rendered every `F6H()` callsite as `process.env.USER_TYPE === 'ant'`, which
// pinned the whole panel/steering feature OFF for ccb operators (same class as
// the fullscreen `j9` mistranslation). The fix routes all those callsites
// through `isBgAgentPanelEnabled()`. This test exists so a future edit can't
// silently re-pin the panel to USER_TYPE or break the interactive guard.

const PANEL_AGENT = {
  id: 't1',
  type: 'local_agent',
  status: 'running',
  agentType: 'general-purpose',
  isBackgrounded: true,
  startTime: 0,
} as never

const TEAMMATE = {
  id: 't2',
  type: 'in_process_teammate',
  status: 'running',
  isBackgrounded: true,
  startTime: 0,
  identity: { agentName: 'foo', teamName: 'bar', color: 'cyan' },
} as never

async function loadWith(nonInteractive: boolean) {
  // mock.module replaces the WHOLE module — spread the real exports first so
  // every other consumer of state.js (getSessionId, etc.) keeps working; only
  // override the one getter this gate reads.
  const real = await import('@claude-code/app-host/bootstrap/state.js')
  mock.module('@claude-code/app-host/bootstrap/state.js', () => ({
    ...real,
    getIsNonInteractiveSession: () => nonInteractive,
  }))
  // Re-import after the mock is installed so the module picks up the stub.
  return await import('../taskStatusUtils.js')
}

describe('isBgAgentPanelEnabled — ant F6H alignment', () => {
  test('true in an interactive session (panel is the local_agent surface)', async () => {
    const { isBgAgentPanelEnabled } = await loadWith(false)
    expect(isBgAgentPanelEnabled()).toBe(true)
  })

  test('false in a non-interactive (headless) session — ant !nonInteractive guard', async () => {
    const { isBgAgentPanelEnabled } = await loadWith(true)
    expect(isBgAgentPanelEnabled()).toBe(false)
  })
})

describe('shouldHideTasksFooter — panel-agent exclusion', () => {
  test('panel-agent is excluded from the footer when the panel is active', async () => {
    // Interactive + spinner-tree active + only a panel local_agent present:
    // the footer must hide it (it renders in CoordinatorTaskPanel instead),
    // so shouldHideTasksFooter is false (no NON-panel visible task remains).
    const { shouldHideTasksFooter } = await loadWith(false)
    const hidden = shouldHideTasksFooter({ t1: PANEL_AGENT }, true)
    expect(hidden).toBe(false)
  })

  test('teammate task keeps the footer logic engaged (not a panel agent)', async () => {
    // A running in_process_teammate is NOT a panel agent, so it stays a
    // visible footer task; with showSpinnerTree the teammate-only case
    // returns true (every visible task is a teammate → footer hidden).
    const { shouldHideTasksFooter } = await loadWith(false)
    const hidden = shouldHideTasksFooter({ t2: TEAMMATE }, true)
    expect(hidden).toBe(true)
  })
})
