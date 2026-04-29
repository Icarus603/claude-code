import { describe, expect, test } from 'bun:test'
import { sanitizeInboundWebhookContent } from '../webhookSanitizer.js'

describe('sanitizeInboundWebhookContent — pass-through', () => {
  test('empty string', () => {
    expect(sanitizeInboundWebhookContent('')).toBe('')
  })
  test('plain prose unchanged', () => {
    expect(sanitizeInboundWebhookContent('hello world')).toBe('hello world')
  })
  test('PR description without secrets', () => {
    const text = '## Summary\nFixes a typo in the README.\n\n## Test plan\n- ran tests'
    expect(sanitizeInboundWebhookContent(text)).toBe(text)
  })
})

describe('sanitizeInboundWebhookContent — token redaction', () => {
  test('GitHub PAT', () => {
    const out = sanitizeInboundWebhookContent('token: ghp_' + 'A'.repeat(36))
    expect(out).toContain('[REDACTED_GITHUB_TOKEN]')
    expect(out).not.toContain('ghp_AAAA')
  })
  test('GitHub fine-grained PAT', () => {
    const out = sanitizeInboundWebhookContent('github_pat_' + 'A'.repeat(40))
    expect(out).toContain('[REDACTED_GITHUB_TOKEN]')
  })
  test('GitHub OAuth (gho_)', () => {
    expect(
      sanitizeInboundWebhookContent('gho_' + 'A'.repeat(36)),
    ).toContain('[REDACTED_GITHUB_TOKEN]')
  })
  test('Anthropic API key', () => {
    const out = sanitizeInboundWebhookContent(
      'API: sk-ant-' + 'A'.repeat(50),
    )
    expect(out).toContain('[REDACTED_ANTHROPIC_KEY]')
  })
  test('Bearer token in Authorization header', () => {
    const text = 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig'
    expect(sanitizeInboundWebhookContent(text)).toContain(
      '[REDACTED_TOKEN]',
    )
  })
  test('AWS access key (AKIA prefix)', () => {
    expect(
      sanitizeInboundWebhookContent('AKIAIOSFODNN7EXAMPLE'),
    ).toContain('[REDACTED_AWS_KEY]')
  })
  test('npm access token', () => {
    const out = sanitizeInboundWebhookContent('npm_' + 'A'.repeat(36))
    expect(out).toContain('[REDACTED_NPM_TOKEN]')
  })
  test('Slack bot token', () => {
    const out = sanitizeInboundWebhookContent(
      'xox-REDACTED-FIXTURE',
    )
    expect(out).toContain('[REDACTED_SLACK_TOKEN]')
  })
  test('generic api_key=VALUE', () => {
    const out = sanitizeInboundWebhookContent('api_key=AbCdEfGhIjKlMnOpQrSt')
    expect(out).toContain('[REDACTED]')
  })
  test('multiple secrets in one payload', () => {
    const text =
      'pr title\n' +
      'token: ghp_' + 'A'.repeat(36) + '\n' +
      'aws: AKIAIOSFODNN7EXAMPLE\n'
    const out = sanitizeInboundWebhookContent(text)
    expect(out).toContain('[REDACTED_GITHUB_TOKEN]')
    expect(out).toContain('[REDACTED_AWS_KEY]')
  })
})

describe('sanitizeInboundWebhookContent — truncation', () => {
  test('truncates content over 100KB', () => {
    const huge = 'x'.repeat(101_000)
    const out = sanitizeInboundWebhookContent(huge)
    expect(out.length).toBeLessThanOrEqual(100_000 + 50) // truncation marker length
    expect(out).toContain('[truncated]')
  })
  test('content at exactly 100KB is NOT truncated', () => {
    const exact = 'x'.repeat(100_000)
    const out = sanitizeInboundWebhookContent(exact)
    expect(out).toBe(exact)
  })
  test('truncation happens AFTER redaction (so secrets at end still redacted)', () => {
    // Generate 90KB of plain text + a secret near the truncation boundary
    const filler = 'x'.repeat(90_000)
    const secret = 'ghp_' + 'A'.repeat(36)
    const moreFiller = 'y'.repeat(20_000)
    const text = filler + ' ' + secret + ' ' + moreFiller
    const out = sanitizeInboundWebhookContent(text)
    expect(out).toContain('[REDACTED_GITHUB_TOKEN]')
    expect(out).not.toContain(secret)
  })
})

describe('sanitizeInboundWebhookContent — never throws', () => {
  test('handles unicode content', () => {
    expect(() =>
      sanitizeInboundWebhookContent('中文 emoji 🎉 mixed'),
    ).not.toThrow()
  })
  test('idempotent — sanitizing twice gives same result', () => {
    const text = 'token: ghp_' + 'A'.repeat(36) + ' end'
    const once = sanitizeInboundWebhookContent(text)
    const twice = sanitizeInboundWebhookContent(once)
    expect(once).toBe(twice)
  })
})
