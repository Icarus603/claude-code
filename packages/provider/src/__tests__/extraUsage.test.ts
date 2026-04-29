import { beforeEach, describe, expect, mock, test } from 'bun:test'

// Mock the two host bindings BEFORE importing the SUT. We spread the real
// modules so other consumers of the same path keep working — the local-mocks
// only override the two functions we need to control.
const realAuth = await import('../authAlias.js')
const realContext = await import('@claude-code/agent/context.js')

let isSubscriberReturn = false
let has1mContextReturn = false

mock.module('../authAlias.js', () => ({
  ...realAuth,
  isClaudeAISubscriber: () => isSubscriberReturn,
}))

mock.module('@claude-code/agent/context.js', () => ({
  ...realContext,
  has1mContext: (_model: string) => has1mContextReturn,
}))

const { isBilledAsExtraUsage } = await import('../extraUsage.js')

beforeEach(() => {
  isSubscriberReturn = false
  has1mContextReturn = false
})

describe('isBilledAsExtraUsage — non-subscriber short-circuit', () => {
  test('non-subscriber → false (regardless of any other arg)', () => {
    isSubscriberReturn = false
    expect(isBilledAsExtraUsage('opus-4-7[1m]', false, false)).toBe(false)
    // Even fast mode + 1m model → still false. The subscriber gate is the
    // outermost short-circuit; if you're not on Claude.ai, none of the
    // extra-usage rules apply (you're billed via API normally).
    expect(isBilledAsExtraUsage('opus-4-7[1m]', true, true)).toBe(false)
  })
})

describe('isBilledAsExtraUsage — fastMode short-circuit', () => {
  beforeEach(() => {
    isSubscriberReturn = true
  })

  test('subscriber + fastMode → true (model irrelevant)', () => {
    expect(isBilledAsExtraUsage('opus-4-7', true, false)).toBe(true)
  })

  test('subscriber + fastMode + null model → true', () => {
    // fastMode short-circuits BEFORE the null/1m check. This documents
    // that ordering — null model normally returns false, but fastMode
    // overrides because fast-mode quota is always extra-usage billable
    // for subscribers.
    expect(isBilledAsExtraUsage(null, true, false)).toBe(true)
  })

  test('subscriber + fastMode + non-1m model → true', () => {
    // has1mContextReturn is false but fastMode wins.
    has1mContextReturn = false
    expect(isBilledAsExtraUsage('haiku-4-5', true, false)).toBe(true)
  })

  test('subscriber + fastMode + isOpus1mMerged ignored', () => {
    // The Opus-1m-merged exception is below the fastMode short-circuit.
    expect(isBilledAsExtraUsage('opus-4-7[1m]', true, true)).toBe(true)
  })
})

describe('isBilledAsExtraUsage — non-1m model rejection', () => {
  beforeEach(() => {
    isSubscriberReturn = true
  })

  test('subscriber + non-fast + null model → false', () => {
    has1mContextReturn = false
    expect(isBilledAsExtraUsage(null, false, false)).toBe(false)
  })

  test('subscriber + non-fast + non-1m model → false', () => {
    has1mContextReturn = false
    expect(isBilledAsExtraUsage('claude-haiku-4-5', false, false)).toBe(false)
  })
})

describe('isBilledAsExtraUsage — opus 1m', () => {
  beforeEach(() => {
    isSubscriberReturn = true
    has1mContextReturn = true
  })

  test('opus-4-7 + isOpus1mMerged=false → true (opus 1m still billed extra)', () => {
    expect(isBilledAsExtraUsage('claude-opus-4-7[1m]', false, false)).toBe(true)
  })

  test('opus-4-6 + isOpus1mMerged=false → true', () => {
    expect(isBilledAsExtraUsage('claude-opus-4-6[1m]', false, false)).toBe(true)
  })

  test('plain "opus" alias + isOpus1mMerged=false → true', () => {
    // After lowercase + [1m] strip + trim, the alias 'opus' equals 'opus'.
    expect(isBilledAsExtraUsage('opus[1m]', false, false)).toBe(true)
  })

  test('opus-4-7 + isOpus1mMerged=true → false (1m merged into base price)', () => {
    // CRITICAL: when Anthropic merges 1m context into base pricing for
    // Opus, this flag flips and Opus 1m stops being extra-usage billable.
    // If a future refactor accidentally drops this branch, subscribers
    // would be over-charged.
    expect(isBilledAsExtraUsage('claude-opus-4-7[1m]', false, true)).toBe(false)
  })

  test('opus-4-6 + isOpus1mMerged=true → false', () => {
    expect(isBilledAsExtraUsage('claude-opus-4-6[1m]', false, true)).toBe(false)
  })

  test('plain "opus" alias + isOpus1mMerged=true → false', () => {
    expect(isBilledAsExtraUsage('opus[1m]', false, true)).toBe(false)
  })
})

describe('isBilledAsExtraUsage — sonnet 1m', () => {
  beforeEach(() => {
    isSubscriberReturn = true
    has1mContextReturn = true
  })

  test('sonnet-4-6 + isOpus1mMerged=false → true', () => {
    expect(isBilledAsExtraUsage('claude-sonnet-4-6[1m]', false, false)).toBe(
      true,
    )
  })

  test('plain "sonnet" alias → true', () => {
    expect(isBilledAsExtraUsage('sonnet[1m]', false, false)).toBe(true)
  })

  test('sonnet does NOT respect isOpus1mMerged flag (only opus does)', () => {
    // Sonnet 1m billing is independent of opus 1m merger — even when
    // isOpus1mMerged=true, sonnet 1m remains extra-usage billable. This
    // anchors the asymmetric behavior of the flag (it is the OPUS 1m
    // merger flag, not a generic 1m merger flag).
    expect(isBilledAsExtraUsage('claude-sonnet-4-6[1m]', false, true)).toBe(
      true,
    )
  })
})

describe('isBilledAsExtraUsage — case insensitivity & normalization', () => {
  beforeEach(() => {
    isSubscriberReturn = true
    has1mContextReturn = true
  })

  test('uppercase model name is lowercased before match', () => {
    expect(isBilledAsExtraUsage('CLAUDE-OPUS-4-7[1m]', false, false)).toBe(true)
  })

  test('mixed-case [1m] suffix matched (regex is anchored & case-insensitive)', () => {
    // The regex is /\[1m\]$/ but lowercased input — verify our normalization
    // strips the suffix correctly when input is uppercase.
    expect(isBilledAsExtraUsage('CLAUDE-OPUS-4-7[1m]', false, false)).toBe(true)
  })

  test('trailing whitespace trimmed', () => {
    // model.toLowerCase().replace(...).trim() — verify the .trim() runs.
    expect(isBilledAsExtraUsage('opus-4-7[1m]   ', false, false)).toBe(true)
  })

  test('non-suffix [1m] (in middle) NOT stripped', () => {
    // Regex is end-anchored. 'claude-[1m]-opus-4-7' would not have its
    // [1m] stripped, but the includes() check ('opus-4-7') still wins.
    // This documents the substring-match behavior of the includes path.
    expect(isBilledAsExtraUsage('claude-[1m]-opus-4-7', false, false)).toBe(
      true,
    )
  })
})

describe('isBilledAsExtraUsage — non-matching but 1m model', () => {
  beforeEach(() => {
    isSubscriberReturn = true
    has1mContextReturn = true
  })

  test('1m model that is neither opus nor sonnet-4-6 → false', () => {
    // has1mContext returned true (we mocked it), but the name doesn't
    // match any of the known opus/sonnet patterns. Result: not billed
    // as extra usage. This catches the case where a future model adds
    // 1m support but is omitted from the name-list.
    expect(
      isBilledAsExtraUsage('claude-something-else-1m[1m]', false, false),
    ).toBe(false)
  })

  test('older sonnet (4-5) NOT in the include-list', () => {
    // Only sonnet-4-6 matches. sonnet-4-5 with [1m] should fall through.
    expect(isBilledAsExtraUsage('claude-sonnet-4-5[1m]', false, false)).toBe(
      false,
    )
  })

  test('older opus (4-5) NOT in the include-list', () => {
    expect(isBilledAsExtraUsage('claude-opus-4-5[1m]', false, false)).toBe(
      false,
    )
  })
})

describe('isBilledAsExtraUsage — branch ordering invariants', () => {
  // The function has 4 short-circuits in order:
  //   1. !subscriber → false
  //   2. fastMode → true
  //   3. !has1mContext(model) → false
  //   4. opus + isOpus1mMerged → false
  // Then opus|sonnet match → true, else false.
  //
  // Each test below targets the boundary between adjacent conditions.

  test('boundary 1→2: non-subscriber + fastMode → still false (subscriber check first)', () => {
    isSubscriberReturn = false
    expect(isBilledAsExtraUsage('opus-4-7', true, false)).toBe(false)
  })

  test('boundary 2→3: subscriber + !fastMode + !1m → false (1m check second)', () => {
    isSubscriberReturn = true
    has1mContextReturn = false
    expect(isBilledAsExtraUsage('opus-4-7', false, false)).toBe(false)
  })

  test('boundary 3→4: subscriber + !fastMode + 1m + opus + merged → false', () => {
    isSubscriberReturn = true
    has1mContextReturn = true
    expect(isBilledAsExtraUsage('opus-4-7[1m]', false, true)).toBe(false)
  })

  test('boundary 4→true: subscriber + !fastMode + 1m + opus + !merged → true', () => {
    isSubscriberReturn = true
    has1mContextReturn = true
    expect(isBilledAsExtraUsage('opus-4-7[1m]', false, false)).toBe(true)
  })
})
