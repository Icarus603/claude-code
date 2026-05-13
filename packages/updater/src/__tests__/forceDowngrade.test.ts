/**
 * Tests for force-downgrade helpers — port-correctness against ant
 * v2.1.136 `Lw_` (3480.js) + `UK6` (3480.js).
 *
 * The async `getMaxVersionConfig` path goes through GrowthBook (which
 * isn't mockable cleanly in bun:test). These unit tests pin the pure
 * semver-decision contract of `shouldForceDowngradeNow`, which is the
 * decision center for both AutoUpdater and the native installer.
 */
import { describe, expect, test } from 'bun:test'
import { shouldForceDowngradeNow } from '../autoUpdater.js'

describe('shouldForceDowngradeNow (ant UK6)', () => {
  test('current > target → true (downgrade fires)', () => {
    expect(shouldForceDowngradeNow('26.5.10', '26.4.5', 'auto_updater')).toBe(
      true,
    )
  })

  test('current === target → false (no downgrade needed)', () => {
    expect(shouldForceDowngradeNow('26.5.10', '26.5.10', 'auto_updater')).toBe(
      false,
    )
  })

  test('current < target → false (normal upgrade path)', () => {
    expect(shouldForceDowngradeNow('26.4.5', '26.5.10', 'auto_updater')).toBe(
      false,
    )
  })

  test('major version drop → true', () => {
    expect(shouldForceDowngradeNow('27.0.0', '26.5.0', 'auto_updater')).toBe(
      true,
    )
  })

  test('minor version drop → true', () => {
    expect(shouldForceDowngradeNow('26.5.0', '26.4.99', 'auto_updater')).toBe(
      true,
    )
  })

  test('patch version drop → true', () => {
    expect(shouldForceDowngradeNow('26.4.10', '26.4.9', 'auto_updater')).toBe(
      true,
    )
  })

  test('CalVer-style versions compare correctly', () => {
    // ccb uses v<year>.<month>.<N> calver. Verify "26.5.99 > 26.4.99"
    // (same year, later month wins).
    expect(shouldForceDowngradeNow('26.5.99', '26.4.99', 'auto_updater')).toBe(
      true,
    )
    expect(shouldForceDowngradeNow('26.4.99', '26.5.1', 'auto_updater')).toBe(
      false,
    )
  })

  test('"native_update" reason tag — same decision semantics', () => {
    expect(shouldForceDowngradeNow('26.5.10', '26.4.5', 'native_update')).toBe(
      true,
    )
    expect(shouldForceDowngradeNow('26.4.5', '26.5.10', 'native_update')).toBe(
      false,
    )
  })

  test('unparseable current version → false (ant parse returns null)', () => {
    // semver `gt()` returns false for unparseable input, matching ant
    // `parse(currentVersion)?.compare(...) ?? false`.
    expect(shouldForceDowngradeNow('not-a-version', '26.4.5', 'auto_updater')).toBe(
      false,
    )
  })

  test('unparseable target version → false', () => {
    expect(
      shouldForceDowngradeNow('26.5.10', 'not-a-version', 'auto_updater'),
    ).toBe(false)
  })

  test('build metadata is ignored by comparison (semver)', () => {
    // 26.5.10+abc1234 === 26.5.10+def5678 for ordering purposes.
    expect(
      shouldForceDowngradeNow(
        '26.5.10+abc1234',
        '26.5.10+def5678',
        'auto_updater',
      ),
    ).toBe(false)
  })

  test('prerelease tags compare per semver rules', () => {
    // 26.5.0-rc.1 < 26.5.0 → no downgrade
    expect(
      shouldForceDowngradeNow('26.5.0-rc.1', '26.5.0', 'auto_updater'),
    ).toBe(false)
    // 26.5.0 > 26.5.0-rc.1 → downgrade
    expect(
      shouldForceDowngradeNow('26.5.0', '26.5.0-rc.1', 'auto_updater'),
    ).toBe(true)
  })
})
