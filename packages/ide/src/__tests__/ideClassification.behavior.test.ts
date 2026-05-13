import { describe, expect, test } from 'bun:test'

import { isJetBrainsIde, isVSCodeIde } from '../ide.ts'

/**
 * Pin IDE classification helpers. These gate JetBrains plugin install
 * recommendations + VSCode-specific features.
 *
 * Wrong classification → user in IntelliJ gets VSCode-specific UI hints
 * (or vice-versa); JetBrains user not prompted to install the plugin.
 */
describe('IDE classification', () => {
  describe('isVSCodeIde', () => {
    test('null → false', () => {
      expect(isVSCodeIde(null)).toBeFalsy()
    })

    test('vscode + forks (cursor, windsurf) recognized', () => {
      expect(isVSCodeIde('vscode' as any)).toBe(true)
      expect(isVSCodeIde('cursor' as any)).toBe(true)
      expect(isVSCodeIde('windsurf' as any)).toBe(true)
    })

    test('JetBrains products → false', () => {
      expect(isVSCodeIde('intellij' as any)).toBeFalsy()
      expect(isVSCodeIde('pycharm' as any)).toBeFalsy()
      expect(isVSCodeIde('webstorm' as any)).toBeFalsy()
    })

    test('unknown terminal → false (defensive default)', () => {
      expect(isVSCodeIde('Apple_Terminal' as any)).toBeFalsy()
      expect(isVSCodeIde('iTerm.app' as any)).toBeFalsy()
    })
  })

  describe('isJetBrainsIde', () => {
    test('null → false', () => {
      expect(isJetBrainsIde(null)).toBeFalsy()
    })

    test('JetBrains IDEs return true (intellij, pycharm, webstorm, etc)', () => {
      expect(isJetBrainsIde('intellij' as any)).toBe(true)
      expect(isJetBrainsIde('pycharm' as any)).toBe(true)
      expect(isJetBrainsIde('webstorm' as any)).toBe(true)
      expect(isJetBrainsIde('androidstudio' as any)).toBe(true)
      expect(isJetBrainsIde('goland' as any)).toBe(true)
      expect(isJetBrainsIde('rubymine' as any)).toBe(true)
    })

    test('VSCode forks → false (mutual exclusion with isVSCodeIde)', () => {
      expect(isJetBrainsIde('vscode' as any)).toBeFalsy()
      expect(isJetBrainsIde('cursor' as any)).toBeFalsy()
      expect(isJetBrainsIde('windsurf' as any)).toBeFalsy()
    })

    test('plain terminals → false', () => {
      expect(isJetBrainsIde('Apple_Terminal' as any)).toBeFalsy()
    })
  })

  test('isVSCodeIde and isJetBrainsIde are MUTUALLY EXCLUSIVE', () => {
    // Same IDE can't be both. Pin this for all known IDEs.
    const ides = [
      'vscode',
      'cursor',
      'windsurf',
      'intellij',
      'pycharm',
      'webstorm',
      'androidstudio',
      'goland',
    ]
    for (const ide of ides) {
      const isV = !!isVSCodeIde(ide as any)
      const isJ = !!isJetBrainsIde(ide as any)
      // Exactly one of the two is true for each known IDE.
      expect(isV && isJ).toBe(false)
    }
  })
})
