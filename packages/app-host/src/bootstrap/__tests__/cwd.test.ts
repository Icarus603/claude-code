import { describe, expect, test } from 'bun:test'
import { pwd, runWithCwdOverride, getCwd } from '../cwd.js'

describe('runWithCwdOverride — AsyncLocalStorage isolation', () => {
  test('inside override, pwd() returns the overridden value', () => {
    runWithCwdOverride('/tmp/override-1', () => {
      expect(pwd()).toBe('/tmp/override-1')
    })
  })

  test('outside override, pwd() returns the global cwd', () => {
    // Without an active override, pwd() falls back to getCwdState().
    // Just verify it returns something (real path string).
    expect(typeof pwd()).toBe('string')
    expect(pwd().length).toBeGreaterThan(0)
  })

  test('override is async-local — concurrent runs do NOT collide', async () => {
    // Two parallel runs with distinct cwds. Each must see only its own.
    const a = runWithCwdOverride('/tmp/a', async () => {
      await new Promise(r => setTimeout(r, 0))
      return pwd()
    })
    const b = runWithCwdOverride('/tmp/b', async () => {
      await new Promise(r => setTimeout(r, 0))
      return pwd()
    })
    const [resA, resB] = await Promise.all([a, b])
    expect(resA).toBe('/tmp/a')
    expect(resB).toBe('/tmp/b')
  })

  test('nested overrides — inner replaces outer; outer restored on exit', () => {
    runWithCwdOverride('/outer', () => {
      expect(pwd()).toBe('/outer')
      runWithCwdOverride('/inner', () => {
        expect(pwd()).toBe('/inner')
      })
      // After inner exits, outer is restored.
      expect(pwd()).toBe('/outer')
    })
  })

  test('runWithCwdOverride returns the callback return value', () => {
    expect(runWithCwdOverride('/x', () => 42)).toBe(42)
  })

  test('async callback — context survives await', async () => {
    const result = await runWithCwdOverride('/async-cwd', async () => {
      await new Promise(r => setTimeout(r, 0))
      return pwd()
    })
    expect(result).toBe('/async-cwd')
  })
})

describe('getCwd — defensive wrapper', () => {
  // NOTE: Other tests in the suite (notably packages/storage/src/__tests__/path.test.ts)
  // mock.module the cwd.js module to override getCwd. mock.module in bun:test
  // is GLOBAL across the entire test run — see
  // ~/.claude/.../memory/feedback_bun_mock_module_global_scope.md.
  //
  // We can ONLY test the inside-override path here, because that path goes
  // through pwd() (not mocked) → cwdOverrideStorage.getStore() (real).
  // The fall-through path goes through getCwdState() which a different
  // test has shadowed via mock.module — we'd assert against the mock value.

  test('returns a string (regardless of override or fallback)', () => {
    expect(typeof getCwd()).toBe('string')
    expect(getCwd().length).toBeGreaterThan(0)
  })
})
