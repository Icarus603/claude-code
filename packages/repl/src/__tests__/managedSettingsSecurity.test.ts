/**
 * Tests for ManagedSettingsSecurityDialog/utils.ts pure helpers —
 * security-critical settings inspector that gates the trust dialog
 * for remotely-pushed settings.json updates.
 *
 * Wrong detection = either:
 *   - Missed dangerous setting: silent privilege grant (e.g. statusLine
 *     shell command runs unchecked on next session start)
 *   - Spurious flag: trust dialog spam, training users to click Trust
 *
 * The SAFE_ENV_VARS allowlist is "deny by default" — any env var NOT
 * listed is treated as dangerous. Tests lock both the explicit
 * dangerous classes (apiKeyHelper, statusLine, hooks) AND the
 * allowlist semantics (lowercase → uppercase normalization).
 */
import { describe, expect, test } from 'bun:test'
import {
  extractDangerousSettings,
  formatDangerousSettingsList,
  hasDangerousSettings,
  hasDangerousSettingsChanged,
} from '../components/ManagedSettingsSecurityDialog/utils.js'
import type { SettingsJson } from '@claude-code/config/types'

describe('extractDangerousSettings — empty / null', () => {
  test('null settings → all empty', () => {
    expect(extractDangerousSettings(null)).toEqual({
      shellSettings: {},
      envVars: {},
      hasHooks: false,
    })
  })

  test('undefined settings → all empty', () => {
    expect(extractDangerousSettings(undefined)).toEqual({
      shellSettings: {},
      envVars: {},
      hasHooks: false,
    })
  })

  test('empty settings object → all empty', () => {
    expect(extractDangerousSettings({})).toEqual({
      shellSettings: {},
      envVars: {},
      hasHooks: false,
    })
  })
})

describe('extractDangerousSettings — shell settings (always dangerous)', () => {
  test('apiKeyHelper extracted', () => {
    const result = extractDangerousSettings({
      apiKeyHelper: '/path/to/script.sh',
    } as SettingsJson)
    expect(result.shellSettings.apiKeyHelper).toBe('/path/to/script.sh')
  })

  test('statusLine extracted', () => {
    const result = extractDangerousSettings({
      statusLine: 'echo $USER',
    } as SettingsJson)
    expect(result.shellSettings.statusLine).toBe('echo $USER')
  })

  test('all 6 dangerous shell settings extracted', () => {
    const result = extractDangerousSettings({
      apiKeyHelper: 'a',
      awsAuthRefresh: 'b',
      awsCredentialExport: 'c',
      gcpAuthRefresh: 'd',
      otelHeadersHelper: 'e',
      statusLine: 'f',
    } as SettingsJson)
    expect(Object.keys(result.shellSettings).sort()).toEqual([
      'apiKeyHelper',
      'awsAuthRefresh',
      'awsCredentialExport',
      'gcpAuthRefresh',
      'otelHeadersHelper',
      'statusLine',
    ])
  })

  test('empty string shell setting is NOT extracted', () => {
    const result = extractDangerousSettings({
      apiKeyHelper: '',
    } as SettingsJson)
    expect(result.shellSettings).toEqual({})
  })

  test('non-string shell setting is NOT extracted', () => {
    const result = extractDangerousSettings({
      apiKeyHelper: 123 as unknown as string,
    } as SettingsJson)
    expect(result.shellSettings).toEqual({})
  })
})

describe('extractDangerousSettings — env vars (deny by default)', () => {
  test('safe env var (in SAFE_ENV_VARS) is NOT flagged', () => {
    const result = extractDangerousSettings({
      env: { CLAUDE_CODE_USE_BEDROCK: '1' },
    } as SettingsJson)
    expect(result.envVars).toEqual({})
  })

  test('unknown env var IS flagged', () => {
    const result = extractDangerousSettings({
      env: { ANTHROPIC_BASE_URL: 'https://evil.example.com' },
    } as SettingsJson)
    expect(result.envVars.ANTHROPIC_BASE_URL).toBe('https://evil.example.com')
  })

  test('http_proxy / HTTP_PROXY → flagged (case-insensitive normalize to upper)', () => {
    const result = extractDangerousSettings({
      env: { http_proxy: 'http://attacker.example.com' },
    } as SettingsJson)
    expect(result.envVars.http_proxy).toBe('http://attacker.example.com')
  })

  test('NODE_TLS_REJECT_UNAUTHORIZED → flagged', () => {
    const result = extractDangerousSettings({
      env: { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
    } as SettingsJson)
    expect(result.envVars.NODE_TLS_REJECT_UNAUTHORIZED).toBe('0')
  })

  test('mixed safe + dangerous: only dangerous flagged', () => {
    const result = extractDangerousSettings({
      env: {
        CLAUDE_CODE_USE_BEDROCK: '1', // safe
        ANTHROPIC_BASE_URL: 'evil', // dangerous
      },
    } as SettingsJson)
    expect(result.envVars).toEqual({ ANTHROPIC_BASE_URL: 'evil' })
  })

  test('empty string env var NOT flagged', () => {
    const result = extractDangerousSettings({
      env: { ANTHROPIC_BASE_URL: '' },
    } as SettingsJson)
    expect(result.envVars).toEqual({})
  })

  test('env vars are matched case-insensitively against allowlist', () => {
    // The allowlist check is `.toUpperCase()` — so 'claude_code_use_bedrock'
    // (lowercase) should still match the safe list.
    const result = extractDangerousSettings({
      env: { claude_code_use_bedrock: '1' },
    } as SettingsJson)
    expect(result.envVars).toEqual({})
  })
})

describe('extractDangerousSettings — hooks', () => {
  test('hooks present (non-empty) → hasHooks=true', () => {
    const result = extractDangerousSettings({
      hooks: { PreToolUse: [{ matcher: 'Bash' }] },
    } as SettingsJson)
    expect(result.hasHooks).toBe(true)
    expect(result.hooks).toBeDefined()
  })

  test('empty hooks object → hasHooks=false', () => {
    const result = extractDangerousSettings({
      hooks: {},
    } as SettingsJson)
    expect(result.hasHooks).toBe(false)
    expect(result.hooks).toBeUndefined()
  })

  test('null hooks → hasHooks=false', () => {
    const result = extractDangerousSettings({
      hooks: null,
    } as SettingsJson)
    expect(result.hasHooks).toBe(false)
  })

  test('hooks as non-object (string) → hasHooks=false', () => {
    const result = extractDangerousSettings({
      hooks: 'a string' as unknown as object,
    } as SettingsJson)
    expect(result.hasHooks).toBe(false)
  })
})

describe('hasDangerousSettings', () => {
  test('all empty → false', () => {
    expect(
      hasDangerousSettings({
        shellSettings: {},
        envVars: {},
        hasHooks: false,
      }),
    ).toBe(false)
  })

  test('shell settings present → true', () => {
    expect(
      hasDangerousSettings({
        shellSettings: { apiKeyHelper: 'x' },
        envVars: {},
        hasHooks: false,
      }),
    ).toBe(true)
  })

  test('env vars present → true', () => {
    expect(
      hasDangerousSettings({
        shellSettings: {},
        envVars: { EVIL: '1' },
        hasHooks: false,
      }),
    ).toBe(true)
  })

  test('hooks present → true', () => {
    expect(
      hasDangerousSettings({
        shellSettings: {},
        envVars: {},
        hasHooks: true,
      }),
    ).toBe(true)
  })
})

describe('hasDangerousSettingsChanged', () => {
  test('new settings clean → false (no prompt needed)', () => {
    expect(
      hasDangerousSettingsChanged(
        { apiKeyHelper: 'old' } as SettingsJson,
        {} as SettingsJson,
      ),
    ).toBe(false)
  })

  test('old empty + new dangerous → true', () => {
    expect(
      hasDangerousSettingsChanged(
        {} as SettingsJson,
        { apiKeyHelper: 'new' } as SettingsJson,
      ),
    ).toBe(true)
  })

  test('same dangerous setting in both → false (no change)', () => {
    expect(
      hasDangerousSettingsChanged(
        { apiKeyHelper: 'same' } as SettingsJson,
        { apiKeyHelper: 'same' } as SettingsJson,
      ),
    ).toBe(false)
  })

  test('changed dangerous shell setting value → true', () => {
    expect(
      hasDangerousSettingsChanged(
        { apiKeyHelper: 'old' } as SettingsJson,
        { apiKeyHelper: 'new' } as SettingsJson,
      ),
    ).toBe(true)
  })

  test('added new dangerous env var → true', () => {
    expect(
      hasDangerousSettingsChanged(
        { apiKeyHelper: 'x' } as SettingsJson,
        {
          apiKeyHelper: 'x',
          env: { ANTHROPIC_BASE_URL: 'evil' },
        } as SettingsJson,
      ),
    ).toBe(true)
  })

  test('null/undefined inputs handled', () => {
    expect(hasDangerousSettingsChanged(null, null)).toBe(false)
    expect(hasDangerousSettingsChanged(undefined, undefined)).toBe(false)
    expect(hasDangerousSettingsChanged(null, { apiKeyHelper: 'x' } as SettingsJson)).toBe(true)
  })
})

describe('formatDangerousSettingsList', () => {
  test('empty → empty list', () => {
    expect(
      formatDangerousSettingsList({
        shellSettings: {},
        envVars: {},
        hasHooks: false,
      }),
    ).toEqual([])
  })

  test('returns names only, NOT values (no leak)', () => {
    const result = formatDangerousSettingsList({
      shellSettings: { apiKeyHelper: '/secret/path' },
      envVars: { ANTHROPIC_BASE_URL: 'https://leaked.example.com' },
      hasHooks: false,
    })
    expect(result).toContain('apiKeyHelper')
    expect(result).toContain('ANTHROPIC_BASE_URL')
    // Must NOT contain values.
    expect(result.some(s => s.includes('/secret/path'))).toBe(false)
    expect(result.some(s => s.includes('leaked.example.com'))).toBe(false)
  })

  test('hooks listed as "hooks"', () => {
    const result = formatDangerousSettingsList({
      shellSettings: {},
      envVars: {},
      hasHooks: true,
    })
    expect(result).toEqual(['hooks'])
  })

  test('combines shell + env + hooks in a single list', () => {
    const result = formatDangerousSettingsList({
      shellSettings: { apiKeyHelper: 'x', statusLine: 'y' },
      envVars: { EVIL: 'z' },
      hasHooks: true,
    })
    expect(result.length).toBe(4)
    expect(result).toContain('apiKeyHelper')
    expect(result).toContain('statusLine')
    expect(result).toContain('EVIL')
    expect(result).toContain('hooks')
  })
})
