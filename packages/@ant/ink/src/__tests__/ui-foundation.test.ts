import { describe, expect, test } from 'bun:test'
import {
  getBindingDisplayText,
  parseBindings,
  type ParsedBinding,
} from '@anthropic/ink/keybindings'
import { useSearchInput } from '@anthropic/ink/search'
import {
  createInitialPersistentState,
  createInitialVimState,
  transition,
} from '@anthropic/ink/vim'
import { Cursor } from '@cc-app/utils/Cursor.js'

describe('@anthropic/ink Phase 1 public API', () => {
  test('keybindings subpath parses and resolves bindings', () => {
    const bindings = parseBindings([
      { context: 'Global', bindings: { 'ctrl+k': 'app:redraw' } },
    ]) as ParsedBinding[]
    expect(getBindingDisplayText('app:redraw', 'Global', bindings)).toBe(
      'ctrl+k',
    )
  })

  test('search subpath exports the shared hook', () => {
    expect(typeof useSearchInput).toBe('function')
  })

  test('vim subpath exposes a working transition table', () => {
    const vimState = createInitialVimState()
    const persistent = createInitialPersistentState()
    const cursor = Cursor.fromText('alpha beta', 80, 0)
    let offset = cursor.offset

    expect(vimState.mode).toBe('INSERT')
    expect(persistent.lastChange).toBeNull()

    const result = transition({ type: 'idle' }, 'w', {
      cursor,
      text: 'alpha beta',
      setText: () => {},
      setOffset: nextOffset => {
        offset = nextOffset
      },
      enterInsert: () => {},
      getRegister: () => '',
      setRegister: () => {},
      getLastFind: () => null,
      setLastFind: () => {},
      recordChange: () => {},
    })

    result.execute?.()
    expect(offset).toBeGreaterThan(0)
  })
})
