/**
 * Tests for isHookEqual — pure helper deciding if two hooks are
 * equal. Used by hook deduplication and registration paths.
 *
 * Wrong equality:
 * - duplicate hooks register and fire TWICE (e.g. PostToolUse hook
 *   runs twice per tool call)
 * - distinct hooks merge → one silently drops (user's hook + plugin
 *   hook with same command but different `if` condition)
 *
 * 5 hook types: command (shell command), prompt (text prompt to
 * user), agent (subagent), http (webhook), function (in-process
 * callback — never equal because no stable id).
 */
import { describe, expect, test } from 'bun:test'
import { isHookEqual } from '../isHookEqual.js'

type Hook = Parameters<typeof isHookEqual>[0]

describe('isHookEqual — type discrimination', () => {
  test('command vs prompt → false (different types)', () => {
    expect(
      isHookEqual(
        { type: 'command', command: 'echo hi' } as Hook,
        { type: 'prompt', prompt: 'echo hi' } as Hook,
      ),
    ).toBe(false)
  })

  test('agent vs http → false', () => {
    expect(
      isHookEqual(
        { type: 'agent', prompt: 'do thing' } as Hook,
        { type: 'http', url: 'https://example.com' } as Hook,
      ),
    ).toBe(false)
  })
})

describe('isHookEqual — command type', () => {
  test('same command, default shell, no if → true', () => {
    const a = { type: 'command', command: 'echo hi' } as Hook
    const b = { type: 'command', command: 'echo hi' } as Hook
    expect(isHookEqual(a, b)).toBe(true)
  })

  test('different commands → false', () => {
    expect(
      isHookEqual(
        { type: 'command', command: 'echo a' } as Hook,
        { type: 'command', command: 'echo b' } as Hook,
      ),
    ).toBe(false)
  })

  test('undefined shell vs explicit "bash" → equal (defaults match)', () => {
    // Documented contract: shell defaults to DEFAULT_HOOK_SHELL ('bash');
    // undefined === 'bash' for equality.
    expect(
      isHookEqual(
        { type: 'command', command: 'echo' } as Hook,
        { type: 'command', command: 'echo', shell: 'bash' } as Hook,
      ),
    ).toBe(true)
  })

  test('different shells → false', () => {
    expect(
      isHookEqual(
        { type: 'command', command: 'echo', shell: 'bash' } as Hook,
        { type: 'command', command: 'echo', shell: 'zsh' } as Hook,
      ),
    ).toBe(false)
  })

  test('same command + different `if` → false (if is part of identity)', () => {
    // Documented: if is part of hook identity. Same command with
    // different conditions = distinct hooks.
    expect(
      isHookEqual(
        { type: 'command', command: 'echo', if: 'a' } as Hook,
        { type: 'command', command: 'echo', if: 'b' } as Hook,
      ),
    ).toBe(false)
  })

  test('undefined `if` vs empty string `if` → equal (both default)', () => {
    expect(
      isHookEqual(
        { type: 'command', command: 'echo' } as Hook,
        { type: 'command', command: 'echo', if: '' } as Hook,
      ),
    ).toBe(true)
  })
})

describe('isHookEqual — prompt type', () => {
  test('same prompt → true', () => {
    expect(
      isHookEqual(
        { type: 'prompt', prompt: 'hello' } as Hook,
        { type: 'prompt', prompt: 'hello' } as Hook,
      ),
    ).toBe(true)
  })

  test('different prompts → false', () => {
    expect(
      isHookEqual(
        { type: 'prompt', prompt: 'a' } as Hook,
        { type: 'prompt', prompt: 'b' } as Hook,
      ),
    ).toBe(false)
  })

  test('same prompt different `if` → false', () => {
    expect(
      isHookEqual(
        { type: 'prompt', prompt: 'a', if: 'x' } as Hook,
        { type: 'prompt', prompt: 'a', if: 'y' } as Hook,
      ),
    ).toBe(false)
  })
})

describe('isHookEqual — agent type', () => {
  test('same agent prompt → true', () => {
    expect(
      isHookEqual(
        { type: 'agent', prompt: 'find bugs' } as Hook,
        { type: 'agent', prompt: 'find bugs' } as Hook,
      ),
    ).toBe(true)
  })

  test('different agent prompts → false', () => {
    expect(
      isHookEqual(
        { type: 'agent', prompt: 'a' } as Hook,
        { type: 'agent', prompt: 'b' } as Hook,
      ),
    ).toBe(false)
  })
})

describe('isHookEqual — http type', () => {
  test('same url → true', () => {
    expect(
      isHookEqual(
        { type: 'http', url: 'https://example.com/hook' } as Hook,
        { type: 'http', url: 'https://example.com/hook' } as Hook,
      ),
    ).toBe(true)
  })

  test('different urls → false', () => {
    expect(
      isHookEqual(
        { type: 'http', url: 'https://a.example.com' } as Hook,
        { type: 'http', url: 'https://b.example.com' } as Hook,
      ),
    ).toBe(false)
  })

  test('same url different `if` → false', () => {
    expect(
      isHookEqual(
        { type: 'http', url: 'https://x.com', if: 'a' } as Hook,
        { type: 'http', url: 'https://x.com', if: 'b' } as Hook,
      ),
    ).toBe(false)
  })
})

describe('isHookEqual — function type (always false)', () => {
  test('two function hooks with same shape → false', () => {
    // Documented: function hooks can't be compared (no stable
    // identifier). Two registrations of the "same" function are
    // treated as distinct.
    expect(
      isHookEqual(
        { type: 'function', timeout: 1000 } as Hook,
        { type: 'function', timeout: 1000 } as Hook,
      ),
    ).toBe(false)
  })

  test('function hook compared to itself → still false', () => {
    const fn = { type: 'function' } as Hook
    expect(isHookEqual(fn, fn)).toBe(false)
  })
})

describe('isHookEqual — return shape', () => {
  test('always returns boolean', () => {
    const samples: Array<[Hook, Hook]> = [
      [{ type: 'command', command: 'a' } as Hook, { type: 'command', command: 'a' } as Hook],
      [{ type: 'prompt', prompt: 'a' } as Hook, { type: 'agent', prompt: 'a' } as Hook],
      [{ type: 'function' } as Hook, { type: 'function' } as Hook],
    ]
    for (const [a, b] of samples) {
      expect(typeof isHookEqual(a, b)).toBe('boolean')
    }
  })
})
