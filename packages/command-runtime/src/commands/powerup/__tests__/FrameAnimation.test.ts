import { describe, expect, test } from 'bun:test'
import {
  DEFAULT_FRAME_INTERVAL_MS,
  FrameAnimation,
  nextFrameIndex,
} from '../FrameAnimation.js'

describe('FrameAnimation', () => {
  test('component is a function (smoke)', () => {
    expect(typeof FrameAnimation).toBe('function')
  })

  test('default interval is 3000ms (matches ant Q8K)', () => {
    expect(DEFAULT_FRAME_INTERVAL_MS).toBe(3000)
  })
})

describe('nextFrameIndex', () => {
  test('advances by one within bounds', () => {
    expect(nextFrameIndex(0, 3)).toBe(1)
    expect(nextFrameIndex(1, 3)).toBe(2)
  })

  test('wraps from last back to 0', () => {
    expect(nextFrameIndex(2, 3)).toBe(0)
  })

  test('single-frame input always returns 0', () => {
    expect(nextFrameIndex(0, 1)).toBe(0)
    expect(nextFrameIndex(99, 1)).toBe(0)
  })

  test('empty input returns 0', () => {
    expect(nextFrameIndex(0, 0)).toBe(0)
  })
})
