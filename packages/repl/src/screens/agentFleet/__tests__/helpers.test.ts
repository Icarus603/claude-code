import { describe, expect, test } from 'bun:test'

import type {
  FleetJob,
  FleetJobState,
  FleetPrCache,
} from '@claude-code/agent/background/fleet/fleetTypes.js'
import { childRollupColor, childStatusColor } from '../helpers/childStatusColor.js'
import { deriveActivity } from '../helpers/deriveActivity.js'
import { deriveBand } from '../helpers/deriveBand.js'
import { doneFoldCap } from '../helpers/doneFoldCap.js'
import { jobAge, formatJobAge } from '../helpers/elapsed.js'
import { flattenDetail, stripSystemBlocks } from '../helpers/flattenDetail.js'
import { glyphColor } from '../helpers/glyphColor.js'
import { jobLabel } from '../helpers/jobLabel.js'
import { jobMatchesCwd, jobMatchesFrame, jobMatchesPr } from '../helpers/jobMatch.js'
import { labelReplaceFrame } from '../helpers/labelReplaceAnim.js'
import { isLoopJob } from '../helpers/loopJob.js'
import { needsRespawn } from '../helpers/needsRespawn.js'
import { buildPrRefRegex, parseFrameRef, parsePrRef, parseQuery } from '../helpers/parseQuery.js'
import { pickIcon } from '../helpers/pickIcon.js'
import { repoGroup, repoGroupLabel, spawnOrigin } from '../helpers/repoGroup.js'
import { rollupChildColor, rollupJobColor, sortStatusSegments } from '../helpers/rollupColor.js'
import { FLEET_BUCKET_LABEL, FLEET_BUCKET_ORDER } from '../helpers/sectionLabels.js'
import { isSelfDriving } from '../helpers/selfDriving.js'
import {
  effectiveSortOrder,
  effectiveStateSortOrder,
  sortJobs,
} from '../helpers/sortJobs.js'
import {
  getCompletedGlyph,
  getSpinnerFrames,
  getSpinnerFramesCycle,
  getSteadyGlyph,
  pickSpinnerFrame,
  SPINNER_FRAME_MS,
} from '../helpers/spinnerFrames.js'
import { stateBucket } from '../helpers/stateBucket.js'
import { isTerminalStatus, isTerminallyIdle, stateOutcome } from '../helpers/stateOutcome.js'

function mockState(overrides: Partial<FleetJobState> = {}): FleetJobState {
  return {
    state: 'working',
    tempo: 'active',
    detail: '',
    output: null,
    children: null,
    linkScanOffset: 0,
    template: 'bg',
    respawnFlags: [],
    intent: 'fix the bug',
    sessionId: 'aaaaaaaa-bbbb',
    daemonShort: 'aaaaaaaa',
    cwd: '/home/me/repo',
    createdAt: '2026-05-16T10:00:00Z',
    updatedAt: '2026-05-16T10:00:00Z',
    firstTerminalAt: null,
    backend: 'daemon',
    ...overrides,
  }
}

function mockJob(stateOverrides: Partial<FleetJobState> = {}, id = 'aaaaaaaa'): FleetJob {
  return { id, state: mockState(stateOverrides) }
}

describe('spinner frames', () => {
  test('default cycle is 12 ping-pong frames @ 120ms', () => {
    expect(SPINNER_FRAME_MS).toBe(120)
    const base = getSpinnerFrames()
    expect(base).toEqual(['·', '✢', '✳', '✶', '✻', '✽'])
    const cycle = getSpinnerFramesCycle()
    expect(cycle).toEqual(['·', '✢', '✳', '✶', '✻', '✽', '✽', '✻', '✶', '✳', '✢', '·'])
    expect(cycle).toHaveLength(12)
  })

  test('ghostty fallback swaps last frame for "*"', () => {
    const original = process.env.TERM
    process.env.TERM = 'xterm-ghostty'
    try {
      expect(getSpinnerFrames()[5]).toBe('*')
    } finally {
      if (original === undefined) delete process.env.TERM
      else process.env.TERM = original
    }
  })

  test('steady glyph is ezH[4] = "✻", completed is ezH[1] = "✢"', () => {
    expect(getSteadyGlyph()).toBe('✻')
    expect(getCompletedGlyph()).toBe('✢')
  })

  test('frame picker advances every 120ms and wraps at 12', () => {
    expect(pickSpinnerFrame(0)).toBe('·')
    expect(pickSpinnerFrame(120)).toBe('✢')
    expect(pickSpinnerFrame(120 * 11)).toBe('·')
    expect(pickSpinnerFrame(120 * 12)).toBe('·') // wraps
  })
})

describe('section labels', () => {
  test('bucket order matches ant $dK', () => {
    expect(FLEET_BUCKET_ORDER).toEqual(['review', 'blocked', 'working', 'done'])
  })

  test('labels match ant zdK', () => {
    expect(FLEET_BUCKET_LABEL.review).toBe('Ready for review')
    expect(FLEET_BUCKET_LABEL.blocked).toBe('Needs input')
    expect(FLEET_BUCKET_LABEL.working).toBe('Working')
    expect(FLEET_BUCKET_LABEL.done).toBe('Completed')
  })
})

describe('stateOutcome / isTerminalStatus / isTerminallyIdle', () => {
  test('outcome mapping', () => {
    expect(stateOutcome('done')).toBe('success')
    expect(stateOutcome('failed')).toBe('failure')
    expect(stateOutcome('stopped')).toBe('stopped')
    expect(stateOutcome('working')).toBeNull()
    expect(stateOutcome('blocked')).toBeNull()
  })

  test('isTerminal recognises done/failed/stopped only', () => {
    expect(isTerminalStatus('done')).toBe(true)
    expect(isTerminalStatus('working')).toBe(false)
  })

  test('isTerminallyIdle requires tempo !== active', () => {
    expect(isTerminallyIdle(mockState({ state: 'done', tempo: 'idle' }))).toBe(true)
    expect(isTerminallyIdle(mockState({ state: 'done', tempo: 'active' }))).toBe(false)
  })
})

describe('loop + self-driving', () => {
  test('isLoopJob detects /loop in intent or initialPrompt', () => {
    expect(isLoopJob(mockState({ intent: '/loop refactor' }))).toBe(true)
    expect(isLoopJob(mockState({ intent: 'plain', initialPrompt: '/loop x' }))).toBe(true)
    expect(isLoopJob(mockState({ intent: 'fix bug' }))).toBe(false)
  })

  test('isSelfDriving covers routine + cron + loop', () => {
    expect(isSelfDriving(mockState({ routine: 'dream' }))).toBe(true)
    expect(
      isSelfDriving(mockState({ inFlight: { kinds: ['session_cron'] } })),
    ).toBe(true)
    expect(isSelfDriving(mockState({ intent: '/loop x' }))).toBe(true)
    expect(isSelfDriving(mockState({ intent: 'fix' }))).toBe(false)
  })
})

describe('pickIcon', () => {
  test('pinned + idle + no presence → "∙"', () => {
    const s = mockState({ tempo: 'idle' })
    expect(pickIcon(s, true, undefined)).toBe('∙')
  })

  test('busy/shell presence → null (no glyph)', () => {
    expect(pickIcon(mockState(), false, 'busy')).toBeNull()
    expect(pickIcon(mockState(), false, 'shell')).toBeNull()
  })

  test('/loop job → completed glyph', () => {
    expect(pickIcon(mockState({ intent: '/loop x' }), false, undefined)).toBe('✢')
  })

  test('default → steady glyph', () => {
    expect(pickIcon(mockState(), false, undefined)).toBe('✻')
  })
})

describe('glyphColor', () => {
  test('terminal+success → success undimmed', () => {
    const c = glyphColor(mockState({ state: 'done', tempo: 'idle' }), 'success', undefined)
    expect(c).toEqual({ color: 'success', dim: false })
  })

  test('busy presence → undimmed undefined', () => {
    expect(glyphColor(mockState(), 'flowing', 'busy')).toEqual({ color: undefined, dim: false })
  })

  test('blocked tempo → warning undimmed', () => {
    expect(glyphColor(mockState({ tempo: 'blocked' }), 'flowing', undefined)).toEqual({
      color: 'warning',
      dim: false,
    })
  })

  test('default working → dimmed undefined', () => {
    expect(glyphColor(mockState(), 'flowing', undefined)).toEqual({ color: undefined, dim: true })
  })
})

describe('deriveBand', () => {
  test('busy → active', () => {
    expect(deriveBand(mockState(), 'busy')).toBe('active')
  })
  test('idle + terminal → completed', () => {
    expect(deriveBand(mockState({ state: 'done', tempo: 'idle' }), undefined)).toBe('completed')
  })
  test('blocked tempo → blocked', () => {
    expect(deriveBand(mockState({ tempo: 'blocked' }), undefined)).toBe('blocked')
  })
  test('default → active', () => {
    expect(deriveBand(mockState(), undefined)).toBe('active')
  })
})

describe('deriveActivity', () => {
  test('terminal success when not self-driving', () => {
    const s = mockState({ state: 'done', tempo: 'idle' })
    expect(deriveActivity(s, undefined)).toBe('success')
  })
  test('terminal failure', () => {
    const s = mockState({ state: 'failed', tempo: 'idle' })
    expect(deriveActivity(s, undefined)).toBe('failure')
  })
  test('flowing within 3m active', () => {
    const recent = new Date(Date.now() - 60_000).toISOString()
    const s = mockState({ updatedAt: recent })
    expect(deriveActivity(s, undefined)).toBe('flowing')
  })
  test('slowing 3-15m active', () => {
    const dt = new Date(Date.now() - 5 * 60_000).toISOString()
    expect(deriveActivity(mockState({ updatedAt: dt }), undefined)).toBe('slowing')
  })
  test('stuck past 15m active', () => {
    const dt = new Date(Date.now() - 20 * 60_000).toISOString()
    expect(deriveActivity(mockState({ updatedAt: dt }), undefined)).toBe('stuck')
  })
})

describe('stateBucket', () => {
  test('busy → working', () => {
    expect(stateBucket({ state: mockState() }, undefined, 'busy')).toBe('working')
  })
  test('failure activity → done', () => {
    const s = mockState({ state: 'failed', tempo: 'idle' })
    expect(stateBucket({ state: s, activity: 'failure' }, undefined, undefined)).toBe('done')
  })
  test('waiting presence → blocked', () => {
    expect(stateBucket({ state: mockState() }, undefined, 'waiting')).toBe('blocked')
  })
  test('blocked tempo → blocked', () => {
    expect(stateBucket({ state: mockState({ tempo: 'blocked' }) }, undefined, undefined)).toBe(
      'blocked',
    )
  })
  test('PR with errors → review', () => {
    const prCache: FleetPrCache = new Map([
      [
        'https://x/pull/1',
        {
          state: 'OPEN',
          review: 'REVIEW_REQUIRED',
          checks: { failed: 1, pending: 0, passed: 0 },
        },
      ],
    ])
    const s = mockState({
      children: [{ kind: 'agent', href: 'https://x/pull/1' }],
    })
    expect(stateBucket({ state: s }, prCache, undefined)).toBe('review')
  })
  test('self-driving skips review', () => {
    const prCache: FleetPrCache = new Map([
      [
        'https://x/pull/1',
        {
          state: 'OPEN',
          review: null,
          checks: { failed: 1, pending: 0, passed: 0 },
        },
      ],
    ])
    const s = mockState({
      routine: 'dream',
      children: [{ kind: 'agent', href: 'https://x/pull/1' }],
    })
    expect(stateBucket({ state: s }, prCache, undefined)).toBe('working')
  })
})

describe('doneFoldCap', () => {
  test('clamps to [3, 10]', () => {
    expect(doneFoldCap(0)).toBe(3)
    expect(doneFoldCap(5)).toBe(3) // floor(5/5) = 1, clamp → 3
    expect(doneFoldCap(25)).toBe(5) // floor(25/5) = 5
    expect(doneFoldCap(100)).toBe(10) // floor(100/5) = 20, clamp → 10
  })
})

describe('elapsed', () => {
  test('jobAge formats time since createdAt', () => {
    const s = mockState({ createdAt: new Date(Date.now() - 90_000).toISOString() })
    expect(jobAge(s)).toMatch(/^\d+m$/)
  })

  test('formatJobAge adds "in" prefix when nextAt is future', () => {
    const job = mockJob()
    expect(formatJobAge(job, Date.now() + 60_000)).toMatch(/^in /)
  })
})

describe('flattenDetail / stripSystemBlocks', () => {
  test('strips system-reminder + collapses whitespace', () => {
    const input = 'hello   <system-reminder>ignore me</system-reminder>\n\nworld'
    expect(flattenDetail(input)).toBe('hello world')
  })
  test('strips task-notification', () => {
    expect(flattenDetail('<task-notification>x</task-notification>')).toBe('')
  })
})

describe('jobLabel', () => {
  test('returns name when present', () => {
    expect(jobLabel(mockState({ name: 'My Agent' }))).toBe('My Agent')
  })
  test('fallback "new session" for fresh bg', () => {
    expect(jobLabel(mockState({ intent: '', state: 'working', template: 'bg' }))).toBe(
      'new session',
    )
  })
  test('fallback "current session" when flagged', () => {
    expect(jobLabel(mockState({ intent: '' }), true)).toBe('current session')
  })
  test('truncates long intent', () => {
    const s = mockState({
      intent: 'one two three four five six seven eight nine ten eleven',
    })
    const label = jobLabel(s)
    expect(label.endsWith('…')).toBe(true)
  })
})

describe('labelReplaceFrame', () => {
  test('n=1 shows first new grapheme + tail of old', () => {
    const f = labelReplaceFrame('abc', 'xyz', 1)
    expect(f.display).toBe('xbc')
    expect(f.newLen).toBe(1)
  })
  test('final frame shows full new label', () => {
    const f = labelReplaceFrame('abc', 'xyz', 3)
    expect(f.display).toBe('xyz')
  })
  test('pads with spaces when new is shorter than old', () => {
    const f = labelReplaceFrame('abcdef', 'xy', 2)
    expect(f.display).toBe('xycdef')
  })
})

describe('parseQuery / parsePrRef / parseFrameRef', () => {
  test('plain text only', () => {
    const q = parseQuery('fix bug')
    expect(q.text).toBe('fix bug')
  })
  test('a:foo extracts template', () => {
    expect(parseQuery('a:reviewer fix').template).toBe('reviewer')
  })
  test('s:working extracts state', () => {
    expect(parseQuery('s:working').state).toBe('working')
  })
  test('o:term extracts output token', () => {
    expect(parseQuery('o:abc').output).toBe('abc')
  })
  test('#1234 extracts PR', () => {
    expect(parseQuery('#1234 fix').pr).toBe('1234')
  })
  test('PR URL extracts number', () => {
    expect(parsePrRef('https://github.com/x/y/pull/55')).toBe('55')
    expect(parsePrRef('https://github.com/x/y/pull/55/files')).toBe('55')
    expect(parsePrRef('https://x/pull/55x')).toBe('55') // (?!\d) only rejects digit suffix
    expect(parsePrRef('https://x/pull/553')).toBe('553') // greedy digit run, then ?! triggers
  })
  test('frame-XYZ extracts frame id', () => {
    expect(parseFrameRef('frame-abc-123')).toBe('abc-123')
    expect(parseFrameRef('not-a-frame')).toBeNull()
  })
  test('buildPrRefRegex matches /pull/N (not /pull/Nx digit suffix)', () => {
    const re = buildPrRefRegex('55')
    expect(re.test('https://x/pull/55')).toBe(true)
    expect(re.test('https://x/pull/553')).toBe(false)
  })
})

describe('repoGroup', () => {
  test('spawnOrigin uses originCwd when set', () => {
    const s = mockState({ originCwd: '/home/me/origin', cwd: '/tmp/wt' })
    expect(spawnOrigin(s)).toBe('/home/me/origin')
  })
  test('spawnOrigin strips .claude/worktrees/<branch>/', () => {
    const s = mockState({ cwd: '/home/me/repo/.claude/worktrees/feature/x' })
    expect(spawnOrigin(s)).toBe('/home/me/repo')
  })
  test('repoGroupLabel is basename of spawnOrigin', () => {
    expect(repoGroupLabel(mockState({ cwd: '/home/me/myrepo' }))).toBe('myrepo')
  })
  test('repoGroup returns spawnOrigin path', () => {
    expect(repoGroup(mockState({ cwd: '/a/b' }))).toBe('/a/b')
  })
})

describe('jobMatch', () => {
  test('jobMatchesPr matches child id', () => {
    const s = mockState({
      children: [{ kind: 'agent', id: '42', href: 'https://x/pull/99' }],
    })
    expect(jobMatchesPr(s, '42')).toBe(true)
  })
  test('jobMatchesPr matches output URL', () => {
    const s = mockState({ output: { ts1: 'see https://github.com/x/y/pull/42' } })
    expect(jobMatchesPr(s, '42')).toBe(true)
  })
  test('jobMatchesFrame matches child frame', () => {
    const s = mockState({ children: [{ kind: 'frame', href: 'frame-myid' }] })
    expect(jobMatchesFrame(s, 'myid')).toBe(true)
  })
  test('jobMatchesCwd accepts subtree', () => {
    const s = mockState({ cwd: '/repo/sub' })
    expect(jobMatchesCwd(s, '/repo')).toBe(true)
    expect(jobMatchesCwd(s, '/other')).toBe(false)
  })
})

describe('rollupColor', () => {
  test('rollupJobColor picks highest job rank', () => {
    const segs = [
      { color: 'warning', row: { kind: 'agent' } },
      { color: 'error', row: { kind: 'agent' } },
    ]
    expect(rollupJobColor(undefined, segs)).toBe('error')
  })

  test('rollupJobColor ignores frame children', () => {
    const segs = [{ color: 'error', row: { kind: 'frame' } }]
    expect(rollupJobColor('warning', segs)).toBe('warning')
  })

  test('rollupChildColor uses child rank (warning > success)', () => {
    const segs = [
      { color: 'success', row: { kind: 'agent' } },
      { color: 'warning', row: { kind: 'agent' } },
    ]
    expect(rollupChildColor(segs)).toBe('warning')
  })

  test('sortStatusSegments descending by sortRank', () => {
    expect(
      sortStatusSegments([
        { text: 'a', sortRank: 1 },
        { text: 'b', sortRank: 3 },
        { text: 'c', sortRank: 2 },
      ]).map(s => s.text),
    ).toEqual(['b', 'c', 'a'])
  })
})

describe('childStatusColor', () => {
  test('merged → undefined', () => {
    expect(
      childStatusColor({
        state: 'MERGED',
        review: 'APPROVED',
        checks: { failed: 0, pending: 0, passed: 0 },
      }),
    ).toBeUndefined()
  })
  test('failed checks → error', () => {
    expect(
      childStatusColor({
        state: 'OPEN',
        review: null,
        checks: { failed: 1, pending: 0, passed: 0 },
      }),
    ).toBe('error')
  })
  test('pending checks → warning', () => {
    expect(
      childStatusColor({
        state: 'OPEN',
        review: null,
        checks: { failed: 0, pending: 1, passed: 0 },
      }),
    ).toBe('warning')
  })
  test('rollup color demotes error to warning', () => {
    expect(
      childRollupColor({
        state: 'OPEN',
        review: null,
        checks: { failed: 1, pending: 0, passed: 0 },
      }),
    ).toBe('warning')
  })
})

describe('sortJobs', () => {
  test('sorts by effectiveSortOrder ascending', () => {
    const a = mockJob({ createdAt: '2026-05-16T10:00:00Z' }, 'a')
    const b = mockJob({ createdAt: '2026-05-16T09:00:00Z' }, 'b')
    expect(sortJobs([a, b]).map(j => j.id)).toEqual(['b', 'a'])
  })
  test('explicit sortOrder overrides createdAt', () => {
    expect(effectiveSortOrder(mockState({ sortOrder: 1, createdAt: '2099-01-01' }))).toBe(1)
  })
  test('effectiveStateSortOrder uses firstTerminalAt for done', () => {
    const s = mockState({
      firstTerminalAt: '2026-05-16T10:00:00Z',
      updatedAt: '2026-05-16T11:00:00Z',
    })
    expect(effectiveStateSortOrder(s, 'done')).toBe(Date.parse('2026-05-16T10:00:00Z'))
    expect(effectiveStateSortOrder(s, 'working')).toBe(Date.parse('2026-05-16T11:00:00Z'))
  })
})

describe('needsRespawn', () => {
  test('failure + idle → true', () => {
    expect(needsRespawn(mockJob({ state: 'failed', tempo: 'idle' }))).toBe(true)
  })
  test('failure + active → false', () => {
    expect(needsRespawn(mockJob({ state: 'failed', tempo: 'active' }))).toBe(false)
  })
  test('success → false', () => {
    expect(needsRespawn(mockJob({ state: 'done', tempo: 'idle' }))).toBe(false)
  })
})
