import { describe, expect, test } from 'bun:test'
import {
  MODEL_ALIASES,
  MODEL_FAMILY_ALIASES,
  isModelAlias,
  isModelFamilyAlias,
} from '../modelAliases.js'

describe('isModelAlias', () => {
  test('canonical aliases pass', () => {
    expect(isModelAlias('sonnet')).toBe(true)
    expect(isModelAlias('opus')).toBe(true)
    expect(isModelAlias('haiku')).toBe(true)
    expect(isModelAlias('best')).toBe(true)
  })
  test('1m-context aliases pass', () => {
    expect(isModelAlias('sonnet[1m]')).toBe(true)
    expect(isModelAlias('opus[1m]')).toBe(true)
  })
  test('opusplan compound passes', () => {
    expect(isModelAlias('opusplan')).toBe(true)
  })
  test('full model ids do NOT pass (those are model strings, not aliases)', () => {
    expect(isModelAlias('claude-opus-4-7')).toBe(false)
    expect(isModelAlias('gpt-5.5')).toBe(false)
  })
  test('empty / unknown strings reject', () => {
    expect(isModelAlias('')).toBe(false)
    expect(isModelAlias('SONNET')).toBe(false) // case-sensitive
  })
  test('every entry in MODEL_ALIASES is recognized', () => {
    for (const alias of MODEL_ALIASES) {
      expect(isModelAlias(alias)).toBe(true)
    }
  })
})

describe('isModelFamilyAlias', () => {
  test('bare families pass', () => {
    expect(isModelFamilyAlias('sonnet')).toBe(true)
    expect(isModelFamilyAlias('opus')).toBe(true)
    expect(isModelFamilyAlias('haiku')).toBe(true)
  })
  test('1m variants do NOT count as family aliases', () => {
    // Family aliases are wildcards in allowlists; [1m] is a context variant
    expect(isModelFamilyAlias('opus[1m]')).toBe(false)
    expect(isModelFamilyAlias('sonnet[1m]')).toBe(false)
  })
  test('compounds like opusplan/best are not families', () => {
    expect(isModelFamilyAlias('opusplan')).toBe(false)
    expect(isModelFamilyAlias('best')).toBe(false)
  })
  test('full version ids reject', () => {
    expect(isModelFamilyAlias('claude-opus-4-7')).toBe(false)
  })
  test('every MODEL_FAMILY_ALIAS entry matches', () => {
    for (const fam of MODEL_FAMILY_ALIASES) {
      expect(isModelFamilyAlias(fam)).toBe(true)
    }
  })
  test('every family alias is also a regular alias (subset relation)', () => {
    for (const fam of MODEL_FAMILY_ALIASES) {
      expect(isModelAlias(fam)).toBe(true)
    }
  })
})
