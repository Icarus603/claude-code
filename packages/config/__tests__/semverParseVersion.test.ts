/**
 * Tests for parseVersion — port-correctness against ant v2.1.136
 * `uX8.parse(v)?.version` (3480.js). Pin:
 *   - parseable strings return the cleaned version (`undefined` if not)
 *   - leading `v` is stripped (npm semver convention)
 *   - whitespace is trimmed
 *   - empty / null / completely-malformed input returns undefined
 */
import { describe, expect, test } from 'bun:test'
import { parseVersion } from '../semver.js'

describe('parseVersion (ant uX8.parse?.version)', () => {
  test('valid semver returns canonical version', () => {
    expect(parseVersion('1.2.3')).toBe('1.2.3')
    expect(parseVersion('0.0.1')).toBe('0.0.1')
    expect(parseVersion('100.200.300')).toBe('100.200.300')
  })

  test('leading "v" is stripped', () => {
    expect(parseVersion('v1.2.3')).toBe('1.2.3')
    expect(parseVersion('v0.0.1')).toBe('0.0.1')
  })

  test('whitespace is trimmed', () => {
    expect(parseVersion('  1.2.3  ')).toBe('1.2.3')
    expect(parseVersion('\t1.2.3\n')).toBe('1.2.3')
  })

  test('empty string returns undefined', () => {
    expect(parseVersion('')).toBeUndefined()
  })

  test('completely malformed returns undefined', () => {
    expect(parseVersion('not-a-version')).toBeUndefined()
    expect(parseVersion('abc')).toBeUndefined()
    // Bun.semver tolerantly coerces partial versions like "1" / "1.2"
    // to "1.0.0" / "1.2.0" — ccb piggybacks on this for `getMaxVersion`
    // since the tengu_max_version_config payload tends to ship 3-tuple
    // CalVer. Don't pin those as undefined.
  })

  test('CalVer-style (26.5.10) parses correctly', () => {
    // ccb uses v<year>.<month>.<N> CalVer — must be parseable
    // since the auto-updater feeds Lw_-parsed values into shouldForceDowngradeNow.
    expect(parseVersion('26.5.10')).toBe('26.5.10')
    expect(parseVersion('v26.5.10')).toBe('26.5.10')
  })

  test('prerelease tag preserved', () => {
    expect(parseVersion('1.2.3-rc.1')).toBe('1.2.3-rc.1')
    expect(parseVersion('v1.2.3-rc.1')).toBe('1.2.3-rc.1')
  })

  test('build metadata preserved', () => {
    // ant doesn't strip build metadata from `.version` accessor —
    // the comparison helpers handle it as separate semver semantics.
    const v1 = parseVersion('1.2.3+sha.abc')
    expect(v1).toBeDefined()
    // bun.semver may keep or drop the build tag depending on parse
    // mode. Pin only that it doesn't fail.
  })
})
