import { describe, expect, test } from 'bun:test'
import {
  closingShape,
  fallbackHeuristic,
  isInCodeFence,
  mergeWithPrev,
  parseLlmJson,
  preClassify,
  shouldUpdateState,
} from '../classifier/heuristic.js'

describe('isInCodeFence', () => {
  test('detects open fence', () => {
    const t = '```python\nprint("hello")'
    expect(isInCodeFence(t, t.length)).toBe(true)
  })
  test('detects closed fence', () => {
    const t = '```python\nprint("hello")\n```\nafter'
    expect(isInCodeFence(t, t.length)).toBe(false)
  })
  test('handles tilde fences', () => {
    const t = '~~~~\ncontent here'
    expect(isInCodeFence(t, t.length)).toBe(true)
  })
})

describe('preClassify — explicit markers', () => {
  test('failed: marker → failed/idle', () => {
    const r = preClassify('something happened\nfailed: cannot reach API')
    expect(r?.state).toBe('failed')
    expect(r?.tempo).toBe('idle')
    expect(r?.branch).toBe('failed-marker')
  })
  test('blocked: marker → blocked/blocked', () => {
    const r = preClassify('blocked: need GITHUB_TOKEN')
    expect(r?.state).toBe('blocked')
    expect(r?.tempo).toBe('blocked')
    expect(r?.needs).toMatch(/GITHUB_TOKEN/)
  })
  test('result: marker → done/idle', () => {
    const r = preClassify('lots of work\nresult: PR #123 merged')
    expect(r?.state).toBe('done')
    expect(r?.tempo).toBe('idle')
    expect(r?.output?.result).toMatch(/PR #123/)
  })
})

describe('preClassify — closing patterns', () => {
  test('trailing question → blocked', () => {
    const r = preClassify('all set. Want me to also clean up the helper?')
    expect(r?.state).toBe('blocked')
    expect(r?.branch).toBe('trailing-q')
  })
  test('working verb → working/active', () => {
    const r = preClassify('Now let me check the auth flow.')
    expect(r?.state).toBe('working')
    expect(r?.tempo).toBe('active')
  })
  test('"please run /login" → blocked auth', () => {
    const r = preClassify('Please run /login to continue.')
    // Matches PLEASE_DO_RE first
    expect(r?.state).toBe('blocked')
  })
  test('"giving up" → failed', () => {
    const r = preClassify('Giving up on this task.')
    expect(r?.state).toBe('failed')
    expect(r?.branch).toBe('giving-up')
  })
  test('"VERDICT: PASS" → done', () => {
    const r = preClassify('VERDICT: PASS — all tests green')
    expect(r?.state).toBe('done')
    expect(r?.branch).toBe('verdict-marker')
  })
  test('"awaiting your approval" → blocked', () => {
    const r = preClassify('Done with the fix. Awaiting your approval.')
    expect(r?.state).toBe('blocked')
    expect(r?.branch).toBe('awaiting-user')
  })
})

describe('preClassify — code fence aware', () => {
  test('marker inside code fence is ignored', () => {
    const t = 'See example:\n```\nfailed: this is a test fixture\n```\nReady for review.'
    const r = preClassify(t)
    // failed: is inside fence so should not be classified as failed.
    // ready-for at end → done
    expect(r?.state).toBe('done')
  })
})

describe('fallbackHeuristic', () => {
  test('non-empty text → working/idle with last line', () => {
    const r = fallbackHeuristic('line one\nline two\nfinal line')
    expect(r.state).toBe('working')
    expect(r.tempo).toBe('idle')
    expect(r.detail).toBe('final line')
  })
  test('empty → working with em-dash', () => {
    const r = fallbackHeuristic('')
    expect(r.detail).toBe('—')
  })
})

describe('closingShape', () => {
  test('empty', () => expect(closingShape('')).toBe('empty'))
  test('trailing question', () => expect(closingShape('what next?')).toBe('trailing-q'))
  test('list-or-table', () => expect(closingShape('- a\n- b\n- c')).toBe('list-or-table'))
  test('declarative', () => expect(closingShape('this is a fact')).toBe('declarative'))
  test('result line', () => expect(closingShape('lots\nresult: ok')).toBe('result-line'))
})

describe('parseLlmJson', () => {
  test('plain JSON', () => {
    const r = parseLlmJson('{"state":"done","detail":"ok"}')
    expect(r?.state).toBe('done')
  })
  test('strips ```json fence', () => {
    const r = parseLlmJson('```json\n{"state":"done"}\n```')
    expect(r?.state).toBe('done')
  })
  test('returns null on garbage', () => {
    expect(parseLlmJson('not json')).toBe(null)
  })
})

describe('mergeWithPrev', () => {
  test('valid llm output overrides prev', () => {
    const r = mergeWithPrev({ state: 'done', detail: 'finished', tempo: 'idle' }, 'working', null)
    expect(r.state).toBe('done')
    expect(r.tempo).toBe('idle')
  })
  test('terminal state forces tempo=idle', () => {
    const r = mergeWithPrev({ state: 'done', tempo: 'active' }, 'working', null)
    expect(r.tempo).toBe('idle')
  })
  test('invalid state falls back to prev', () => {
    const r = mergeWithPrev({ state: 'bogus' }, 'blocked', null)
    expect(r.state).toBe('blocked')
  })
  test('blocked state preserves prev needs when not provided', () => {
    const r = mergeWithPrev({ state: 'blocked', tempo: 'blocked' }, 'blocked', { needs: 'login required', state: 'blocked', tempo: 'blocked', detail: '', source: 'preclassify' })
    expect(r.needs).toBe('login required')
  })
})

describe('shouldUpdateState', () => {
  test('first state → write', () => {
    expect(shouldUpdateState(null, { state: 'working', detail: 'x', tempo: 'active' })).toBe(true)
  })
  test('state change → write', () => {
    const prev = { state: 'working', detail: 'x', tempo: 'active', cwd: '/', createdAt: '', updatedAt: '' } as const
    expect(shouldUpdateState(prev, { state: 'done', detail: 'x', tempo: 'idle' })).toBe(true)
  })
  test('no change → skip', () => {
    const prev = { state: 'working', detail: 'x', tempo: 'active', cwd: '/', createdAt: '', updatedAt: '' } as const
    expect(shouldUpdateState(prev, { state: 'working', detail: 'x', tempo: 'active' })).toBe(false)
  })
})
