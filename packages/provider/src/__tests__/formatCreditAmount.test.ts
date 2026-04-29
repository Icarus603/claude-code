/**
 * Tests for formatCreditAmount — formats referrer reward into a
 * displayable currency string for the /passes UI.
 *
 * Wrong formatting = misleading user about reward amount (e.g.
 * "$0.5" instead of "$0.50" might be read as 5¢ at a glance).
 */
import { describe, expect, test } from 'bun:test'
import { formatCreditAmount } from '../referral.js'
import type { ReferrerRewardInfo } from '../oauth/types.js'

const reward = (currency: string, amount_minor_units: number): ReferrerRewardInfo =>
  ({ currency, amount_minor_units }) as ReferrerRewardInfo

describe('formatCreditAmount — known currency symbols', () => {
  test.each([
    ['USD', 1000, '$10'],
    ['EUR', 500, '€5'],
    ['GBP', 750, '£7.50'],
    ['BRL', 1500, 'R$15'],
    ['CAD', 2500, 'CA$25'],
    ['AUD', 5000, 'A$50'],
    ['NZD', 250, 'NZ$2.50'],
    ['SGD', 100, 'S$1'],
  ])('%s %d minor units → "%s"', (currency, amount, expected) => {
    expect(formatCreditAmount(reward(currency, amount))).toBe(expected)
  })
})

describe('formatCreditAmount — whole vs fractional amounts', () => {
  test('whole dollar amount: no decimal places', () => {
    expect(formatCreditAmount(reward('USD', 1000))).toBe('$10')
    expect(formatCreditAmount(reward('USD', 100))).toBe('$1')
  })

  test('fractional amount: 2 decimal places', () => {
    expect(formatCreditAmount(reward('USD', 1050))).toBe('$10.50')
    expect(formatCreditAmount(reward('USD', 99))).toBe('$0.99')
    expect(formatCreditAmount(reward('USD', 1))).toBe('$0.01')
  })

  test('zero amount: "$0"', () => {
    expect(formatCreditAmount(reward('USD', 0))).toBe('$0')
  })
})

describe('formatCreditAmount — unknown currencies', () => {
  test('unknown ISO code: prefixed with code + space', () => {
    expect(formatCreditAmount(reward('JPY', 1000))).toBe('JPY 10')
    expect(formatCreditAmount(reward('CHF', 1500))).toBe('CHF 15')
  })

  test('unknown currency with fractional: same formatting rules', () => {
    expect(formatCreditAmount(reward('JPY', 1050))).toBe('JPY 10.50')
  })

  test('empty currency string: prefix is just space', () => {
    // Documented edge: '' is unknown, so it falls into the prefix branch
    // and returns " <amount>".
    expect(formatCreditAmount(reward('', 1000))).toBe(' 10')
  })
})

describe('formatCreditAmount — large amounts', () => {
  test('10,000 USD → "$100"', () => {
    expect(formatCreditAmount(reward('USD', 10000))).toBe('$100')
  })

  test('1,000,000 USD → "$10000" (no thousands separator)', () => {
    // Documented: this formatter does NOT add thousands separators
    // (caller's responsibility if needed). Lock the raw output.
    expect(formatCreditAmount(reward('USD', 1_000_000))).toBe('$10000')
  })
})
