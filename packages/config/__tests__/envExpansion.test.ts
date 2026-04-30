/** biome-ignore-all lint/suspicious/noTemplateCurlyInString: this file tests literal ${VAR} string expansion — placeholders must NOT be template literals */

import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { expandEnvVarsInString } from '../utils/envExpansion.js'

const ORIGINAL_FOO = process.env.FOO
const ORIGINAL_BAR = process.env.BAR

beforeEach(() => {
  delete process.env.FOO
  delete process.env.BAR
})
afterEach(() => {
  if (ORIGINAL_FOO === undefined) delete process.env.FOO
  else process.env.FOO = ORIGINAL_FOO
  if (ORIGINAL_BAR === undefined) delete process.env.BAR
  else process.env.BAR = ORIGINAL_BAR
})

describe('expandEnvVarsInString', () => {
  test('substitutes ${VAR} with env value', () => {
    process.env.FOO = 'hello'
    const r = expandEnvVarsInString('a ${FOO} b')
    expect(r.expanded).toBe('a hello b')
    expect(r.missingVars).toEqual([])
  })

  test('multiple ${VAR} occurrences', () => {
    process.env.FOO = 'X'
    process.env.BAR = 'Y'
    const r = expandEnvVarsInString('${FOO}-${BAR}-${FOO}')
    expect(r.expanded).toBe('X-Y-X')
    expect(r.missingVars).toEqual([])
  })

  test('${VAR:-default} substitutes default when var is missing', () => {
    const r = expandEnvVarsInString('value=${MISSING:-fallback}')
    expect(r.expanded).toBe('value=fallback')
    expect(r.missingVars).toEqual([])
  })

  test('${VAR:-default} prefers env value over default when set', () => {
    process.env.FOO = 'real'
    const r = expandEnvVarsInString('${FOO:-default}')
    expect(r.expanded).toBe('real')
  })

  test('default value can contain :- (only the first :- is the separator)', () => {
    // Regression: previously `split(':-', 2)` truncated the default at the
    // second :-, so `${MISSING:-foo:-bar}` returned just 'foo'. Fixed by
    // using indexOf + slice so the default keeps everything after the
    // first :- verbatim.
    const r = expandEnvVarsInString('${MISSING:-foo:-bar}')
    expect(r.expanded).toBe('foo:-bar')
  })

  test('missing var without default tracked + left literal', () => {
    const r = expandEnvVarsInString('hello ${UNDEFINED_VAR_X} world')
    expect(r.expanded).toBe('hello ${UNDEFINED_VAR_X} world')
    expect(r.missingVars).toEqual(['UNDEFINED_VAR_X'])
  })

  test('multiple missing vars tracked in order', () => {
    const r = expandEnvVarsInString('${A_MISSING} ${B_MISSING}')
    expect(r.missingVars).toEqual(['A_MISSING', 'B_MISSING'])
  })

  test('strings without ${...} are unchanged', () => {
    const r = expandEnvVarsInString('plain text')
    expect(r.expanded).toBe('plain text')
    expect(r.missingVars).toEqual([])
  })

  test('empty default substitutes empty string', () => {
    const r = expandEnvVarsInString('a${MISSING:-}b')
    expect(r.expanded).toBe('ab')
  })

  test('returns object with both fields even when nothing to expand (regression: previously bare string)', () => {
    const r = expandEnvVarsInString('plain')
    // Spread-callers in mcp config validation rely on `missingVars` being an array.
    expect(Array.isArray(r.missingVars)).toBe(true)
  })
})
