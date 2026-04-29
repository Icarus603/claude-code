import { describe, expect, test } from 'bun:test'
import {
  getSecretLabel,
  redactSecrets,
  scanForSecrets,
} from '../teamMemSecretScanner.js'

// ─── scanForSecrets ────────────────────────────────────────────────
describe('scanForSecrets — cloud providers', () => {
  test('detects AWS access token (AKIA prefix)', () => {
    const matches = scanForSecrets('AKIAIOSFODNN7EXAMPLE')
    expect(matches.map(m => m.ruleId)).toContain('aws-access-token')
  })
  test('detects AWS access token (ASIA prefix)', () => {
    expect(
      scanForSecrets('ASIAY34FZKBOKMUTVV7A').map(m => m.ruleId),
    ).toContain('aws-access-token')
  })
  test('detects AWS access token (ABIA prefix)', () => {
    expect(
      scanForSecrets('ABIA5DFGY7QABCDEFGHI').map(m => m.ruleId),
    ).toContain('aws-access-token')
  })
  test('detects AWS access token (ACCA prefix)', () => {
    expect(
      scanForSecrets('ACCAY34FZKBOKMUTVV7A').map(m => m.ruleId),
    ).toContain('aws-access-token')
  })
  test('detects GCP API key with quote boundary', () => {
    const key = 'AIza' + 'A'.repeat(35)
    expect(scanForSecrets(`key = "${key}"`).map(m => m.ruleId)).toContain(
      'gcp-api-key',
    )
  })
  test('detects DigitalOcean PAT', () => {
    const key = 'dop_v1_' + 'a'.repeat(64)
    expect(scanForSecrets(`token: ${key}`).map(m => m.ruleId)).toContain(
      'digitalocean-pat',
    )
  })
})

describe('scanForSecrets — AI APIs', () => {
  test('detects Anthropic API key', () => {
    // Real prefix is "sk-ant-api03-"; assemble at runtime to match scanner
    const pfx = ['sk', 'ant', 'api'].join('-') + '03-'
    const key = pfx + 'A'.repeat(93) + 'AA'
    expect(scanForSecrets(`API_KEY="${key}"`).map(m => m.ruleId)).toContain(
      'anthropic-api-key',
    )
  })
  test('detects Anthropic admin API key', () => {
    const key = 'sk-ant-admin01-' + 'A'.repeat(93) + 'AA'
    expect(scanForSecrets(`KEY=${key};`).map(m => m.ruleId)).toContain(
      'anthropic-admin-api-key',
    )
  })
  test('detects OpenAI legacy key', () => {
    const key = 'sk-' + 'A'.repeat(20) + 'T3BlbkFJ' + 'B'.repeat(20)
    expect(scanForSecrets(`OPENAI="${key}"`).map(m => m.ruleId)).toContain(
      'openai-api-key',
    )
  })
  test('detects OpenAI project key', () => {
    const key = 'sk-proj-' + 'A'.repeat(74) + 'T3BlbkFJ' + 'B'.repeat(74)
    expect(scanForSecrets(`OPENAI="${key}"`).map(m => m.ruleId)).toContain(
      'openai-api-key',
    )
  })
  test('detects HuggingFace access token', () => {
    const key = 'hf_' + 'a'.repeat(34)
    expect(scanForSecrets(`HF_TOKEN="${key}"`).map(m => m.ruleId)).toContain(
      'huggingface-access-token',
    )
  })
})

describe('scanForSecrets — version control', () => {
  test('detects GitHub PAT (ghp_)', () => {
    const key = 'ghp_' + 'A'.repeat(36)
    expect(scanForSecrets(`token: ${key}`).map(m => m.ruleId)).toContain(
      'github-pat',
    )
  })
  test('detects fine-grained PAT (github_pat_)', () => {
    const key = 'github_pat_' + 'A'.repeat(82)
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain(
      'github-fine-grained-pat',
    )
  })
  test('detects GitHub OAuth (gho_)', () => {
    const key = 'gho_' + 'A'.repeat(36)
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain('github-oauth')
  })
  test('detects GitHub app token (ghu_/ghs_)', () => {
    const key = 'ghu_' + 'A'.repeat(36)
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain('github-app-token')
  })
  test('detects GitLab PAT', () => {
    const key = 'glpat-' + 'A'.repeat(20)
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain('gitlab-pat')
  })
})

describe('scanForSecrets — communication', () => {
  test('detects Slack bot token', () => {
    const key = 'xoxb-1234567890-1234567890-' + 'A'.repeat(28)
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain('slack-bot-token')
  })
  test('detects SendGrid API token', () => {
    const key = 'SG.' + 'A'.repeat(66)
    expect(scanForSecrets(`KEY="${key}"`).map(m => m.ruleId)).toContain(
      'sendgrid-api-token',
    )
  })
})

describe('scanForSecrets — dev tooling', () => {
  test('detects npm access token', () => {
    const key = 'npm_' + 'A'.repeat(36)
    expect(scanForSecrets(`TOKEN="${key}"`).map(m => m.ruleId)).toContain(
      'npm-access-token',
    )
  })
  test('detects Databricks API token', () => {
    const key = 'dapi' + 'a'.repeat(32)
    expect(scanForSecrets(`KEY="${key}"`).map(m => m.ruleId)).toContain(
      'databricks-api-token',
    )
  })
})

describe('scanForSecrets — observability', () => {
  test('detects Sentry user token', () => {
    const key = 'sntryu_' + 'a'.repeat(64)
    expect(scanForSecrets(`KEY="${key}"`).map(m => m.ruleId)).toContain(
      'sentry-user-token',
    )
  })
  test('detects Grafana cloud token', () => {
    const key = 'glc_' + 'A'.repeat(40)
    expect(scanForSecrets(`KEY="${key}"`).map(m => m.ruleId)).toContain(
      'grafana-cloud-api-token',
    )
  })
})

describe('scanForSecrets — payment', () => {
  test('detects Stripe access token', () => {
    const key = 'sk_live_' + 'A'.repeat(30)
    expect(scanForSecrets(`KEY="${key}"`).map(m => m.ruleId)).toContain(
      'stripe-access-token',
    )
  })
  test('detects Shopify access token', () => {
    const key = 'shpat_' + 'a'.repeat(32)
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain(
      'shopify-access-token',
    )
  })
})

describe('scanForSecrets — crypto', () => {
  test('detects PEM private key', () => {
    const key = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(100)}\n-----END PRIVATE KEY-----`
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain('private-key')
  })
  test('detects RSA private key', () => {
    const key = `-----BEGIN RSA PRIVATE KEY-----\n${'A'.repeat(100)}\n-----END RSA PRIVATE KEY-----`
    expect(scanForSecrets(key).map(m => m.ruleId)).toContain('private-key')
  })
})

// ─── Privacy contract ───────────────────────────────────────────────
describe('scanForSecrets — privacy contract', () => {
  test('does NOT return matched text (no `match`/`text` field)', () => {
    const key = 'ghp_' + 'A'.repeat(36)
    const matches = scanForSecrets(`token: ${key}`)
    expect(matches.length).toBeGreaterThan(0)
    for (const m of matches) {
      // SecretMatch only exposes ruleId + label — never the secret itself
      expect(Object.keys(m).sort()).toEqual(['label', 'ruleId'])
      // Sanity: the literal key bytes must not appear in any field
      expect(JSON.stringify(m)).not.toContain(key)
    }
  })
  test('deduplicates by rule ID (one match per rule even with two hits)', () => {
    const k1 = 'ghp_' + 'A'.repeat(36)
    const k2 = 'ghp_' + 'B'.repeat(36)
    const matches = scanForSecrets(`one ${k1} two ${k2}`)
    const githubHits = matches.filter(m => m.ruleId === 'github-pat')
    expect(githubHits.length).toBe(1)
  })
  test('returns empty array for clean content', () => {
    expect(scanForSecrets('no secrets here, just words')).toEqual([])
  })
  test('returns empty array for empty string', () => {
    expect(scanForSecrets('')).toEqual([])
  })
})

// ─── Negative cases (false-positive guards) ─────────────────────────
describe('scanForSecrets — false-positive guards', () => {
  test('plain "AKIA" without 16 chars does NOT match', () => {
    expect(scanForSecrets('AKIA short').map(m => m.ruleId)).not.toContain(
      'aws-access-token',
    )
  })
  test('"sk-" prefix without OpenAI body does NOT match', () => {
    expect(scanForSecrets('sk-not-real').map(m => m.ruleId)).not.toContain(
      'openai-api-key',
    )
  })
  test('"ghp_" prefix with too-short body does NOT match', () => {
    expect(scanForSecrets('ghp_short').map(m => m.ruleId)).not.toContain(
      'github-pat',
    )
  })
  test('common prose tokens (UUID-ish) do NOT match', () => {
    expect(
      scanForSecrets('id: 00000000-0000-0000-0000-000000000000'),
    ).toEqual([])
  })
})

// ─── getSecretLabel ─────────────────────────────────────────────────
describe('getSecretLabel — kebab-to-Title', () => {
  test('special-cases AWS uppercase', () => {
    expect(getSecretLabel('aws-access-token')).toBe('AWS Access Token')
  })
  test('special-cases GitHub camelCase', () => {
    expect(getSecretLabel('github-pat')).toBe('GitHub PAT')
  })
  test('special-cases OpenAI camelCase', () => {
    expect(getSecretLabel('openai-api-key')).toBe('OpenAI API Key')
  })
  test('special-cases DigitalOcean', () => {
    expect(getSecretLabel('digitalocean-pat')).toBe('DigitalOcean PAT')
  })
  test('special-cases HuggingFace', () => {
    expect(getSecretLabel('huggingface-access-token')).toBe(
      'HuggingFace Access Token',
    )
  })
  test('falls back to capitalize for unknown segments', () => {
    expect(getSecretLabel('made-up-rule')).toBe('Made Up Rule')
  })
  test('handles single-word IDs', () => {
    expect(getSecretLabel('foo')).toBe('Foo')
  })
  test('PyPI special case', () => {
    expect(getSecretLabel('pypi-upload-token')).toBe('PyPI Upload Token')
  })
})

// ─── redactSecrets ──────────────────────────────────────────────────
describe('redactSecrets', () => {
  test('replaces secret with [REDACTED]', () => {
    const key = 'ghp_' + 'A'.repeat(36)
    expect(redactSecrets(`token: ${key}`)).toBe('token: [REDACTED]')
  })
  test('preserves boundary chars (quote / semicolon) outside the captured group', () => {
    const key = 'npm_' + 'A'.repeat(36)
    const input = `TOKEN="${key}";`
    const out = redactSecrets(input)
    // Boundary chars survive — only the secret body is redacted
    expect(out).toContain('"')
    expect(out).toContain(';')
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain(key)
  })
  test('redacts multiple distinct secrets in one string', () => {
    const k1 = 'ghp_' + 'A'.repeat(36)
    const k2 = 'gho_' + 'B'.repeat(36)
    const out = redactSecrets(`a ${k1} b ${k2}`)
    expect(out).not.toContain(k1)
    expect(out).not.toContain(k2)
    expect((out.match(/\[REDACTED\]/g) ?? []).length).toBe(2)
  })
  test('redacts repeated occurrences (g flag)', () => {
    const key = 'ghp_' + 'A'.repeat(36)
    const out = redactSecrets(`${key} and ${key}`)
    expect(out).toBe('[REDACTED] and [REDACTED]')
  })
  test('no-op for clean content', () => {
    expect(redactSecrets('hello world')).toBe('hello world')
  })
  test('redacts PEM private key block', () => {
    const key = `-----BEGIN PRIVATE KEY-----\n${'A'.repeat(100)}\n-----END PRIVATE KEY-----`
    const out = redactSecrets(`before ${key} after`)
    expect(out).toContain('[REDACTED]')
    expect(out).not.toContain('A'.repeat(100))
  })
  test('redacts AWS key without capture group (uses full match)', () => {
    // aws-access-token has a capture group; the boundary-survival rule still applies
    const key = 'AKIAIOSFODNN7EXAMPLE'
    expect(redactSecrets(`KEY=${key}`)).toContain('[REDACTED]')
  })
})
