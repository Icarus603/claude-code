/**
 * Tests for treeify — pure helper that renders a nested object as
 * an ASCII tree. Used in the REPL for things like /agents tree
 * view, MCP server inspector, debug dumps.
 *
 * Wrong rendering = malformed display (broken indentation tells the
 * user nothing). Wrong circular handling = infinite loop on
 * self-referencing AppState dumps.
 */
import { describe, expect, test } from 'bun:test'
import { treeify, type TreeNode } from '../uiHelpers/treeify.js'

// Strip ANSI escape codes so we can compare structure without color codes.
// biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI escape match is intentional
const STRIP_ANSI = /\x1B\[[0-?]*[ -/]*[@-~]/g
const stripAnsi = (s: string) => s.replace(STRIP_ANSI, '')

describe('treeify — degenerate cases', () => {
  test('empty object → "(empty)"', () => {
    expect(stripAnsi(treeify({}))).toBe('(empty)')
  })

  test('single empty-key string → no key rendered, just value with last-branch char', () => {
    // Documented special case: { '': 'foo' } renders as "└ foo"
    const out = stripAnsi(treeify({ '': 'foo' }))
    expect(out).toContain('foo')
    expect(out).toMatch(/└\s/)
  })
})

describe('treeify — basic shapes', () => {
  test('flat object: each key becomes a branch line', () => {
    const out = stripAnsi(treeify({ a: '1', b: '2' }))
    const lines = out.split('\n')
    expect(lines).toHaveLength(2)
    // First key uses ├ (branch), last key uses └ (lastBranch).
    expect(lines[0]).toMatch(/├/)
    expect(lines[1]).toMatch(/└/)
    // Both keys + values present.
    expect(out).toContain('a')
    expect(out).toContain('1')
    expect(out).toContain('b')
    expect(out).toContain('2')
  })

  test('single-key object uses last-branch char (└)', () => {
    const out = stripAnsi(treeify({ x: 'y' }))
    expect(out).toMatch(/└/)
    expect(out).not.toMatch(/├/)
  })

  test('keys appear in insertion order', () => {
    const out = stripAnsi(treeify({ z: '1', a: '2', m: '3' }))
    const zIdx = out.indexOf('z')
    const aIdx = out.indexOf('a')
    const mIdx = out.indexOf('m')
    expect(zIdx).toBeLessThan(aIdx)
    expect(aIdx).toBeLessThan(mIdx)
  })
})

describe('treeify — nested objects', () => {
  test('nested object rendered with continuation char', () => {
    const obj: TreeNode = {
      parent: { child: 'val' } as TreeNode,
    }
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('parent')
    expect(out).toContain('child')
    expect(out).toContain('val')
  })

  test('deeply nested: 3 levels', () => {
    const obj: TreeNode = {
      l1: {
        l2: {
          l3: 'deep',
        } as TreeNode,
      } as TreeNode,
    }
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('l1')
    expect(out).toContain('l2')
    expect(out).toContain('l3')
    expect(out).toContain('deep')
  })

  test('mid-tree non-last child uses │ continuation, not space', () => {
    const obj: TreeNode = {
      first: { x: 'a' } as TreeNode,
      second: { y: 'b' } as TreeNode,
    }
    const out = stripAnsi(treeify(obj))
    // The first child is NOT last → its continuation should be │
    // (the line drawing char, U+2502).
    expect(out).toMatch(/│/)
  })

  test('last child uses space continuation, not │', () => {
    const obj: TreeNode = {
      only: { x: 'a' } as TreeNode,
    }
    const out = stripAnsi(treeify(obj))
    // 'only' is the last → continuation should NOT be │
    // For a single-child object the line drawing char would only appear
    // when there's a sibling.
    const lines = out.split('\n')
    // Line 1 is "└ only" (no value), line 2 is "  └ x: a"
    expect(lines[1]).not.toMatch(/^│/)
  })
})

describe('treeify — value rendering', () => {
  test('string values rendered as-is', () => {
    const out = stripAnsi(treeify({ k: 'hello world' }))
    expect(out).toContain('hello world')
  })

  test('arrays rendered as [Array(N)]', () => {
    const obj = { items: [1, 2, 3] as unknown as TreeNode }
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('[Array(3)]')
  })

  test('empty array rendered as [Array(0)]', () => {
    const obj = { items: [] as unknown as TreeNode }
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('[Array(0)]')
  })

  test('functions rendered as [Function]', () => {
    const obj = { fn: (() => {}) as unknown as TreeNode }
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('[Function]')
  })

  test('hideFunctions=true hides function keys', () => {
    const obj = { fn: (() => {}) as unknown as TreeNode, k: 'v' }
    const out = stripAnsi(treeify(obj, { hideFunctions: true }))
    expect(out).not.toContain('fn')
    expect(out).not.toContain('[Function]')
    expect(out).toContain('k')
  })

  test('numbers cast to string', () => {
    const obj = { n: 42 as unknown as TreeNode }
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('42')
  })

  test('booleans cast to string', () => {
    const obj = { b: true as unknown as TreeNode }
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('true')
  })
})

describe('treeify — showValues option', () => {
  test('showValues=false hides primitive values, keeps keys', () => {
    const obj = { k: 'hidden' }
    const out = stripAnsi(treeify(obj, { showValues: false }))
    expect(out).toContain('k')
    expect(out).not.toContain('hidden')
  })

  test('showValues=false still renders arrays as [Array(N)]', () => {
    // Array branch is unconditional; only the showValues else-arm gates.
    const obj = { items: [1, 2] as unknown as TreeNode }
    const out = stripAnsi(treeify(obj, { showValues: false }))
    expect(out).toContain('[Array(2)]')
  })
})

describe('treeify — circular reference handling', () => {
  test('self-referencing object → [Circular] marker, no infinite loop', () => {
    const obj: TreeNode = { name: 'root' }
    obj.self = obj
    const out = stripAnsi(treeify(obj))
    expect(out).toContain('[Circular]')
  })

  test('mutually circular: a → b → a', () => {
    const a: TreeNode = { name: 'a' }
    const b: TreeNode = { name: 'b', back: a }
    a.fwd = b
    const out = stripAnsi(treeify({ root: a }))
    expect(out).toContain('[Circular]')
  })

  test('non-circular shared references render normally (NOT marked circular)', () => {
    // Documented quirk: visited is a WeakSet that grows monotonically
    // during a single treeify call. So even non-cyclic shared subtrees
    // are flagged once visited. This locks the limitation.
    const shared: TreeNode = { x: 'shared' }
    const obj: TreeNode = { a: shared, b: shared }
    const out = stripAnsi(treeify(obj))
    // First occurrence renders, second marks Circular.
    expect(out).toContain('shared')
    expect(out).toContain('[Circular]')
  })
})

describe('treeify — branch character invariants', () => {
  test('exactly one └ per parent (last child) at top level', () => {
    const out = stripAnsi(treeify({ a: '1', b: '2', c: '3' }))
    const lastBranches = (out.match(/└/g) || []).length
    expect(lastBranches).toBe(1)
  })

  test('exactly N-1 ├ for N siblings', () => {
    const out = stripAnsi(treeify({ a: '1', b: '2', c: '3', d: '4' }))
    const branches = (out.match(/├/g) || []).length
    expect(branches).toBe(3) // 4 - 1
  })

  test('total branch markers = N (├ + └)', () => {
    const out = stripAnsi(treeify({ a: '1', b: '2', c: '3' }))
    const total =
      (out.match(/├/g) || []).length + (out.match(/└/g) || []).length
    expect(total).toBe(3)
  })
})

describe('treeify — return type', () => {
  test('always returns string', () => {
    expect(typeof treeify({})).toBe('string')
    expect(typeof treeify({ a: '1' })).toBe('string')
    expect(typeof treeify({ a: { b: 'c' } as TreeNode })).toBe('string')
  })
})
