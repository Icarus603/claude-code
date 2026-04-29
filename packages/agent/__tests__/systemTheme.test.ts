import { beforeEach, describe, expect, mock, test } from 'bun:test'

const realEnvUtils = await import('@claude-code/config/env/utils')
const envOverrides = new Map<string, string>()

mock.module('@claude-code/config/env/utils', () => ({
  ...realEnvUtils,
  readEnv: (key: string) => envOverrides.get(key) ?? '',
}))

// Cache busts on module load. Re-import each test to reset the
// module-level cachedSystemTheme.
async function freshResolveThemeSetting() {
  // Use cache-busting query string so Bun re-imports.
  const mod = await import(
    '../internal/systemTheme.js?bust=' + Math.random()
  )
  return mod.resolveThemeSetting as (s: string) => string
}

beforeEach(() => {
  envOverrides.clear()
})

describe('resolveThemeSetting — explicit settings', () => {
  test('"dark" → "dark" (passes through)', async () => {
    const fn = await freshResolveThemeSetting()
    expect(fn('dark')).toBe('dark')
  })

  test('"light" → "light"', async () => {
    const fn = await freshResolveThemeSetting()
    expect(fn('light')).toBe('light')
  })

  test('"high-contrast" (custom theme name) → passes through', async () => {
    // Contract: only "auto" triggers detection. Any other string is
    // returned as-is so callers can supply custom theme names.
    const fn = await freshResolveThemeSetting()
    expect(fn('high-contrast')).toBe('high-contrast')
  })

  test('empty string passes through (it is not "auto")', async () => {
    const fn = await freshResolveThemeSetting()
    expect(fn('')).toBe('')
  })

  test('"AUTO" (uppercase) does NOT trigger detection — case-sensitive', async () => {
    // The check is `setting === 'auto'`, exact lowercase. A future
    // refactor that adds .toLowerCase() would silently change behavior.
    const fn = await freshResolveThemeSetting()
    expect(fn('AUTO')).toBe('AUTO')
  })
})

describe('resolveThemeSetting — auto detection', () => {
  test('auto + no COLORFGBG → defaults to "dark"', async () => {
    envOverrides.clear()
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG bg=0 (black) → "dark"', async () => {
    envOverrides.set('COLORFGBG', '15;0')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG bg=6 (cyan, low) → "dark" (≤6 = dark)', async () => {
    envOverrides.set('COLORFGBG', '15;6')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG bg=7 (light gray) → "light" (>6 except 8)', async () => {
    envOverrides.set('COLORFGBG', '0;7')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('light')
  })

  test('auto + COLORFGBG bg=8 (dark gray) → "dark" (special-cased)', async () => {
    // Critical contract: 8 is "bright black" / "dark gray", which
    // visually IS a dark background. The rule is "≤6 OR ==8 → dark".
    envOverrides.set('COLORFGBG', '15;8')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG bg=15 (white) → "light"', async () => {
    envOverrides.set('COLORFGBG', '0;15')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('light')
  })

  test('auto + COLORFGBG bg=9 (bright red) → "light" (9-14 are bright fg colors)', async () => {
    envOverrides.set('COLORFGBG', '0;9')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('light')
  })

  test('auto + COLORFGBG with 3 parts uses LAST as bg', async () => {
    // Some terminals emit "fg;mid;bg". The function uses
    // parts[parts.length - 1] which handles this correctly.
    envOverrides.set('COLORFGBG', '15;default;0')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG empty string → defaults to "dark"', async () => {
    envOverrides.set('COLORFGBG', '')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG bg=non-integer → defaults to "dark"', async () => {
    envOverrides.set('COLORFGBG', '15;default')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG bg=-1 → defaults to "dark" (out of range)', async () => {
    envOverrides.set('COLORFGBG', '15;-1')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })

  test('auto + COLORFGBG bg=16 → defaults to "dark" (out of range)', async () => {
    envOverrides.set('COLORFGBG', '0;16')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
  })
})

describe('resolveThemeSetting — caching', () => {
  test('detection result is cached within a single module instance', async () => {
    envOverrides.set('COLORFGBG', '15;0')
    const fn = await freshResolveThemeSetting()
    expect(fn('auto')).toBe('dark')
    // Even if env changes after first call, cached value persists.
    envOverrides.set('COLORFGBG', '0;15')
    expect(fn('auto')).toBe('dark') // still cached as dark
  })
})
