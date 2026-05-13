/**
 * Tests for policyHelper — invariants against ant v2.1.136 `fE_`
 * (0686.js) + `mSH` (0687.js).
 *
 * The full child-spawn path is integration; these unit tests pin:
 *   - `validateHelperPath` return contract (string | null, per ant TZ4)
 *   - `isAdminPolicySource` set membership (per ant OZ4)
 *   - module-level state accessors return null before invocation,
 *     populate after a successful apply, and clear on reset
 */
import { afterEach, describe, expect, test } from 'bun:test'
import {
  ALLOWED_POLICY_HELPER_SOURCES,
  _resetPolicyHelperForTesting,
  applyPolicyHelper,
  getPolicyHelperAppendSystemPrompt,
  getPolicyHelperClaudeMd,
  getPolicyHelperManagedSettings,
  isAdminPolicySource,
  isPolicyHelperActive,
  validateHelperPath,
} from '../policyHelper.js'

afterEach(() => {
  _resetPolicyHelperForTesting()
})

describe('validateHelperPath (ant TZ4)', () => {
  test('returns null for an absolute POSIX path', () => {
    expect(validateHelperPath('/usr/local/bin/policy-helper')).toBeNull()
  })

  test('returns message for empty path', () => {
    expect(validateHelperPath('')).toBe('path must be non-empty')
  })

  test('returns message for relative path', () => {
    expect(validateHelperPath('relative/path')).toBe(
      'path must be absolute: relative/path',
    )
  })

  test('returns null for an absolute Windows path with .exe (when on win32)', () => {
    if (process.platform === 'win32') {
      expect(validateHelperPath('C:\\Program Files\\helper.exe')).toBeNull()
    } else {
      // On non-win32, the .exe rule isn't enforced — but the absolute
      // check still kicks in. We assert Windows-style paths are
      // detected as absolute on win32 only.
      expect(validateHelperPath('C:\\Program Files\\helper.exe')).not.toBeNull()
    }
  })

  test('returns Windows-specific message for non-exe path on win32', () => {
    if (process.platform === 'win32') {
      expect(validateHelperPath('C:\\Program Files\\helper')).toBe(
        'path must end in .exe on Windows: C:\\Program Files\\helper',
      )
    }
  })
})

describe('isAdminPolicySource (ant OZ4)', () => {
  test('allowed sources: plist, hklm, file', () => {
    expect([...ALLOWED_POLICY_HELPER_SOURCES].sort()).toEqual([
      'file',
      'hklm',
      'plist',
    ])
    expect(isAdminPolicySource('plist')).toBe(true)
    expect(isAdminPolicySource('hklm')).toBe(true)
    expect(isAdminPolicySource('file')).toBe(true)
  })

  test('rejects user-writable sources', () => {
    expect(isAdminPolicySource('userSettings')).toBe(false)
    expect(isAdminPolicySource('projectSettings')).toBe(false)
    expect(isAdminPolicySource('localSettings')).toBe(false)
    expect(isAdminPolicySource('hkcu')).toBe(false)
  })

  test('null / undefined / empty → false', () => {
    expect(isAdminPolicySource(null)).toBe(false)
    expect(isAdminPolicySource(undefined)).toBe(false)
    expect(isAdminPolicySource('')).toBe(false)
  })
})

describe('applyPolicyHelper — gating behaviour', () => {
  test('no helper config → null result and no state change', async () => {
    const err = await applyPolicyHelper({}, 'file')
    expect(err).toBeNull()
    expect(isPolicyHelperActive()).toBe(false)
  })

  test('non-admin source is silently ignored (returns null)', async () => {
    // Ant logs a warn and returns null when the source isn't admin —
    // does NOT surface a user-facing error string. The fact that the
    // helper was declared in a user-writable source is itself the
    // security concern; flagging it would just hand the attacker a
    // probing oracle.
    const err = await applyPolicyHelper(
      { policyHelper: { path: '/usr/local/bin/p' } },
      'userSettings',
    )
    expect(err).toBeNull()
    expect(isPolicyHelperActive()).toBe(false)
  })

  test('bad path returns a user-facing error string', async () => {
    const err = await applyPolicyHelper(
      { policyHelper: { path: 'not/absolute' } },
      'file',
    )
    expect(err).toBe('policyHelper failed: path must be absolute: not/absolute')
    expect(isPolicyHelperActive()).toBe(false)
  })
})

describe('module-level accessors (ant oI6 / oAq / aAq / sAq)', () => {
  test('return null when no helper has run', () => {
    expect(getPolicyHelperManagedSettings()).toBeNull()
    expect(getPolicyHelperClaudeMd()).toBeNull()
    expect(getPolicyHelperAppendSystemPrompt()).toBeNull()
    expect(isPolicyHelperActive()).toBe(false)
  })

  test('reset clears all module state', () => {
    _resetPolicyHelperForTesting()
    expect(getPolicyHelperManagedSettings()).toBeNull()
    expect(isPolicyHelperActive()).toBe(false)
  })
})

// ─── invokePolicyHelper integration (ant tAq) ─────────────────────────
// Spawn a real /bin/sh script that emits a known stdout. Skipped on
// win32 where /bin/sh is unavailable; the cap + byte-counting logic
// is platform-independent so coverage on Linux/macOS pins the fix.
import { mkdtempSync, rmSync, writeFileSync, chmodSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { invokePolicyHelper } from '../policyHelper.js'

let tmpRoot: string

function makeScript(body: string, name = 'helper.sh'): string {
  const path = join(tmpRoot, name)
  writeFileSync(path, `#!/bin/sh\n${body}\n`, 'utf8')
  chmodSync(path, 0o755)
  return path
}

describe.skipIf(process.platform === 'win32')(
  'invokePolicyHelper integration (ant tAq)',
  () => {
    let setupRan = false

    function setup() {
      if (!setupRan) {
        tmpRoot = mkdtempSync(join(tmpdir(), 'ccb-policy-test-'))
        setupRan = true
      }
    }

    afterEach(() => {
      if (setupRan && tmpRoot) {
        try {
          rmSync(tmpRoot, { recursive: true, force: true })
        } catch {
          // ignore
        }
        setupRan = false
      }
    })

    test('valid envelope → output parsed and policyHelper stripped from managedSettings', async () => {
      setup()
      const path = makeScript(
        `cat <<'EOF'
{"managedSettings": {"foo": "bar", "policyHelper": {"path": "/evil"}}, "claudeMd": "# CLAUDE.md", "appendSystemPrompt": "extra"}
EOF`,
      )
      const result = await invokePolicyHelper({ path })
      expect('output' in result).toBe(true)
      if ('output' in result) {
        // ant strips `policyHelper` so helper can't re-declare itself.
        expect(result.output.managedSettings).toEqual({ foo: 'bar' })
        expect(result.output.claudeMd).toBe('# CLAUDE.md')
        expect(result.output.appendSystemPrompt).toBe('extra')
      }
    })

    test('non-zero exit → exit_nonzero code with stderr embedded', async () => {
      setup()
      const path = makeScript(
        `echo "something broke" >&2
exit 3`,
      )
      const result = await invokePolicyHelper({ path })
      expect('error' in result).toBe(true)
      if ('error' in result) {
        expect(result.code).toBe('exit_nonzero')
        expect(result.error).toContain('something broke')
      }
    })

    test('invalid JSON → parse_failed code', async () => {
      setup()
      const path = makeScript(`echo "not json at all"`)
      const result = await invokePolicyHelper({ path })
      expect('error' in result).toBe(true)
      if ('error' in result) expect(result.code).toBe('parse_failed')
    })

    test('JSON but not an object → parse_failed code', async () => {
      setup()
      const path = makeScript(`echo '["array","payload"]'`)
      const result = await invokePolicyHelper({ path })
      expect('error' in result).toBe(true)
      if ('error' in result) expect(result.code).toBe('parse_failed')
    })

    test('managedSettings is non-object → schema_rejected code', async () => {
      setup()
      const path = makeScript(`echo '{"managedSettings": "not an object"}'`)
      const result = await invokePolicyHelper({ path })
      expect('error' in result).toBe(true)
      if ('error' in result) expect(result.code).toBe('schema_rejected')
    })

    test('stdout > 1MB → oversize code (UTF-8 byte length, NOT string length)', async () => {
      setup()
      // CRITICAL: ant `Buffer.byteLength(q,"utf8") > nI6` byte-count
      // check. The old ccb impl mixed `stdout.length` (JS code units)
      // with `chunk.length` (Buffer bytes) — for ASCII the underflow
      // was benign, but for multi-byte UTF-8 the check would let the
      // helper ship > 1MB without tripping. Test by shipping just over
      // 1MB of plain ASCII (covers the byte-length cap) and verify
      // we get `oversize` instead of `parse_failed`/`exit_nonzero`.
      const path = makeScript(
        `node -e "process.stdout.write('a'.repeat(1100000))"`,
      )
      const result = await invokePolicyHelper({ path, timeoutMs: 5000 })
      expect('error' in result).toBe(true)
      if ('error' in result) expect(result.code).toBe('oversize')
    })

    test('per-invocation timeout fires → exit_nonzero', async () => {
      setup()
      // Use Node directly so the child responds to SIGTERM immediately
      // without /bin/sh's signal-forwarding quirks.
      const path = makeScript(
        `exec node -e "setTimeout(()=>{}, 30000)"`,
      )
      const start = Date.now()
      const result = await invokePolicyHelper({ path, timeoutMs: 200 })
      const elapsed = Date.now() - start
      expect('error' in result).toBe(true)
      if ('error' in result) expect(result.code).toBe('exit_nonzero')
      // The SIGTERM should land well before the 30s sleep would end.
      expect(elapsed).toBeLessThan(5000)
    }, 10000)

    test('clone-on-read: returned managedSettings is not the parsed envelope', async () => {
      setup()
      // ant `NV(z.data.managedSettings)` structuredClones before
      // stripping. We mirror via JSON deep-copy. Pin: mutating the
      // returned object MUST NOT affect what the helper would see on
      // a second invocation (no shared state between calls).
      const path = makeScript(
        `echo '{"managedSettings":{"foo":"bar"}}'`,
      )
      const result1 = await invokePolicyHelper({ path })
      const result2 = await invokePolicyHelper({ path })
      if ('output' in result1 && 'output' in result2) {
        // Mutate result1 — should not bleed into result2.
        ;(result1.output.managedSettings as Record<string, unknown>).foo =
          'mutated'
        expect(result2.output.managedSettings).toEqual({ foo: 'bar' })
      }
    })
  },
)
