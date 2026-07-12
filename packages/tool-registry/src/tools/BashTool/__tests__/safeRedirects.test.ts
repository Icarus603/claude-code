import { describe, expect, test } from 'bun:test'
import { hasUnsafeRedirectWithCd } from '../safeRedirects.js'

describe('hasUnsafeRedirectWithCd', () => {
  test('allows compound cd when every output redirect discards to /dev/null', () => {
    expect(hasUnsafeRedirectWithCd(true, [{ target: '/dev/null' }])).toBe(false)
  })

  test('still asks for a real post-cd write', () => {
    expect(hasUnsafeRedirectWithCd(true, [{ target: 'output.log' }])).toBe(true)
  })
})
