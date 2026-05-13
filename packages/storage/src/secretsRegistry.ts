/**
 * Secrets-redaction regex registry — ported from ant v2.1.128 yg
 * (0207.js).
 *
 * Each rule has a `confidence` field (`high` or `low`). High-confidence
 * patterns are tight enough that a match is almost certainly a real
 * secret (so they can be applied to logs without consultation). Low-
 * confidence patterns are broader regexes that may have false positives
 * — callers should use them in contexts where over-redaction is the
 * lesser evil (e.g. sending log lines to a third-party telemetry sink).
 *
 * The list is non-exhaustive on purpose: the goal is to catch the
 * patterns most likely to appear in shell output / tool results /
 * environment dumps, not to be a full secret-scanner.
 */
export type SecretConfidence = 'high' | 'low'

export type SecretPattern = {
  name: string
  re: RegExp
  confidence: SecretConfidence
}

const REGEXES: SecretPattern[] = [
  // -------------------- HIGH-CONFIDENCE --------------------
  // Anthropic API key (sk-ant-...). Tight prefix, fixed length-ish.
  {
    name: 'anthropic-api-key',
    re: /sk-ant-[a-zA-Z0-9_-]{40,}/g,
    confidence: 'high',
  },
  // OpenAI API key (sk-...). Length ≥ 40, charset alnum + dashes/underscores.
  // Doesn't conflict with sk-ant prefix above.
  {
    name: 'openai-api-key',
    re: /sk-(?!ant-)[A-Za-z0-9_-]{40,}/g,
    confidence: 'high',
  },
  // AWS access key id — fixed prefix + length.
  { name: 'aws-access-key-id', re: /AKIA[0-9A-Z]{16}/g, confidence: 'high' },
  { name: 'aws-temporary-token', re: /ASIA[0-9A-Z]{16}/g, confidence: 'high' },
  // GitHub fine-grained / classic tokens — all use ghp_/gho_/ghu_/ghs_/ghr_
  // prefixes with a fixed length.
  {
    name: 'github-token',
    re: /gh[pousr]_[A-Za-z0-9_]{36,}/g,
    confidence: 'high',
  },
  // Stripe live secret key. Test keys (sk_test_*) intentionally omitted
  // since they're not "secrets" in any threat-model sense.
  {
    name: 'stripe-live-secret',
    re: /sk_live_[A-Za-z0-9]{16,}/g,
    confidence: 'high',
  },
  // Slack bot / app / user tokens.
  {
    name: 'slack-token',
    re: /xox[baprs]-[A-Za-z0-9-]{10,}/g,
    confidence: 'high',
  },
  // Generic JWT — three base64url-ish segments separated by dots.
  {
    name: 'jwt',
    re: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,
    confidence: 'high',
  },
  // Google service-account private key (PEM header).
  {
    name: 'pem-private-key',
    re: /-----BEGIN (?:RSA |EC |DSA |OPENSSH |PGP )?PRIVATE KEY-----/g,
    confidence: 'high',
  },

  // -------------------- LOW-CONFIDENCE --------------------
  // Generic high-entropy hex strings that look like tokens — bear in
  // mind these false-match commit SHAs / hash outputs, so callers must
  // opt-in.
  {
    name: 'generic-hex-32',
    re: /\b[0-9a-f]{32}\b/g,
    confidence: 'low',
  },
  // Generic alnum tokens 40+ chars — false-matches all kinds of payloads.
  {
    name: 'generic-token-40',
    re: /\b[A-Za-z0-9_-]{40,}\b/g,
    confidence: 'low',
  },
  // Bearer auth headers — captures the whole header line so the actual
  // token portion is masked along with the prefix.
  {
    name: 'authorization-header',
    re: /Authorization:\s*Bearer\s+[A-Za-z0-9._-]+/gi,
    confidence: 'low',
  },
]

export function getSecretPatterns(
  opts: { confidence?: SecretConfidence } = {},
): SecretPattern[] {
  if (opts.confidence === undefined) return REGEXES.slice()
  return REGEXES.filter(p => p.confidence === opts.confidence)
}

/**
 * Apply the requested patterns to `text` and return the redacted form
 * (matches replaced with `[REDACTED:<name>]`). Useful for sanitizing
 * log lines before they leave the process. Returns the input unchanged
 * when no patterns match.
 */
export function redactSecrets(
  text: string,
  opts: { confidence?: SecretConfidence } = {},
): string {
  let out = text
  for (const p of getSecretPatterns(opts)) {
    out = out.replace(p.re, `[REDACTED:${p.name}]`)
  }
  return out
}
