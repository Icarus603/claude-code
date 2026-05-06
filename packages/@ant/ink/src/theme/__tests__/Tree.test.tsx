import { describe, expect, test } from 'bun:test'
import { Tree } from '../Tree.js'

describe('Tree component public API', () => {
  test('exports Tree with Node and Group statics', () => {
    expect(typeof Tree).toBe('function')
    expect(typeof Tree.Node).toBe('function')
    expect(typeof Tree.Group).toBe('function')
  })
})
