// Workflow vm-context assembler + nested workflow() hook.
// Port of ant 2.1.150 modules T0_ (3891.js: PHK) and h5H (3863.js: He7 + uI8).
//
// PHK assembles the sandbox: it creates the vm context with the script-facing
// globals (agent/parallel/pipeline/log/phase/workflow/args/budget/console +
// abort-aware timers), injects the determinism + harden shims, and binds the
// context-local async-await unwrap. He7 implements workflow() — running a named
// or scriptPath child workflow inline as a sub-step, one nesting level only.

import vm from 'node:vm'
import { createWorkflowHooks } from './hooks.js'
import {
  applyDeterminismShim,
  compileWorkflowScript,
  createAbortAwareTimers,
  hardenContext,
  makeVMAwait,
  stripPrototype,
} from './sandbox.js'
import { parseWorkflowScript } from './metaParser.js'
import { readWorkflowScriptFile } from './paths.js'
import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'
import type { CanUseToolFn } from '@claude-code/repl/hooks/useCanUseTool.js'
import type {
  FrozenBudget,
  JournalState,
  TokenBudget,
  WorkflowHooks,
  WorkflowJournal,
  WorkflowProgressEvent,
} from './types.js'

// Label shown for a nested child workflow's phase group in /workflows. ant H0H.
const CHILD_WORKFLOW_LABEL = '↳'

// Prototype-pollution blocklist for keys (ant Sw3 — defence for any key-driven
// assignment inside the sandbox).
export const PROTO_POLLUTION_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
])

// ant uI8 — console shim that funnels console.* into log().
function makeConsoleShim(emit: (s: string) => void): {
  log: (...a: unknown[]) => void
  info: (...a: unknown[]) => void
  debug: (...a: unknown[]) => void
  error: (...a: unknown[]) => void
  warn: (...a: unknown[]) => void
} {
  const fmt = (args: unknown[]): string =>
    args
      .map(a => {
        if (typeof a === 'string') return a
        try {
          return JSON.stringify(a)
        } catch {
          return String(a)
        }
      })
      .join(' ')
  const mk =
    (prefix: string) =>
    (...args: unknown[]) =>
      emit(prefix + fmt(args))
  return {
    log: mk(''),
    info: mk(''),
    debug: mk(''),
    error: mk('[error] '),
    warn: mk('[warn] '),
  }
}

// Resolver for named workflows (builtin + .claude/workflows/). Supplied by the
// engine caller (P4/P5 wire the real registry). Returns the script source for
// a given name, or null if unknown.
export type NamedWorkflowResolver = (
  name: string,
) => Promise<{ name: string; script: string } | null>
export type AllWorkflowsLister = () => Promise<Array<{ name: string }>>

export type AssembleContextOptions = {
  toolUseContext: ToolUseContext
  canUseTool: CanUseToolFn
  onProgress: (e: WorkflowProgressEvent) => void
  workflowRunId: string
  onAgentController?: (
    agentId: string,
    controller: AbortController | null,
  ) => void
  seedPhaseTitles?: string[]
  tokenBudget?: TokenBudget
  args?: unknown
  journal?: WorkflowJournal
  journalState?: JournalState
  resolveNamedWorkflow?: NamedWorkflowResolver
  listAllWorkflows?: AllWorkflowsLister
}

export type AssembledContext = {
  vmContext: vm.Context
  hooks: WorkflowHooks
}

/**
 * ant PHK — assemble the workflow vm context + hooks.
 */
export function assembleWorkflowContext(
  opts: AssembleContextOptions,
): AssembledContext {
  const {
    toolUseContext,
    canUseTool,
    onProgress,
    workflowRunId,
    onAgentController,
    seedPhaseTitles,
    tokenBudget,
    args,
    journal,
    journalState,
    resolveNamedWorkflow,
    listAllWorkflows,
  } = opts

  // ant J — frozen budget surface for the script.
  const budget: FrozenBudget = Object.freeze({
    total: tokenBudget?.total ?? null,
    spent: stripPrototype(() => tokenBudget?.getTurnSpent() ?? 0),
    remaining: stripPrototype(() =>
      tokenBudget?.total == null
        ? Number.POSITIVE_INFINITY
        : Math.max(0, tokenBudget.total - tokenBudget.getTurnSpent()),
    ),
  })

  const hooks = createWorkflowHooks(
    toolUseContext,
    canUseTool,
    onProgress,
    workflowRunId,
    onAgentController,
    seedPhaseTitles,
    tokenBudget,
    budget,
    journal,
    journalState,
  )

  const abortSignal = toolUseContext.abortController?.signal
  const timers = createAbortAwareTimers(abortSignal)

  const consoleShim = makeConsoleShim(msg =>
    onProgress({
      type: 'progress',
      toolUseID: 'workflow_log',
      data: { type: 'workflow_log', message: msg },
    }),
  )

  // ant He7 — nested workflow() hook (one level deep; inner nest throws).
  const workflowHook = stripPrototype(
    async (nameOrRef: string | { scriptPath: string }, childArgs?: unknown) => {
      if (abortSignal?.aborted) throw new Error('Workflow aborted')
      let name: string
      let scriptBody: string
      if (typeof nameOrRef === 'string') {
        if (!resolveNamedWorkflow) {
          throw new Error('workflow(name): no named-workflow registry available')
        }
        const resolved = await resolveNamedWorkflow(nameOrRef)
        if (!resolved) {
          const available = listAllWorkflows
            ? (await listAllWorkflows()).map(w => w.name).join(', ')
            : ''
          throw new Error(
            `workflow('${nameOrRef}'): no workflow with that name. Available: ${available || '(none)'}`,
          )
        }
        const parsed = parseWorkflowScript(resolved.script)
        if ('error' in parsed) {
          throw new Error(`workflow('${nameOrRef}'): ${parsed.error}`)
        }
        name = resolved.name
        scriptBody = parsed.scriptBody
      } else if (
        nameOrRef &&
        typeof nameOrRef === 'object' &&
        typeof nameOrRef.scriptPath === 'string'
      ) {
        const read = await readWorkflowScriptFile(nameOrRef.scriptPath)
        if ('error' in read) {
          throw new Error(
            `workflow({scriptPath: '${nameOrRef.scriptPath}'}): ${read.error}`,
          )
        }
        const parsed = parseWorkflowScript(read.script)
        if ('error' in parsed) {
          throw new Error(
            `workflow({scriptPath: '${nameOrRef.scriptPath}'}): ${parsed.error}`,
          )
        }
        name = parsed.meta.name
        scriptBody = parsed.scriptBody
      } else {
        throw new TypeError(
          'workflow() expects a workflow name (string) or {scriptPath: string}',
        )
      }

      const compiled = compileWorkflowScript(scriptBody)
      if (compiled.ok === false) {
        throw new Error(`workflow('${name}'): ${compiled.error}`)
      }

      const childPhase = `${CHILD_WORKFLOW_LABEL} ${name}`
      hooks.resolvePhase(childPhase, 'child')
      hooks.log(`${CHILD_WORKFLOW_LABEL} running workflow ${name}`)
      const prefix = `[${name}] `

      // The child shares this run's hooks (agent counter, concurrency, abort,
      // budget), but pins every agent to the child phase group and prefixes its
      // logs. workflow() inside the child throws (one level only).
      const childGlobals = {
        agent: stripPrototype((p: string, o?: Record<string, unknown>) =>
          hooks.agent(p, { ...o, phase: childPhase }),
        ),
        parallel: hooks.parallel,
        pipeline: hooks.pipeline,
        budget,
        phase: stripPrototype((_t: string) => {}),
        log: stripPrototype((m: string) => hooks.log(prefix + String(m))),
        console: makeConsoleShim(m => hooks.log(prefix + m)),
        workflow: stripPrototype(() =>
          Promise.reject(
            new Error(
              'workflow() cannot be called from within a child workflow — nesting is limited to one level. Inline the inner script or call its agents directly.',
            ),
          ),
        ),
        args: childArgs,
        ...timers,
      }
      const childContext = vm.createContext(childGlobals)
      applyDeterminismShim(childContext)
      hardenContext(childContext)
      try {
        const childResult = await compiled.vmScript.runInContext(childContext, {
          timeout: 30_000,
        })
        const unwrapped = await childResult
        hooks.log(`${CHILD_WORKFLOW_LABEL} ${name} done`)
        return unwrapped
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        hooks.recordFailure(`${childPhase}: ${msg}`)
        hooks.log(`${CHILD_WORKFLOW_LABEL} ${name} failed: ${msg}`)
        throw e
      }
    },
  )

  const vmContext = vm.createContext({
    agent: hooks.agent,
    parallel: hooks.parallel,
    pipeline: hooks.pipeline,
    log: hooks.log,
    phase: hooks.phase,
    workflow: workflowHook,
    args,
    budget,
    console: consoleShim,
    ...timers,
  })

  applyDeterminismShim(vmContext)
  hardenContext(vmContext)
  hooks.bindVMAwait(makeVMAwait(vmContext))

  return { vmContext, hooks }
}
