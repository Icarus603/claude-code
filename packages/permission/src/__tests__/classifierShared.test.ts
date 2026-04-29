import { describe, expect, test } from 'bun:test'
import { z } from 'zod/v4'
import {
  extractToolUseBlock,
  parseClassifierResponse,
} from '../classifierShared.js'

type Block = Parameters<typeof extractToolUseBlock>[0][number]

describe('extractToolUseBlock', () => {
  test('returns matching tool_use block', () => {
    const blocks: Block[] = [
      { type: 'text', text: 'thinking' } as never,
      { type: 'tool_use', id: 'tu1', name: 'Bash', input: { cmd: 'ls' } } as never,
    ]
    const result = extractToolUseBlock(blocks, 'Bash')
    expect(result?.id).toBe('tu1')
    expect(result?.name).toBe('Bash')
  })

  test('returns FIRST matching block when multiple present', () => {
    // .find returns first. Documents this — if a future refactor uses
    // .findLast, the wrong tool_use would be classified.
    const blocks: Block[] = [
      { type: 'tool_use', id: 'first', name: 'Bash', input: {} } as never,
      { type: 'tool_use', id: 'second', name: 'Bash', input: {} } as never,
    ]
    expect(extractToolUseBlock(blocks, 'Bash')?.id).toBe('first')
  })

  test('returns null when no tool_use block has matching name', () => {
    const blocks: Block[] = [
      { type: 'tool_use', id: 'tu1', name: 'Edit', input: {} } as never,
    ]
    expect(extractToolUseBlock(blocks, 'Bash')).toBeNull()
  })

  test('returns null for empty content', () => {
    expect(extractToolUseBlock([], 'Bash')).toBeNull()
  })

  test('returns null when only non-tool_use blocks present', () => {
    const blocks: Block[] = [
      { type: 'text', text: 'thinking' } as never,
      { type: 'thinking', thinking: 'hmm' } as never,
    ]
    expect(extractToolUseBlock(blocks, 'Bash')).toBeNull()
  })

  test('case-sensitive name matching', () => {
    const blocks: Block[] = [
      { type: 'tool_use', id: 'tu1', name: 'Bash', input: {} } as never,
    ]
    // 'bash' (lowercase) does NOT match 'Bash'.
    expect(extractToolUseBlock(blocks, 'bash')).toBeNull()
  })

  test('skips text blocks even with matching content', () => {
    // The function checks `b.type === 'tool_use'` AND name. A text block
    // with a string that happens to be 'Bash' should NOT match.
    const blocks: Block[] = [
      { type: 'text', text: 'Bash' } as never,
    ]
    expect(extractToolUseBlock(blocks, 'Bash')).toBeNull()
  })

  test('post-narrow check (block.type !== "tool_use") catches null block', () => {
    // Defense-in-depth: even if .find returns something with type=tool_use,
    // the second `if (!block || block.type !== 'tool_use')` guards against
    // surprises. Test the fail-closed behavior on no match.
    expect(extractToolUseBlock([] as Block[], 'Anything')).toBeNull()
  })
})

describe('parseClassifierResponse', () => {
  const schema = z.object({
    decision: z.enum(['allow', 'deny', 'ask']),
    reason: z.string(),
  })

  test('returns parsed data when input matches schema', () => {
    const block = {
      type: 'tool_use' as const,
      id: 't',
      name: 'classify',
      input: { decision: 'allow' as const, reason: 'safe' },
    }
    const result = parseClassifierResponse(block, schema)
    expect(result).toEqual({ decision: 'allow', reason: 'safe' })
  })

  test('returns null when input fails schema validation', () => {
    const block = {
      type: 'tool_use' as const,
      id: 't',
      name: 'classify',
      input: { decision: 'invalid', reason: 'safe' },
    }
    expect(parseClassifierResponse(block, schema)).toBeNull()
  })

  test('returns null when required fields missing', () => {
    const block = {
      type: 'tool_use' as const,
      id: 't',
      name: 'classify',
      input: { decision: 'allow' /* missing reason */ },
    }
    expect(parseClassifierResponse(block, schema)).toBeNull()
  })

  test('returns null when input is not an object', () => {
    const block = {
      type: 'tool_use' as const,
      id: 't',
      name: 'classify',
      input: 'string instead of object',
    }
    expect(parseClassifierResponse(block, schema)).toBeNull()
  })

  test('preserves type narrowing — returned data is z.infer<typeof schema>', () => {
    // Compile-time check: returned data's type matches schema inference.
    // If schema requires {decision, reason}, runtime returned object
    // has those fields when non-null.
    const block = {
      type: 'tool_use' as const,
      id: 't',
      name: 'classify',
      input: { decision: 'deny' as const, reason: 'unsafe' },
    }
    const result = parseClassifierResponse(block, schema)
    if (result !== null) {
      // Type-narrows to {decision, reason}.
      expect(result.decision).toBe('deny')
      expect(result.reason).toBe('unsafe')
    } else {
      throw new Error('expected non-null')
    }
  })

  test('strips extra fields per schema definition', () => {
    // z.object by default strips unknown fields (zod v4 strict-by-default
    // is opt-in). Document the behavior.
    const block = {
      type: 'tool_use' as const,
      id: 't',
      name: 'classify',
      input: {
        decision: 'allow' as const,
        reason: 'safe',
        extraField: 'should be stripped',
      },
    }
    const result = parseClassifierResponse(block, schema) as Record<
      string,
      unknown
    >
    expect(result).toEqual({ decision: 'allow', reason: 'safe' })
    expect(result.extraField).toBeUndefined()
  })

  test('safeParse failure returns null (does NOT throw)', () => {
    // Critical contract: function must NEVER throw. If schema.safeParse
    // returns success=false, return null. A throw here would crash the
    // classifier turn.
    const block = {
      type: 'tool_use' as const,
      id: 't',
      name: 'classify',
      input: null, // invalid for object schema
    }
    expect(() => parseClassifierResponse(block, schema)).not.toThrow()
    expect(parseClassifierResponse(block, schema)).toBeNull()
  })
})
