import { describe, expect, test } from 'bun:test'
import { sanitizeBetaHeaders } from '../betas.js'

describe('sanitizeBetaHeaders', () => {
  test('strips empty beta values and whitespace', () => {
    expect(
      sanitizeBetaHeaders([
        'claude-code-20250219',
        '',
        '   ',
        'fast-mode-2026-02-01',
        ' fast-mode-2026-02-01 ',
      ]),
    ).toEqual(['claude-code-20250219', 'fast-mode-2026-02-01'])
  })
})
