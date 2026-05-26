import { afterEach, describe, expect, mock, test } from 'bun:test'

// MOCK_FULL_REPLACE: runAgent is fully replaced (not spread from the real
// module) on purpose. The real runAgent pulls a heavy transitive graph
// (AttachmentMessage / localAgentTask / the in-flight bg-agent-panel work owned
// by another session) that would couple this engine test to unrelated WIP and
// is irrelevant to the engine's contract. The stub provides runAgent's
// async-generator shape plus the two symbols other loaded modules re-export
// from this path (filterIncompleteToolCalls, isRecordableMessage).

// Mock runAgent: each call yields one assistant message whose text echoes the
// prompt (or a structured_output attachment when the workflow tool set includes
// StructuredOutput). This lets us exercise the full vm + hooks + engine pipeline
// without a real LLM.
function installRunAgentMock(
  behavior: (prompt: string, availableTools: unknown[]) => {
    text?: string
    structured?: unknown
  },
): void {
  // MOCK_FULL_REPLACE: runAgent is fully replaced (not spread) on purpose. The
  // real runAgent pulls a heavy transitive graph (AttachmentMessage /
  // localAgentTask / in-flight bg-agent-panel work owned by another session)
  // that would couple this engine test to unrelated WIP and is irrelevant to
  // the engine contract. The stub provides runAgent's async-generator shape
  // plus the two symbols other loaded modules re-export from this path
  // (filterIncompleteToolCalls, isRecordableMessage).
  mock.module(
    '@claude-code/tool-registry/tools/AgentTool/runAgent.js',
    () => ({
      // Re-exported by other modules in the load graph (e.g.
      // AgentSummary/agentSummary.ts). Provide a stub so a bare mock (no real
      // import) doesn't break those re-exporters.
      filterIncompleteToolCalls: (m: unknown) => m,
      isRecordableMessage: () => true,
      async *runAgent(args: {
        promptMessages: Array<{ message: { content: string } }>
        availableTools: unknown[]
      }) {
        const prompt =
          (args.promptMessages[0]?.message?.content as string) ?? ''
        const out = behavior(prompt, args.availableTools)
        if (out.structured !== undefined) {
          yield {
            type: 'attachment',
            attachment: { type: 'structured_output', data: out.structured },
          }
        }
        yield {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: out.text ?? '' }],
            usage: { output_tokens: 10 },
          },
        }
      },
    }),
  )
}

function fakeCtx(): {
  toolUseContext: import('@claude-code/tool-registry/Tool.js').ToolUseContext
} {
  const abortController = new AbortController()
  const toolUseContext = {
    options: {
      mainLoopModel: 'claude-sonnet-4-6',
      tools: [],
      agentDefinitions: { activeAgents: [], allAgents: [] },
      isNonInteractiveSession: true,
    },
    abortController,
    getAppState: () => ({ tasks: {}, toolPermissionContext: { mode: 'default' } }),
    setAppState: () => {},
  } as unknown as import('@claude-code/tool-registry/Tool.js').ToolUseContext
  return { toolUseContext }
}

const noopCanUseTool = (async () => ({
  behavior: 'allow',
  updatedInput: {},
})) as unknown as import('@claude-code/repl/hooks/useCanUseTool.js').CanUseToolFn

describe('runWorkflow (engine integration)', () => {
  afterEach(() => {
    mock.restore()
  })

  test('runs a linear script with phase/log/agent and returns its value', async () => {
    installRunAgentMock(prompt => ({ text: `echo:${prompt}` }))
    const { runWorkflow } = await import('../engine.js')
    const { compileWorkflowScript } = await import('../sandbox.js')
    const { parseWorkflowScript } = await import('../metaParser.js')

    const script = `export const meta = { name: "lin", description: "d" }
phase('Work')
log('starting')
const a = await agent('task A')
const b = await agent('task B')
return { a, b }`
    const parsed = parseWorkflowScript(script)
    expect('error' in parsed).toBe(false)
    if ('error' in parsed) return
    const compiled = compileWorkflowScript(parsed.scriptBody)
    expect(compiled.ok).toBe(true)
    if (!compiled.ok) return

    const progress: string[] = []
    const { toolUseContext } = fakeCtx()
    const res = await runWorkflow(compiled.vmScript, {
      toolUseContext,
      canUseTool: noopCanUseTool,
      onProgress: e => {
        if (e.data.type === 'workflow_log') progress.push(e.data.message)
      },
      workflowRunId: 'wf_test_lin',
    })

    expect(res.error).toBeUndefined()
    expect(res.result).toEqual({ a: 'echo:task A', b: 'echo:task B' })
    expect(res.agentCount).toBe(2)
    expect(progress).toContain('starting')
  })

  test('parallel() runs thunks and gathers results (barrier)', async () => {
    installRunAgentMock(prompt => ({ text: prompt.toUpperCase() }))
    const { runWorkflow } = await import('../engine.js')
    const { compileWorkflowScript } = await import('../sandbox.js')
    const { parseWorkflowScript } = await import('../metaParser.js')

    const script = `export const meta = { name: "par", description: "d" }
const items = ['a', 'b', 'c']
const out = await parallel(items.map(x => () => agent(x)))
return out`
    const parsed = parseWorkflowScript(script)
    if ('error' in parsed) throw new Error(parsed.error)
    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (!compiled.ok) throw new Error(compiled.error)

    const { toolUseContext } = fakeCtx()
    const res = await runWorkflow(compiled.vmScript, {
      toolUseContext,
      canUseTool: noopCanUseTool,
      onProgress: () => {},
      workflowRunId: 'wf_test_par',
    })
    expect(res.error).toBeUndefined()
    expect(res.result).toEqual(['A', 'B', 'C'])
    expect(res.agentCount).toBe(3)
  })

  test('pipeline() threads each item through stages independently', async () => {
    installRunAgentMock(prompt => ({ text: `done(${prompt})` }))
    const { runWorkflow } = await import('../engine.js')
    const { compileWorkflowScript } = await import('../sandbox.js')
    const { parseWorkflowScript } = await import('../metaParser.js')

    const script = `export const meta = { name: "pipe", description: "d" }
const out = await pipeline(
  [1, 2],
  (item) => agent('stage1-' + item),
  (prev) => agent('stage2-' + prev)
)
return out`
    const parsed = parseWorkflowScript(script)
    if ('error' in parsed) throw new Error(parsed.error)
    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (!compiled.ok) throw new Error(compiled.error)

    const { toolUseContext } = fakeCtx()
    const res = await runWorkflow(compiled.vmScript, {
      toolUseContext,
      canUseTool: noopCanUseTool,
      onProgress: () => {},
      workflowRunId: 'wf_test_pipe',
    })
    expect(res.error).toBeUndefined()
    // stage1 echoes "stage1-N"→"done(stage1-N)"; stage2 prompt uses prev string
    expect((res.result as string[])[0]).toBe('done(stage2-done(stage1-1))')
    expect(res.agentCount).toBe(4)
  })

  test('schema option returns the structured output', async () => {
    installRunAgentMock(() => ({ structured: { bugs: ['x', 'y'] } }))
    const { runWorkflow } = await import('../engine.js')
    const { compileWorkflowScript } = await import('../sandbox.js')
    const { parseWorkflowScript } = await import('../metaParser.js')

    const script = `export const meta = { name: "sc", description: "d" }
const r = await agent('find bugs', { schema: { type: 'object', properties: { bugs: { type: 'array', items: { type: 'string' } } } } })
return r.bugs.length`
    const parsed = parseWorkflowScript(script)
    if ('error' in parsed) throw new Error(parsed.error)
    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (!compiled.ok) throw new Error(compiled.error)

    const { toolUseContext } = fakeCtx()
    const res = await runWorkflow(compiled.vmScript, {
      toolUseContext,
      canUseTool: noopCanUseTool,
      onProgress: () => {},
      workflowRunId: 'wf_test_sc',
    })
    expect(res.error).toBeUndefined()
    expect(res.result).toBe(2)
  })

  test('determinism: Date.now() in the script body fails the run', async () => {
    installRunAgentMock(() => ({ text: 'x' }))
    const { runWorkflow } = await import('../engine.js')
    const { compileWorkflowScript } = await import('../sandbox.js')
    const { parseWorkflowScript } = await import('../metaParser.js')

    const script = `export const meta = { name: "det", description: "d" }
const t = Date.now()
return t`
    const parsed = parseWorkflowScript(script)
    if ('error' in parsed) throw new Error(parsed.error)
    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (!compiled.ok) throw new Error(compiled.error)

    const { toolUseContext } = fakeCtx()
    const res = await runWorkflow(compiled.vmScript, {
      toolUseContext,
      canUseTool: noopCanUseTool,
      onProgress: () => {},
      workflowRunId: 'wf_test_det',
    })
    expect(res.error).toBeDefined()
    expect(res.error).toContain('Date.now()')
  })

  test('abort signal stops the run with an error result', async () => {
    installRunAgentMock(() => ({ text: 'x' }))
    const { runWorkflow } = await import('../engine.js')
    const { compileWorkflowScript } = await import('../sandbox.js')
    const { parseWorkflowScript } = await import('../metaParser.js')

    const script = `export const meta = { name: "ab", description: "d" }
await new Promise(r => setTimeout(r, 5000))
return 'never'`
    const parsed = parseWorkflowScript(script)
    if ('error' in parsed) throw new Error(parsed.error)
    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (!compiled.ok) throw new Error(compiled.error)

    const { toolUseContext } = fakeCtx()
    // Abort almost immediately.
    setTimeout(() => toolUseContext.abortController.abort(), 20)
    const res = await runWorkflow(compiled.vmScript, {
      toolUseContext,
      canUseTool: noopCanUseTool,
      onProgress: () => {},
      workflowRunId: 'wf_test_ab',
    })
    expect(res.error).toBe('Workflow aborted')
  })
})
