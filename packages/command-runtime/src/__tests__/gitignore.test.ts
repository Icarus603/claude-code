import { describe, expect, test } from 'bun:test'
import { homedir } from 'os'
import { join } from 'path'
import { getGlobalGitignorePath } from '../gitignore.js'

describe('getGlobalGitignorePath', () => {
  test('returns ~/.config/git/ignore', () => {
    expect(getGlobalGitignorePath()).toBe(
      join(homedir(), '.config', 'git', 'ignore'),
    )
  })

  test('produces an absolute path', () => {
    const p = getGlobalGitignorePath()
    expect(p.startsWith('/') || /^[A-Za-z]:[\\/]/.test(p)).toBe(true)
  })

  test('does not append a trailing slash', () => {
    expect(getGlobalGitignorePath().endsWith('/')).toBe(false)
    expect(getGlobalGitignorePath().endsWith('\\')).toBe(false)
  })

  test('matches the canonical XDG-ish path the user can edit', () => {
    // Verifies that this function points at the same file `man gitignore`
    // calls "the per-user ignore file" so users editing it manually are
    // touching the same path the tool writes to.
    const p = getGlobalGitignorePath()
    expect(p).toContain('.config')
    expect(p).toContain('git')
    expect(p.endsWith('ignore')).toBe(true)
  })
})
