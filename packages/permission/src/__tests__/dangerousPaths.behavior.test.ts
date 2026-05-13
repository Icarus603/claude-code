import { describe, expect, test } from 'bun:test'

import {
  DANGEROUS_DIRECTORIES,
  DANGEROUS_FILES,
  normalizeCaseForComparison,
} from '../filesystem.ts'

/**
 * Pin DANGEROUS_FILES and DANGEROUS_DIRECTORIES lists. These get
 * special-cased permission gating to prevent auto-editing of files that
 * could:
 *   - Execute code on next shell launch (.bashrc, .zshrc, .profile, etc.)
 *   - Exfiltrate via git remote redirection (.gitconfig, .gitmodules)
 *   - Override project safety rails (.mcp.json, .claude.json)
 *   - Tamper with system state (.git, .claude directories)
 *
 * Drift here is a SECURITY regression — pin the whole list.
 */
describe('dangerous-file/dir lists (auto-edit gating)', () => {
  describe('DANGEROUS_FILES', () => {
    test('contains shell init files (.bashrc, .zshrc, .profile, etc.)', () => {
      // Shell init files execute on every new shell. Auto-editing them
      // is a privilege escalation vector.
      expect([...DANGEROUS_FILES]).toEqual(
        expect.arrayContaining([
          '.bashrc',
          '.bash_profile',
          '.zshrc',
          '.zprofile',
          '.profile',
        ]),
      )
    })

    test('contains git config files (.gitconfig, .gitmodules)', () => {
      // .gitconfig can redirect remote URLs (data exfiltration).
      // .gitmodules can declare malicious submodule sources.
      expect([...DANGEROUS_FILES]).toEqual(
        expect.arrayContaining(['.gitconfig', '.gitmodules']),
      )
    })

    test('contains .ripgreprc (controls rg search behavior / file include)', () => {
      // .ripgreprc can redirect search to read sensitive paths.
      expect([...DANGEROUS_FILES]).toContain('.ripgreprc')
    })

    test('contains .mcp.json (MCP server config — code execution surface)', () => {
      // Editing .mcp.json without trust prompt would let untrusted code
      // register an MCP server that executes arbitrary commands.
      expect([...DANGEROUS_FILES]).toContain('.mcp.json')
    })

    test('contains .claude.json (project settings, including hooks)', () => {
      // .claude.json contains apiKeyHelper and hooks — direct CE vectors.
      expect([...DANGEROUS_FILES]).toContain('.claude.json')
    })

    test('list length is exactly 10 (pin against silent additions/removals)', () => {
      expect(DANGEROUS_FILES.length).toBe(10)
    })

    test('all entries are leaf filenames (no path separators)', () => {
      // Path-separator entries would be matched differently — pin so the
      // list stays leaf-name-only.
      for (const file of DANGEROUS_FILES) {
        expect(file).not.toContain('/')
        expect(file).not.toContain('\\')
      }
    })
  })

  describe('DANGEROUS_DIRECTORIES', () => {
    test('exact list: .git, .vscode, .idea, .claude', () => {
      expect([...DANGEROUS_DIRECTORIES]).toEqual([
        '.git',
        '.vscode',
        '.idea',
        '.claude',
      ])
    })

    test('all entries are leaf dirnames (no path separators)', () => {
      for (const dir of DANGEROUS_DIRECTORIES) {
        expect(dir).not.toContain('/')
        expect(dir).not.toContain('\\')
      }
    })
  })

  describe('normalizeCaseForComparison', () => {
    test('always lowercases (regardless of platform)', () => {
      // Critical: case-insensitive filesystems (macOS/Windows) could
      // bypass `.claude` check via `.CLaude` — universal lowercase prevents this.
      expect(normalizeCaseForComparison('.CLaude/Settings.locaL.json')).toBe(
        '.claude/settings.local.json',
      )
      expect(normalizeCaseForComparison('/Users/foo/.BASHrc')).toBe(
        '/users/foo/.bashrc',
      )
    })

    test('NOT platform-conditional (Linux paths also lowercased)', () => {
      // Pin against a refactor that says "Linux is case-sensitive so we
      // can skip normalization there" — that would create a divergence
      // where the same path matches on macOS but bypasses on Linux.
      const original = '/etc/Profile'
      expect(normalizeCaseForComparison(original)).toBe('/etc/profile')
    })
  })
})
