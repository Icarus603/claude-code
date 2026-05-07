import { describe, expect, test } from 'bun:test'
import type { Message } from '../messageShapes.js'
import { hydrateRepl, reconstructLog, REPL_TOOL_NAME } from '../replHydration.js'

function asstReplToolUse(replId: string, code: string, isVirtual = false): Message {
  return {
    type: 'assistant',
    isVirtual,
    uuid: `u-${replId}`,
    timestamp: '',
    requestId: 'r',
    message: {
      id: `msg-${replId}`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: replId, name: REPL_TOOL_NAME, input: { code } }],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      model: '',
    },
  } as unknown as Message
}

function virtualToolUseAsst(toolName: string, replId: string): Message {
  return {
    type: 'assistant',
    isVirtual: true,
    uuid: `vu-${replId}-${toolName}`,
    timestamp: '',
    requestId: 'r',
    message: {
      id: `vmsg`,
      type: 'message',
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'inner', name: toolName, input: {} }],
      stop_reason: null,
      stop_sequence: null,
      usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      model: '',
    },
  } as unknown as Message
}

function virtualToolResultUser(toolName: string, result: unknown, isError = false): Message {
  return {
    type: 'user',
    isVirtual: true,
    uuid: `vr-${toolName}`,
    timestamp: '',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: 'inner',
        content: isError && typeof result === 'string' ? result : 'ok',
        is_error: isError,
      }],
    },
    toolUseResult: result,
  } as unknown as Message
}

function realUserToolResult(replId: string, threw: boolean): Message {
  return {
    type: 'user',
    isVirtual: false,
    uuid: `ru-${replId}`,
    timestamp: '',
    message: {
      role: 'user',
      content: [{
        type: 'tool_result',
        tool_use_id: replId,
        content: 'output',
        is_error: false,
      }],
    },
    toolUseResult: threw ? { error: 'oops' } : { stdout: 'ok' },
  } as unknown as Message
}

describe('reconstructLog (k56)', () => {
  test('empty messages → empty log', () => {
    expect(reconstructLog([])).toEqual([])
  })

  test('single REPL block, no inner calls, no throw', () => {
    const log = reconstructLog([
      asstReplToolUse('repl-1', 'console.log("hi")'),
      realUserToolResult('repl-1', false),
    ])
    expect(log).toEqual([{ replId: 'repl-1', code: 'console.log("hi")', calls: [], threw: false }])
  })

  test('REPL block with one inner tool call (ok)', () => {
    const log = reconstructLog([
      asstReplToolUse('repl-1', 'await Read("a.txt")'),
      virtualToolUseAsst('Read', 'repl-1'),
      virtualToolResultUser('Read', { contents: 'file body' }),
      realUserToolResult('repl-1', false),
    ])
    expect(log).toHaveLength(1)
    expect(log[0]?.calls).toEqual([{ kind: 'ok', toolName: 'Read', result: { contents: 'file body' } }])
    expect(log[0]?.threw).toBe(false)
  })

  test('REPL block with inner tool error', () => {
    const log = reconstructLog([
      asstReplToolUse('repl-1', 'await Bash("false")'),
      virtualToolUseAsst('Bash', 'repl-1'),
      virtualToolResultUser('Bash', 'permission denied', true),
      realUserToolResult('repl-1', false),
    ])
    expect(log[0]?.calls).toEqual([{ kind: 'err', toolName: 'Bash', error: 'permission denied' }])
  })

  test('detects threw', () => {
    const log = reconstructLog([
      asstReplToolUse('repl-1', 'throw new Error("boom")'),
      realUserToolResult('repl-1', true),
    ])
    expect(log[0]?.threw).toBe(true)
  })

  test('multiple REPL blocks accumulate sequentially', () => {
    const log = reconstructLog([
      asstReplToolUse('repl-1', 'let x = 1'),
      realUserToolResult('repl-1', false),
      asstReplToolUse('repl-2', 'console.log(x)'),
      realUserToolResult('repl-2', false),
    ])
    expect(log).toHaveLength(2)
    expect(log[0]?.replId).toBe('repl-1')
    expect(log[1]?.replId).toBe('repl-2')
  })

  test('non-REPL tool_use messages are skipped', () => {
    const otherTool: Message = {
      type: 'assistant', isVirtual: false, uuid: 'x', timestamp: '', requestId: 'r',
      message: {
        id: 'a', type: 'message', role: 'assistant',
        content: [{ type: 'tool_use', id: 'r-x', name: 'Bash', input: { command: 'ls' } }],
        stop_reason: null, stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        model: '',
      },
    } as unknown as Message
    const log = reconstructLog([otherTool])
    expect(log).toEqual([])
  })

  test('virtual tool_result without preceding pendingName is dropped', () => {
    const log = reconstructLog([
      asstReplToolUse('repl-1', 'x'),
      // no virtualToolUseAsst — pendingName never set
      virtualToolResultUser('Read', 'orphan'),
      realUserToolResult('repl-1', false),
    ])
    expect(log[0]?.calls).toEqual([])
  })

  test('multiple inner calls in one REPL block', () => {
    const log = reconstructLog([
      asstReplToolUse('repl-1', 'await Read; await Bash'),
      virtualToolUseAsst('Read', 'repl-1'),
      virtualToolResultUser('Read', 'file'),
      virtualToolUseAsst('Bash', 'repl-1'),
      virtualToolResultUser('Bash', 'shell'),
      realUserToolResult('repl-1', false),
    ])
    expect(log[0]?.calls).toHaveLength(2)
    expect(log[0]?.calls[0]?.toolName).toBe('Read')
    expect(log[0]?.calls[1]?.toolName).toBe('Bash')
  })
})

describe('hydrateRepl', () => {
  test('skipped when REPLTool not enabled (default)', async () => {
    const r = await hydrateRepl({ kind: 'fork', log: [{ replId: '1', code: 'x', calls: [], threw: false }] })
    expect(r.skipped).toBe(true)
    expect(r.attempted).toBe(0)
  })

  test('skipped when kind=fresh', async () => {
    const r = await hydrateRepl({ kind: 'fresh' }, { isReplToolEnabled: () => true })
    expect(r.skipped).toBe(true)
  })

  test('runs replayer when REPLTool enabled', async () => {
    const replayed: string[] = []
    const r = await hydrateRepl(
      { kind: 'resume', log: [{ replId: '1', code: 'x', calls: [], threw: false }] },
      {
        isReplToolEnabled: () => true,
        replayEntry: async e => {
          replayed.push(e.replId)
          return { kind: 'ok' }
        },
      },
    )
    expect(r.skipped).toBe(false)
    expect(r.attempted).toBe(1)
    expect(r.ok).toBe(1)
    expect(replayed).toEqual(['1'])
  })

  test('counts drift + threw outcomes', async () => {
    const log = [
      { replId: '1', code: 'a', calls: [], threw: false },
      { replId: '2', code: 'b', calls: [], threw: false },
      { replId: '3', code: 'c', calls: [], threw: false },
    ]
    let i = 0
    const r = await hydrateRepl(
      { kind: 'resume', log },
      {
        isReplToolEnabled: () => true,
        replayEntry: async () => {
          const outcomes: Array<{ kind: 'ok' | 'drift' | 'threw' }> = [
            { kind: 'ok' },
            { kind: 'drift' },
            { kind: 'threw' },
          ]
          return outcomes[i++]!
        },
      },
    )
    expect(r.ok).toBe(1)
    expect(r.drift).toBe(1)
    expect(r.threw).toBe(1)
  })
})
