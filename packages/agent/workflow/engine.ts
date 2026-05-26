// Workflow engine entry. Port of ant 2.1.150 module WHK (3892.js: ZHK).
//
// Runs a compiled workflow vm.Script in a freshly-assembled sandbox context,
// racing the script's completion against the run's abort signal. Returns the
// script's return value plus run accounting (agent count, narrator logs,
// failures, duration). Never throws — a thrown script error is captured into
// the `error` field.

import vm from 'node:vm'
import { WORKFLOW_SYNC_TIMEOUT_MS } from './sandbox.js'
import {
  assembleWorkflowContext,
  type AssembleContextOptions,
} from './runtime.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import type { WorkflowJournal, WorkflowRunResult } from './types.js'

// ant _J3 — max narrator log lines retained in the result.
const MAX_RESULT_LOG_LINES = 1000

export type RunWorkflowOptions = Omit<
  AssembleContextOptions,
  'onProgress'
> & {
  onProgress: AssembleContextOptions['onProgress']
  /** ant K.syncTimeoutMs — caps the synchronous portion of the script. */
  syncTimeoutMs?: number
  journal?: WorkflowJournal
}

/**
 * ant ZHK — execute a compiled workflow script.
 *
 * @param vmScript  the compiled script (from compileWorkflowScript)
 * @param opts      context-assembly options + sync timeout
 */
export async function runWorkflow(
  vmScript: vm.Script,
  opts: RunWorkflowOptions,
): Promise<WorkflowRunResult> {
  const start = Date.now()
  const logs: string[] = []

  // Tee narrator log lines into the result (capped). The progress callback the
  // engine wraps lets the tool batch them into task state separately.
  const innerOnProgress = opts.onProgress
  const onProgress: AssembleContextOptions['onProgress'] = e => {
    if (
      e.type === 'progress' &&
      e.data.type === 'workflow_log' &&
      logs.length < MAX_RESULT_LOG_LINES
    ) {
      logs.push(e.data.message)
    }
    innerOnProgress(e)
  }

  const { vmContext, hooks } = assembleWorkflowContext({ ...opts, onProgress })

  const abortSignal = opts.toolUseContext.abortController?.signal
  let removeAbortListener: (() => void) | undefined

  try {
    const scriptValue = vmScript.runInContext(vmContext, {
      timeout: opts.syncTimeoutMs ?? WORKFLOW_SYNC_TIMEOUT_MS,
    })
    // The script body is an async IIFE — its synchronous evaluation returns a
    // Promise. Race it against abort.
    const scriptPromise = Promise.resolve(scriptValue)
    scriptPromise.catch(() => {}) // avoid unhandled-rejection if abort wins

    let result: unknown
    if (abortSignal) {
      result = await Promise.race([
        scriptPromise,
        new Promise((_resolve, reject) => {
          const onAbort = (): void => reject(new Error('Workflow aborted'))
          if (abortSignal.aborted) onAbort()
          else {
            abortSignal.addEventListener('abort', onAbort)
            removeAbortListener = () =>
              abortSignal.removeEventListener('abort', onAbort)
          }
        }),
      ])
    } else {
      result = await scriptPromise
    }

    // Deep-clone the result out of the vm realm so host-side consumers don't
    // hold references into the (frozen) sandbox.
    const cloned = structuredCloneSafe(result)
    // ant 3892 ZHK calls `IH(M)` (= JSON.stringify) on the cloned result before
    // returning — a serializability guard. structuredCloneSafe can fall back to
    // the raw value for non-cloneable inputs, so re-assert here: a result that
    // can't serialize must surface as a workflow error (caught below), not leak
    // a non-JSON value into the task notification.
    JSON.stringify(cloned)
    return {
      result: cloned,
      agentCount: hooks.getAgentCount(),
      logs,
      failures: hooks.getFailures(),
      durationMs: Date.now() - start,
    }
  } catch (e) {
    if (e instanceof Error && e.stack) {
      logForDebugging(`Workflow script error stack trace:\n${e.stack}`)
    }
    return {
      result: null,
      agentCount: hooks.getAgentCount(),
      logs,
      failures: hooks.getFailures(),
      durationMs: Date.now() - start,
      error: e instanceof Error ? e.message : String(e),
    }
  } finally {
    removeAbortListener?.()
  }
}

// ant cX — clone a value out of the sandbox realm. structuredClone handles
// plain data; fall back to a JSON round-trip for anything it rejects (e.g.
// values carrying non-cloneable props), and to the raw value as last resort.
function structuredCloneSafe(v: unknown): unknown {
  try {
    return structuredClone(v)
  } catch {
    try {
      return JSON.parse(JSON.stringify(v))
    } catch {
      return v
    }
  }
}
