/**
 * Tests for WSL → Windows managed-settings reader.
 *
 * Port-correctness against ant v2.1.136 `gI6` (0684.js).
 *
 * The full registry read path is integration (needs WSL + reg.exe).
 * These unit tests pin the public contract:
 *   - Hardcoded-off gate (ant E6_() === false) causes
 *     `getWslInheritedWindowsSettings()` to return null without
 *     spawning any subprocesses
 *   - The function is reachable from outside the package
 *
 * If/when ant flips the gate back on, these tests will start failing
 * (the gate guard returns null synchronously regardless of WSL state)
 * and the test ought to be updated alongside the gate flip.
 */
import { describe, expect, test } from 'bun:test'
import { getWslInheritedWindowsSettings } from '../wslWindowsSettings.js'

describe('getWslInheritedWindowsSettings (ant gI6 — gated off in v2.1.136)', () => {
  test('returns null without any side-effects (ant E6_() === false)', async () => {
    // The function MUST short-circuit before doing any FS or process
    // work. We can't observe "no side-effects" directly in a unit
    // test, but we can verify the return is a plain `null` so the
    // caller's null-check fires and skips the merge.
    const result = await getWslInheritedWindowsSettings()
    expect(result).toBeNull()
  })

  test('is callable repeatedly (no module-level cache poisoning)', async () => {
    for (let i = 0; i < 3; i++) {
      expect(await getWslInheritedWindowsSettings()).toBeNull()
    }
  })

  test('does not throw when called outside WSL', async () => {
    // The gate must return null cleanly even on macOS/native Windows
    // where /proc/version doesn't exist. We rely on the gate's
    // `isWslChainEnabled()` short-circuiting BEFORE the WSL check.
    await expect(getWslInheritedWindowsSettings()).resolves.toBeNull()
  })
})
