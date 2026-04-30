/**
 * Tests for isPaneBackend — pure type guard discriminating pane-based
 * backends (tmux / iterm2) from in-process backend.
 *
 * Used by killOrphanedTeammatePanes (cleanup-on-leader-exit), TeamFile
 * member filtering, and the swarm view code paths to decide whether
 * a backend supports pane management at all.
 *
 * Wrong discrimination:
 * - in-process treated as pane-backed → tmux/iTerm2 calls fail noisily
 * - tmux/iterm2 treated as not-pane-backed → cleanup skips real panes
 *   on leader exit → orphaned tmux sessions leak between sessions
 */
import { describe, expect, test } from 'bun:test'
import { isPaneBackend } from '../backends/types.js'

describe('isPaneBackend — pane-based backends', () => {
  test('tmux → true', () => {
    expect(isPaneBackend('tmux')).toBe(true)
  })

  test('iterm2 → true', () => {
    expect(isPaneBackend('iterm2')).toBe(true)
  })
})

describe('isPaneBackend — in-process backend', () => {
  test('in-process → false (no pane to manage)', () => {
    expect(isPaneBackend('in-process')).toBe(false)
  })
})

describe('isPaneBackend — type narrowing contract', () => {
  test('returns boolean (never undefined/null)', () => {
    expect(typeof isPaneBackend('tmux')).toBe('boolean')
    expect(typeof isPaneBackend('iterm2')).toBe('boolean')
    expect(typeof isPaneBackend('in-process')).toBe('boolean')
  })

  test('type narrows to PaneBackendType when true', () => {
    // Compile-time check via runtime assertion: when the predicate
    // returns true, the value is one of 'tmux' | 'iterm2'.
    const candidates: ('tmux' | 'iterm2' | 'in-process')[] = [
      'tmux',
      'iterm2',
      'in-process',
    ]
    const paneBackends = candidates.filter(isPaneBackend)
    // After filter, paneBackends is PaneBackendType[] = ('tmux' | 'iterm2')[]
    for (const b of paneBackends) {
      expect(b === 'tmux' || b === 'iterm2').toBe(true)
    }
  })

  test('exhaustive: filter narrows out non-pane backends', () => {
    const all: ('tmux' | 'iterm2' | 'in-process')[] = [
      'in-process',
      'tmux',
      'in-process',
      'iterm2',
      'in-process',
    ]
    expect(all.filter(isPaneBackend)).toEqual(['tmux', 'iterm2'])
  })
})
