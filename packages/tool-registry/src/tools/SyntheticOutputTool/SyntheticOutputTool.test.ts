import { describe, expect, test } from 'bun:test'
import { createSyntheticOutputTool } from './SyntheticOutputTool.js'

describe('createSyntheticOutputTool', () => {
  test('accepts standard format annotations', () => {
    const result = createSyntheticOutputTool({
      type: 'object',
      properties: { createdAt: { type: 'string', format: 'date-time' } },
    })
    expect('tool' in result).toBe(true)
  })

  test('returns a diagnostic for an invalid schema', () => {
    const result = createSyntheticOutputTool({ type: 'not-a-json-schema-type' })
    expect('error' in result).toBe(true)
  })
})
