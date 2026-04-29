/**
 * Tests for teammate color assignment — round-robin color picker
 * with sticky-by-id assignment.
 *
 * Same teammateId always gets the same color (sticky); different
 * teammateIds round-robin through AGENT_COLORS.
 *
 * Wrong stickiness = teammate's pane border color flickers between
 * turns; wrong rotation = adjacent teammates get the same color and
 * users can't tell them apart.
 */
import { beforeEach, describe, expect, test } from 'bun:test'
import {
  assignTeammateColor,
  clearTeammateColors,
  getTeammateColor,
} from '../core/teammateColors.js'
import { AGENT_COLORS } from '../adapters/appRuntime.js'

describe('assignTeammateColor — sticky assignment', () => {
  beforeEach(() => clearTeammateColors())

  test('first call assigns first color', () => {
    const c = assignTeammateColor('alice')
    expect(c).toBe(AGENT_COLORS[0])
  })

  test('same teammateId returns same color (sticky)', () => {
    const a = assignTeammateColor('alice')
    const b = assignTeammateColor('alice')
    expect(a).toBe(b)
  })

  test('different teammateIds get different colors (next index)', () => {
    const a = assignTeammateColor('alice')
    const b = assignTeammateColor('bob')
    expect(a).toBe(AGENT_COLORS[0])
    expect(b).toBe(AGENT_COLORS[1])
    expect(a).not.toBe(b)
  })

  test('round-robin cycles through AGENT_COLORS', () => {
    const colors = new Set<string>()
    for (let i = 0; i < AGENT_COLORS.length; i++) {
      colors.add(assignTeammateColor(`worker${i}`))
    }
    // Distinct colors for distinct ids
    expect(colors.size).toBe(AGENT_COLORS.length)
  })

  test('wraps around after exhausting AGENT_COLORS', () => {
    // n+1 teammates → first and last share a color (modulo).
    for (let i = 0; i < AGENT_COLORS.length; i++) {
      assignTeammateColor(`w${i}`)
    }
    const wrapped = assignTeammateColor(`w${AGENT_COLORS.length}`)
    expect(wrapped).toBe(AGENT_COLORS[0])
  })

  test('mixing reassignments + new IDs preserves stickiness', () => {
    const a1 = assignTeammateColor('alice') // index 0
    const b = assignTeammateColor('bob') // index 1
    const a2 = assignTeammateColor('alice') // sticky → still 0
    const c = assignTeammateColor('charlie') // index 2
    expect(a1).toBe(a2)
    expect(b).toBe(AGENT_COLORS[1])
    expect(c).toBe(AGENT_COLORS[2])
  })
})

describe('getTeammateColor — read-only lookup', () => {
  beforeEach(() => clearTeammateColors())

  test('not yet assigned → undefined', () => {
    expect(getTeammateColor('unknown')).toBeUndefined()
  })

  test('after assign, returns the assigned color', () => {
    const c = assignTeammateColor('alice')
    expect(getTeammateColor('alice')).toBe(c)
  })

  test('does NOT trigger assignment (lookup-only)', () => {
    getTeammateColor('alice') // doesn't assign
    // Now assign — should still be color 0 (no consumed index).
    expect(assignTeammateColor('alice')).toBe(AGENT_COLORS[0])
  })
})

describe('clearTeammateColors', () => {
  beforeEach(() => clearTeammateColors())

  test('resets assignments AND index counter', () => {
    assignTeammateColor('alice')
    assignTeammateColor('bob')
    clearTeammateColors()
    // alice's color should be re-allocated from index 0.
    expect(assignTeammateColor('alice')).toBe(AGENT_COLORS[0])
  })

  test('after clear, lookup returns undefined', () => {
    assignTeammateColor('alice')
    clearTeammateColors()
    expect(getTeammateColor('alice')).toBeUndefined()
  })
})
