import { describe, expect, test } from 'bun:test'

import { transformMCPResult } from '../clientRuntime.js'

describe('transformMCPResult', () => {
  test('unwraps singleton text content arrays by default', async () => {
    const result = await transformMCPResult(
      { content: [{ type: 'text', text: 'hello world' }] },
      'search',
      'test-server',
    )

    expect(result).toEqual({
      content: 'hello world',
      type: 'contentArray',
      schema: 'string',
    })
  })

  test('keeps multi-block content arrays structured', async () => {
    const result = await transformMCPResult(
      {
        content: [
          { type: 'text', text: 'hello' },
          { type: 'text', text: 'world' },
        ],
      },
      'search',
      'test-server',
    )

    expect(result.content).toEqual([
      { type: 'text', text: 'hello' },
      { type: 'text', text: 'world' },
    ])
    expect(result.type).toBe('contentArray')
  })
})
