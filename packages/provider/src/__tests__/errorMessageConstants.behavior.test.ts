import { describe, expect, test } from 'bun:test'

import {
  API_ERROR_MESSAGE_PREFIX,
  API_TIMEOUT_ERROR_MESSAGE,
  CCR_AUTH_ERROR_MESSAGE,
  CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE,
  CUSTOM_OFF_SWITCH_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE,
  INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL,
  OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE,
  ORG_DISABLED_ERROR_MESSAGE_ENV_KEY,
  ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  REPEATED_529_ERROR_MESSAGE,
  TOKEN_REVOKED_ERROR_MESSAGE,
  isPromptTooLongMessage,
  startsWithApiErrorPrefix,
} from '../errors.ts'

/**
 * Pin user-facing error message constants. These strings are matched by
 * downstream UI logic (REPL renderer, /status display) to:
 *  - Route specific errors to specific UI affordances (login link, /model
 *    switch hint, credit-purchase CTA)
 *  - Suppress dialog re-display when the error is already shown elsewhere
 *  - Trigger automatic recovery flows (CCR retry, /login on token revoked)
 *
 * A string drift here breaks the routing: the UI sees a generic error and
 * loses the actionable affordance. Pin the EXACT format that downstream
 * code matches against.
 */
describe('User-facing error message constants', () => {
  test('API_ERROR_MESSAGE_PREFIX is the bare "API Error" (used by startsWithApiErrorPrefix)', () => {
    expect(API_ERROR_MESSAGE_PREFIX).toBe('API Error')
    expect(startsWithApiErrorPrefix('API Error: 500')).toBe(true)
    expect(startsWithApiErrorPrefix('Error: 500')).toBe(false)
  })

  test('PROMPT_TOO_LONG_ERROR_MESSAGE = "Prompt is too long" (server-error literal)', () => {
    // This is server-side wording — must match what the API returns.
    // Wrong text → isPromptTooLongMessage fails to detect and the
    // "auto-compact next turn" recovery path doesn't trigger.
    expect(PROMPT_TOO_LONG_ERROR_MESSAGE).toBe('Prompt is too long')
  })

  test('CREDIT_BALANCE_TOO_LOW: triggers /buy_credits link in REPL', () => {
    expect(CREDIT_BALANCE_TOO_LOW_ERROR_MESSAGE).toBe('Credit balance is too low')
  })

  test('INVALID_API_KEY_ERROR_MESSAGE: includes /login CTA', () => {
    expect(INVALID_API_KEY_ERROR_MESSAGE).toBe('Not logged in · Please run /login')
  })

  test('INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL: different CTA for env-supplied keys', () => {
    expect(INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL).toBe('Invalid API key · Fix external API key')
  })

  test('ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH: dual hint when subscription available', () => {
    // The "Unset the environment variable to use your subscription instead"
    // hint only fires when the user actually has an OAuth subscription to
    // fall back to. Pin so the wording stays subscription-aware.
    expect(ORG_DISABLED_ERROR_MESSAGE_ENV_KEY_WITH_OAUTH).toContain(
      'Unset the environment variable to use your subscription instead',
    )
  })

  test('ORG_DISABLED_ERROR_MESSAGE_ENV_KEY: bare hint when no OAuth available', () => {
    expect(ORG_DISABLED_ERROR_MESSAGE_ENV_KEY).toContain('Update or unset the environment variable')
  })

  test('TOKEN_REVOKED_ERROR_MESSAGE: /login CTA for OAuth token revocation', () => {
    expect(TOKEN_REVOKED_ERROR_MESSAGE).toBe('OAuth token revoked · Please run /login')
  })

  test('CCR_AUTH_ERROR_MESSAGE: "transient" wording (signals retry not /login)', () => {
    // For CCR-injected tokens, "please run /login" is wrong because the
    // user can't /login in a CCR session — the host injects credentials.
    // Pin the "may be temporary, try again" wording so the UI doesn't
    // show a /login button for these errors.
    expect(CCR_AUTH_ERROR_MESSAGE).toContain('temporary network issue')
    expect(CCR_AUTH_ERROR_MESSAGE).not.toContain('/login')
  })

  test('REPEATED_529_ERROR_MESSAGE: pinned for retry-loop give-up message', () => {
    expect(REPEATED_529_ERROR_MESSAGE).toBe('Repeated 529 Overloaded errors')
  })

  test('CUSTOM_OFF_SWITCH_MESSAGE: model-switch hint via /model', () => {
    // Triggered when Opus is gated by Anthropic's "off switch" flag (high
    // load relief valve). User must switch to Sonnet.
    expect(CUSTOM_OFF_SWITCH_MESSAGE).toContain('use /model to switch to Sonnet')
  })

  test('API_TIMEOUT_ERROR_MESSAGE: bare "Request timed out" (no extra context)', () => {
    expect(API_TIMEOUT_ERROR_MESSAGE).toBe('Request timed out')
  })

  test('OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE: forceLoginOrg policy failure CTA', () => {
    expect(OAUTH_ORG_NOT_ALLOWED_ERROR_MESSAGE).toContain('Please run /login')
  })

  test('all error constants use middle-dot "·" separator (NOT hyphen or colon)', () => {
    // Visual consistency check — wandering separators (hyphen, en-dash, em-dash)
    // would create UI weirdness. The middle-dot is the chosen separator.
    expect(INVALID_API_KEY_ERROR_MESSAGE).toContain(' · ')
    expect(TOKEN_REVOKED_ERROR_MESSAGE).toContain(' · ')
    expect(CCR_AUTH_ERROR_MESSAGE).toContain(' · ')
    expect(INVALID_API_KEY_ERROR_MESSAGE_EXTERNAL).toContain(' · ')
  })

  describe('isPromptTooLongMessage', () => {
    test('returns true ONLY when isApiErrorMessage AND text starts with the literal prefix', () => {
      const mockMsg = {
        type: 'assistant' as const,
        isApiErrorMessage: true,
        message: {
          content: [{ type: 'text' as const, text: 'Prompt is too long: 137500 tokens > 200000' }],
        },
      } as any
      expect(isPromptTooLongMessage(mockMsg)).toBe(true)
    })

    test('returns false when isApiErrorMessage is missing (regular assistant msg)', () => {
      const mockMsg = {
        type: 'assistant' as const,
        message: {
          content: [{ type: 'text' as const, text: 'Prompt is too long' }],
        },
      } as any
      expect(isPromptTooLongMessage(mockMsg)).toBe(false)
    })

    test('returns false when text contains but does NOT START with the prefix', () => {
      // The function uses .startsWith(), not .includes(). If a future
      // refactor swaps to includes, a model reply containing the phrase
      // "Prompt is too long" mid-text would falsely trigger auto-compaction.
      const mockMsg = {
        type: 'assistant' as const,
        isApiErrorMessage: true,
        message: {
          content: [{ type: 'text' as const, text: 'API Error: Prompt is too long' }],
        },
      } as any
      expect(isPromptTooLongMessage(mockMsg)).toBe(false)
    })

    test('returns false for unrelated API errors', () => {
      const mockMsg = {
        type: 'assistant' as const,
        isApiErrorMessage: true,
        message: {
          content: [{ type: 'text' as const, text: 'API Error: 500 — Server error' }],
        },
      } as any
      expect(isPromptTooLongMessage(mockMsg)).toBe(false)
    })
  })
})
