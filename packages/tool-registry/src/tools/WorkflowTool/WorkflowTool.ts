// Workflow tool — deterministic multi-agent orchestration. Port of ant 2.1.150
// module ub8 (3904.js). Compiles a user-authored workflow script, launches it
// in the background through the vm sandbox engine, and returns immediately with
// a task ID; a <task-notification> arrives on completion.

import { randomUUID } from 'node:crypto'
import { z } from 'zod/v4'
import { buildTool, type ToolDef } from '../../Tool.js'
import { lazySchema } from '../../utils/lazySchema.js'
import type { PermissionResult } from '@claude-code/permission/PermissionResult'
import { generateTaskId } from '../../Task.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { WORKFLOW_TOOL_DESCRIPTION, WORKFLOW_TOOL_NAME } from './constants.js'
import { parseWorkflowScript } from '@claude-code/agent/workflow/metaParser.js'
import { compileWorkflowScript } from '@claude-code/agent/workflow/sandbox.js'
import { runWorkflow } from '@claude-code/agent/workflow/engine.js'
import { FileWorkflowJournal } from '@claude-code/agent/workflow/journal.js'
import {
  getWorkflowRunDir,
  persistWorkflowScript,
  readWorkflowScriptFile,
  writeWorkflowSnapshot,
  MAX_WORKFLOW_SCRIPT_BYTES,
} from '@claude-code/agent/workflow/paths.js'
import {
  completeWorkflowTask,
  enqueueWorkflowNotification,
  failWorkflowTask,
  registerWorkflowTask,
  updateWorkflowProgressBatch,
} from '@claude-code/agent/tasks/LocalWorkflowTask/LocalWorkflowTask.js'
import type { WorkflowProgress } from '@claude-code/agent/workflow/types.js'

// ant mJ3 — input schema.
const inputSchema = lazySchema(() =>
  z
    .object({
      script: z
        .string()
        .max(MAX_WORKFLOW_SCRIPT_BYTES)
        .optional()
        .describe(
          'Self-contained workflow script. Must begin with `export const meta = { name, description, phases }` (pure literal, no computed values) followed by the script body using agent()/parallel()/pipeline()/phase().',
        ),
      name: z
        .string()
        .optional()
        .describe(
          'Name of a predefined workflow (built-in or from .claude/workflows/). Resolves to a self-contained script.',
        ),
      args: z
        .unknown()
        .optional()
        .describe(
          'Optional input value exposed to the script as the global `args`.',
        ),
      scriptPath: z
        .string()
        .optional()
        .describe(
          'Path to a workflow script file on disk. Every invocation persists its script under the session directory and returns the path. To iterate, edit that file and re-invoke with the same `scriptPath`. Takes precedence over `script` and `name`.',
        ),
      resumeFromRunId: z
        .string()
        .regex(/^wf_[a-z0-9-]{6,}$/)
        .optional()
        .describe(
          'Run ID of a prior Workflow invocation to resume from. Completed agent() calls with unchanged (prompt, opts) return their cached results instantly; only edited or new calls re-run. Same-session only.',
        ),
    })
    .refine(v => v.script || v.name || v.scriptPath, {
      message: 'Must provide script, name, or scriptPath',
    }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    status: z.enum(['async_launched']),
    taskId: z.string(),
    runId: z.string().optional(),
    summary: z.string().optional(),
    transcriptDir: z.string().optional(),
    scriptPath: z.string().optional(),
    error: z.string().optional(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
type Output = z.infer<OutputSchema>

// ant dHK — resolve {script, resolvedScriptPath, source} from the input.
async function resolveScript(input: {
  script?: string
  name?: string
  scriptPath?: string
}): Promise<
  | { script: string; resolvedScriptPath?: string; source?: string }
  | { error: string }
> {
  if (input.scriptPath) {
    if (input.script) {
      return { script: input.script, resolvedScriptPath: input.scriptPath }
    }
    const read = await readWorkflowScriptFile(input.scriptPath)
    if ('error' in read) return read
    return { script: read.script, resolvedScriptPath: read.path }
  }
  if (input.name) {
    // Named-workflow registry (builtin + .claude/workflows/) is wired in P5.
    return {
      error: `Named workflows are not yet available in this build. Provide \`script\` or \`scriptPath\`.`,
    }
  }
  if (input.script) return { script: input.script }
  return { error: 'Must provide script, name, or scriptPath' }
}

export const WorkflowTool = buildTool({
  isMcp: false,
  name: WORKFLOW_TOOL_NAME,
  // ant 3904.js gJ3: `aliases:["RunWorkflow"]` — the model may invoke the tool
  // under either name.
  aliases: ['RunWorkflow'],
  searchHint: 'orchestrate subagents with a deterministic JavaScript workflow',
  maxResultSizeChars: 100_000,
  isEnabled() {
    return true
  },
  isConcurrencySafe() {
    return false
  },
  isReadOnly() {
    return false
  },
  isOpenWorld() {
    return false
  },
  async description(): Promise<string> {
    return WORKFLOW_TOOL_DESCRIPTION
  },
  async prompt(): Promise<string> {
    return WORKFLOW_TOOL_DESCRIPTION
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  toAutoClassifierInput(input) {
    return input.script ?? input.name ?? ''
  },
  async validateInput(input): Promise<
    { result: true } | { result: false; message: string; errorCode: number }
  > {
    const resolved = await resolveScript(input)
    if ('error' in resolved) {
      return { result: false, message: resolved.error, errorCode: 1 }
    }
    const parsed = parseWorkflowScript(resolved.script)
    if ('error' in parsed) {
      return {
        result: false,
        message: `Script must begin with \`export const meta = { name, description, phases }\` (pure literal). ${parsed.error}`,
        errorCode: 2,
      }
    }
    // ant — reject non-determinism in an inline script body.
    if (
      input.script &&
      /\bDate\s*\.\s*now\b|\bMath\s*\.\s*random\b|\bnew\s+Date\s*\(\s*\)/.test(
        parsed.scriptBody,
      )
    ) {
      return {
        result: false,
        message:
          'Workflow scripts must be deterministic: Date.now()/Math.random()/new Date() are unavailable (breaks resume). Stamp results after the workflow returns, or pass timestamps via args.',
        errorCode: 4,
      }
    }
    return { result: true }
  },
  async checkPermissions(input): Promise<PermissionResult> {
    // Ask before running an arbitrary script (it can spawn many agents and
    // touch the repo). A future build can add allow/deny rule matching like
    // ant; for now always confirm.
    return {
      behavior: 'ask',
      message: 'Review workflow before running',
      updatedInput: input,
    }
  },
  userFacingName() {
    return 'Workflow'
  },
  getToolUseSummary(input) {
    if (input?.name) return `workflow: ${input.name}`
    if (!input?.script) return null
    const parsed = parseWorkflowScript(input.script)
    if (!('error' in parsed)) return parsed.meta.description
    const firstLine = input.script.split('\n').find(l => l.trim()) ?? ''
    return firstLine.length > 50 ? `${firstLine.slice(0, 49)}…` : firstLine
  },
  async call(input, toolUseContext, canUseTool) {
    const resolved = await resolveScript(input)
    if ('error' in resolved) throw new Error(resolved.error)
    const { script } = resolved
    const parsed = parseWorkflowScript(script)
    if ('error' in parsed) {
      throw new Error(`Invalid workflow script: ${parsed.error}`)
    }

    const runId = input.resumeFromRunId ?? `wf_${randomUUID().slice(0, 12)}`
    const taskId = generateTaskId('local_workflow')
    const summary = parsed.meta.description
    const workflowName = parsed.meta.name

    const compiled = compileWorkflowScript(parsed.scriptBody)
    if (compiled.ok === false) {
      return {
        data: {
          status: 'async_launched' as const,
          taskId,
          runId,
          summary,
          error: compiled.error,
        } satisfies Output,
      }
    }

    // Persist the script for the iterate/resume flow.
    const scriptPath =
      resolved.resolvedScriptPath ??
      persistWorkflowScript(workflowName, runId, script)

    const abortController = new AbortController()
    const agentControllers = new Map<string, AbortController>()
    const setAppState = toolUseContext.setAppState

    registerWorkflowTask(
      {
        taskId,
        script,
        scriptPath,
        args: input.args,
        summary,
        workflowName,
        phases: parsed.meta.phases,
        defaultModel: toolUseContext.options.mainLoopModel,
        workflowRunId: runId,
        toolUseId: toolUseContext.toolUseId,
        abortController,
        agentControllers,
      },
      setAppState,
    )

    const transcriptDir = getWorkflowRunDir(runId)
    const journal = new FileWorkflowJournal(runId)

    // Engine context: combine the run abort with the tool's abort.
    const runContext = { ...toolUseContext, abortController }

    // Batch progress events into task state (small debounce via microtask).
    let pending: WorkflowProgress[] = []
    let flushScheduled = false
    const flush = (): void => {
      flushScheduled = false
      if (pending.length === 0) return
      const batch = pending
      pending = []
      updateWorkflowProgressBatch(taskId, batch, setAppState)
    }
    const onProgress = (e: {
      type: 'progress'
      toolUseID: string
      data: WorkflowProgress
    }): void => {
      pending.push(e.data)
      if (!flushScheduled) {
        flushScheduled = true
        queueMicrotask(flush)
      }
    }

    // Fire-and-forget: run the workflow in the background.
    void (async () => {
      let journalState
      try {
        journalState = input.resumeFromRunId ? await journal.load() : undefined
      } catch (e) {
        logForDebugging(`workflow journal load failed: ${e}`)
      }

      const result = await runWorkflow(compiled.vmScript, {
        toolUseContext: runContext,
        canUseTool,
        onProgress,
        workflowRunId: runId,
        onAgentController: (agentId, controller) => {
          if (controller) agentControllers.set(agentId, controller)
          else agentControllers.delete(agentId)
        },
        seedPhaseTitles: parsed.meta.phases?.map(p => p.title),
        args: input.args,
        journal,
        journalState,
      })
      flush()

      const status = abortController.signal.aborted
        ? 'killed'
        : result.error
          ? 'failed'
          : 'completed'

      await writeWorkflowSnapshot(runId, {
        taskId,
        script,
        scriptPath,
        args: input.args,
        result: result.result,
        agentCount: result.agentCount,
        logs: result.logs,
        durationMs: result.durationMs,
        error: result.error,
        summary,
        workflowName,
        status,
        startTime: Date.now() - result.durationMs,
        phases: parsed.meta.phases,
        defaultModel: toolUseContext.options.mainLoopModel,
        totalTokens: 0,
        totalToolCalls: 0,
      })

      if (abortController.signal.aborted) return

      if (result.error) {
        failWorkflowTask(taskId, result.error, result.agentCount, result.logs, setAppState)
      } else {
        completeWorkflowTask(taskId, result.result, result.agentCount, result.logs, setAppState)
      }

      enqueueWorkflowNotification({
        taskId,
        summary,
        status: result.error ? 'failed' : 'completed',
        result: result.result,
        failures: result.failures,
        error: result.error,
        agentCount: result.agentCount,
        totalTokens: 0,
        totalToolCalls: 0,
        durationMs: result.durationMs,
        scriptPath,
        workflowRunId: runId,
        args: input.args,
        transcriptDir,
        setAppState,
      })
    })().catch(e => {
      const msg = e instanceof Error ? e.message : String(e)
      logForDebugging(`workflow run crashed: ${msg}`)
      failWorkflowTask(taskId, msg, 0, [], setAppState)
    })

    return {
      data: {
        status: 'async_launched' as const,
        taskId,
        runId,
        summary,
        transcriptDir,
        scriptPath,
      } satisfies Output,
    }
  },
  mapToolResultToToolResultBlockParam(output, toolUseID) {
    if (output.error) {
      return {
        tool_use_id: toolUseID,
        type: 'tool_result' as const,
        content: `Workflow script has a syntax error and was not launched:\n${output.error}`,
        is_error: true,
      }
    }
    const parts = [`Workflow launched in background. Task ID: ${output.taskId}`]
    if (output.summary) parts.push(`Summary: ${output.summary}`)
    if (output.transcriptDir) parts.push(`Transcript dir: ${output.transcriptDir}`)
    if (output.scriptPath) {
      parts.push(
        `Script file: ${output.scriptPath}\n(Edit this file with Write/Edit and re-invoke Workflow with {scriptPath: "${output.scriptPath}"} to iterate without resending the script.)`,
      )
      if (output.runId) {
        parts.push(
          `Run ID: ${output.runId}\nTo resume after editing the script: Workflow({scriptPath: "${output.scriptPath}", resumeFromRunId: "${output.runId}"}) — completed agents return cached results.`,
        )
      }
    }
    parts.push('\nYou will be notified when it completes. Use /workflows to watch live progress.')
    return {
      tool_use_id: toolUseID,
      type: 'tool_result' as const,
      content: parts.join('\n'),
      is_error: false,
    }
  },
  renderToolUseMessage(input) {
    if (input.name) return `workflow: ${input.name}`
    return input.scriptPath ? `workflow: ${input.scriptPath}` : 'workflow'
  },
  renderToolUseRejectedMessage() {
    return 'Workflow rejected'
  },
  renderToolUseErrorMessage(output: { error?: string }) {
    return output.error ?? 'Workflow error'
  },
  renderToolUseProgressMessage() {
    return null
  },
  renderToolResultMessage(output: Output) {
    return output.summary ?? 'Workflow launched'
  },
} satisfies ToolDef<InputSchema, Output>)
