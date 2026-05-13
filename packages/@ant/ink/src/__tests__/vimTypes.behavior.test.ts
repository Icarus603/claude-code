import { describe, expect, test } from 'bun:test'

import {
  FIND_KEYS,
  MAX_VIM_COUNT,
  OPERATORS,
  SIMPLE_MOTIONS,
  TEXT_OBJ_SCOPES,
  TEXT_OBJ_TYPES,
  createInitialPersistentState,
  createInitialVimState,
  isOperatorKey,
  isTextObjScopeKey,
} from '../vim/types.ts'

/**
 * Pin vim state machine vocabulary. These constants drive the
 * keystroke-to-action mapping in transitions.ts.
 *
 * Critical invariants:
 *  1. OPERATORS exactly { d: 'delete', c: 'change', y: 'yank' }.
 *  2. SIMPLE_MOTIONS exactly 13 keys (h/l/j/k/w/b/e/W/B/E/0/^/$).
 *  3. FIND_KEYS exactly { f, F, t, T }.
 *  4. TEXT_OBJ_SCOPES = { i: inner, a: around }.
 *  5. TEXT_OBJ_TYPES includes vim's standard text objects PLUS aliases:
 *     w/W (word/WORD), "/' /` (quoted), ()/b (paren), []/{}/B (bracket),
 *     <> (angle).
 *  6. MAX_VIM_COUNT = 10000 (prevents runaway 100000h).
 *  7. Initial state: INSERT mode (not NORMAL — vim starts in INSERT for
 *     ccb prompt).
 *  8. isOperatorKey / isTextObjScopeKey type-guard narrowing.
 */
describe('vim/types — operator vocabulary', () => {
  test('OPERATORS = { d: delete, c: change, y: yank }', () => {
    // Pin: exactly 3 operators. ant doesn't expose `>` / `<` here
    // (those are linewise operators handled separately).
    expect(OPERATORS).toEqual({ d: 'delete', c: 'change', y: 'yank' })
  })

  test('isOperatorKey accepts d/c/y, rejects others', () => {
    expect(isOperatorKey('d')).toBe(true)
    expect(isOperatorKey('c')).toBe(true)
    expect(isOperatorKey('y')).toBe(true)
    expect(isOperatorKey('x')).toBe(false)
    expect(isOperatorKey('D')).toBe(false) // uppercase D is x-equivalent
    expect(isOperatorKey('')).toBe(false)
  })

  test('isOperatorKey is type-narrowing (TS-only behavior)', () => {
    // Pin: return type `key is keyof typeof OPERATORS` lets caller use
    // OPERATORS[key] without an extra null check. Compile-time only,
    // but exercise the JS implementation.
    const key = 'd'
    if (isOperatorKey(key)) {
      // TS narrows to 'd'|'c'|'y'; OPERATORS[key] works.
      expect(OPERATORS[key]).toBe('delete')
    }
  })
})

describe('vim/types — motion vocabulary', () => {
  test('SIMPLE_MOTIONS has exactly 13 keys', () => {
    // Pin: count change indicates a deliberate addition. Audit list:
    // h/l, j/k, w/b/e, W/B/E, 0/^/$
    expect(SIMPLE_MOTIONS.size).toBe(13)
  })

  test('SIMPLE_MOTIONS includes all basic h/l/j/k', () => {
    expect(SIMPLE_MOTIONS.has('h')).toBe(true)
    expect(SIMPLE_MOTIONS.has('l')).toBe(true)
    expect(SIMPLE_MOTIONS.has('j')).toBe(true)
    expect(SIMPLE_MOTIONS.has('k')).toBe(true)
  })

  test('SIMPLE_MOTIONS includes word motions (w/b/e + W/B/E)', () => {
    expect(SIMPLE_MOTIONS.has('w')).toBe(true)
    expect(SIMPLE_MOTIONS.has('b')).toBe(true)
    expect(SIMPLE_MOTIONS.has('e')).toBe(true)
    expect(SIMPLE_MOTIONS.has('W')).toBe(true)
    expect(SIMPLE_MOTIONS.has('B')).toBe(true)
    expect(SIMPLE_MOTIONS.has('E')).toBe(true)
  })

  test('SIMPLE_MOTIONS includes line motions (0/^/$)', () => {
    expect(SIMPLE_MOTIONS.has('0')).toBe(true)
    expect(SIMPLE_MOTIONS.has('^')).toBe(true)
    expect(SIMPLE_MOTIONS.has('$')).toBe(true)
  })

  test('SIMPLE_MOTIONS excludes G/gg (handled separately as state transitions)', () => {
    // Pin: G and gg are NOT in SIMPLE_MOTIONS — they go through the
    // 'g' command state.
    expect(SIMPLE_MOTIONS.has('G')).toBe(false)
    expect(SIMPLE_MOTIONS.has('gg')).toBe(false)
  })
})

describe('vim/types — find keys', () => {
  test('FIND_KEYS = exactly {f, F, t, T}', () => {
    expect(FIND_KEYS.size).toBe(4)
    expect(FIND_KEYS.has('f')).toBe(true)
    expect(FIND_KEYS.has('F')).toBe(true)
    expect(FIND_KEYS.has('t')).toBe(true)
    expect(FIND_KEYS.has('T')).toBe(true)
  })

  test('FIND_KEYS does NOT include / or ? (those are search, separate)', () => {
    expect(FIND_KEYS.has('/')).toBe(false)
    expect(FIND_KEYS.has('?')).toBe(false)
  })
})

describe('vim/types — text object scopes', () => {
  test('TEXT_OBJ_SCOPES = { i: inner, a: around }', () => {
    expect(TEXT_OBJ_SCOPES).toEqual({ i: 'inner', a: 'around' })
  })

  test('isTextObjScopeKey accepts i/a, rejects others', () => {
    expect(isTextObjScopeKey('i')).toBe(true)
    expect(isTextObjScopeKey('a')).toBe(true)
    expect(isTextObjScopeKey('o')).toBe(false)
    expect(isTextObjScopeKey('w')).toBe(false)
  })
})

describe('vim/types — text object types', () => {
  test('Word types: w, W', () => {
    expect(TEXT_OBJ_TYPES.has('w')).toBe(true)
    expect(TEXT_OBJ_TYPES.has('W')).toBe(true)
  })

  test('Quote types: ", \', `', () => {
    expect(TEXT_OBJ_TYPES.has('"')).toBe(true)
    expect(TEXT_OBJ_TYPES.has("'")).toBe(true)
    expect(TEXT_OBJ_TYPES.has('`')).toBe(true)
  })

  test('Paren aliases: ( ) b (all map to parens)', () => {
    // Pin: vim convention — b is an alias for ( / ).
    expect(TEXT_OBJ_TYPES.has('(')).toBe(true)
    expect(TEXT_OBJ_TYPES.has(')')).toBe(true)
    expect(TEXT_OBJ_TYPES.has('b')).toBe(true)
  })

  test('Bracket aliases: [ ] { } B (all map to brackets)', () => {
    // Pin: B is alias for { / }.
    expect(TEXT_OBJ_TYPES.has('[')).toBe(true)
    expect(TEXT_OBJ_TYPES.has(']')).toBe(true)
    expect(TEXT_OBJ_TYPES.has('{')).toBe(true)
    expect(TEXT_OBJ_TYPES.has('}')).toBe(true)
    expect(TEXT_OBJ_TYPES.has('B')).toBe(true)
  })

  test('Angle: < >', () => {
    expect(TEXT_OBJ_TYPES.has('<')).toBe(true)
    expect(TEXT_OBJ_TYPES.has('>')).toBe(true)
  })

  test('NOT included: t (tag), s (sentence), p (paragraph)', () => {
    // Pin: documented limitations of this vim emulation.
    expect(TEXT_OBJ_TYPES.has('t')).toBe(false)
    expect(TEXT_OBJ_TYPES.has('s')).toBe(false)
    expect(TEXT_OBJ_TYPES.has('p')).toBe(false)
  })

  test('Total count = 15 (current vocabulary)', () => {
    // Pin: addition or removal of a text object should be deliberate.
    expect(TEXT_OBJ_TYPES.size).toBe(15)
  })
})

describe('vim/types — limits and initial state', () => {
  test('MAX_VIM_COUNT = 10000 (prevents runaway counts)', () => {
    // Pin: user typing 999999h must not spin the cursor.
    expect(MAX_VIM_COUNT).toBe(10000)
  })

  test('createInitialVimState → INSERT mode (NOT NORMAL)', () => {
    // Pin: ccb prompt starts in INSERT for normal user typing.
    // A regression to NORMAL would block typing until user presses i.
    const state = createInitialVimState()
    expect(state.mode).toBe('INSERT')
    if (state.mode === 'INSERT') {
      expect(state.insertedText).toBe('')
    }
  })

  test('createInitialPersistentState: all empty/null defaults', () => {
    const state = createInitialPersistentState()
    expect(state.lastChange).toBeNull()
    expect(state.lastFind).toBeNull()
    expect(state.register).toBe('')
    expect(state.registerIsLinewise).toBe(false)
  })

  test('createInitialPersistentState returns fresh object each call', () => {
    // Pin: factory pattern, not shared singleton.
    const a = createInitialPersistentState()
    const b = createInitialPersistentState()
    expect(a).not.toBe(b)
    // But equal in shape.
    expect(a).toEqual(b)
  })
})
