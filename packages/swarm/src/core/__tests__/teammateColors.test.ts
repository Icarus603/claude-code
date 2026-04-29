import { afterEach, describe, expect, test } from 'bun:test'
import {
  assignTeammateColor,
  clearTeammateColors,
  getTeammateColor,
} from '../teammateColors.js'
import { AGENT_COLORS } from '../../adapters/appRuntime.js'

afterEach(() => {
  clearTeammateColors()
})

describe('assignTeammateColor', () => {
  test('returns the same color for the same teammateId on repeat calls (memoized)', () => {
    const first = assignTeammateColor('alice')
    const second = assignTeammateColor('alice')
    expect(first).toBe(second)
  })

  test('cycles through AGENT_COLORS in order', () => {
    const palette = AGENT_COLORS.slice(0, 3)
    const colors = ['t0', 't1', 't2'].map(assignTeammateColor)
    expect(colors).toEqual(palette as typeof colors)
  })

  test('wraps around when more teammates than palette size', () => {
    const ids = Array.from(
      { length: AGENT_COLORS.length + 1 },
      (_, i) => `t${i}`,
    )
    const colors = ids.map(assignTeammateColor)
    // first AGENT_COLORS.length should be the full palette
    expect(colors.slice(0, AGENT_COLORS.length)).toEqual(
      [...AGENT_COLORS] as typeof colors,
    )
    // the (length+1)-th teammate gets the first color again
    expect(colors[AGENT_COLORS.length]).toBe(AGENT_COLORS[0]!)
  })
})

describe('getTeammateColor', () => {
  test('returns undefined for an unassigned teammate', () => {
    expect(getTeammateColor('never-assigned')).toBeUndefined()
  })

  test('returns the assigned color after assignTeammateColor', () => {
    const assigned = assignTeammateColor('bob')
    expect(getTeammateColor('bob')).toBe(assigned)
  })
})

describe('clearTeammateColors', () => {
  test('forgets all assignments', () => {
    assignTeammateColor('alice')
    assignTeammateColor('bob')
    clearTeammateColors()
    expect(getTeammateColor('alice')).toBeUndefined()
    expect(getTeammateColor('bob')).toBeUndefined()
  })

  test('resets the color cycle index', () => {
    assignTeammateColor('alice')
    assignTeammateColor('bob')
    assignTeammateColor('charlie')
    clearTeammateColors()
    // After clear, next assignment should get the FIRST color again,
    // not the 4th. This catches a regression where colorIndex isn't reset.
    expect(assignTeammateColor('dave')).toBe(AGENT_COLORS[0]!)
  })
})
