// Worktree isolation for workflow agents — extracted from hooks.ts to keep that
// file under the LOC budget. Port of ant 2.1.150 3886's
// `if(isolation==="worktree"){MH=await X(pH)}` create + post-run cleanup, where
// `X = ElH(1, RyH)` is the worktree creator behind a concurrency-1 semaphore.
//
// ccb reuses the swarm worktree subsystem (createAgentWorktree / hasWorktree
// Changes / removeAgentWorktree) — the same primitives AgentTool uses for its
// own isolation — so behavior matches a normal isolated subagent.

import { createAgentId } from '../uuid.js'
import {
  createAgentWorktree,
  hasWorktreeChanges,
  removeAgentWorktree,
} from '@claude-code/swarm'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

// ant ElH(1, RyH) — worktree creation is serialized through a concurrency-1
// semaphore. Two `git worktree add` racing in the same repo corrupt each
// other's index/lock, so every agent({isolation:'worktree'}) creation queues
// here even when the agents themselves run in parallel. A plain promise chain
// is the concurrency-1 case of ant's ElH counting semaphore. Module-level so
// every workflow run in the process shares the one git-worktree lock.
let worktreeCreateChain: Promise<unknown> = Promise.resolve()
function serializeWorktreeCreate<T>(fn: () => Promise<T>): Promise<T> {
  const next = worktreeCreateChain.then(fn, fn)
  // Keep the chain alive regardless of this creation's success/failure.
  worktreeCreateChain = next.then(
    () => undefined,
    () => undefined,
  )
  return next
}

export type WorkflowWorktree = {
  /** Pass to runAgent + use as the cwd override for the agent's run. */
  worktreePath: string
  /**
   * Remove the worktree unless the agent left uncommitted changes (then keep it
   * for review), mirroring AgentTool. Best-effort — never throws.
   */
  cleanup: () => Promise<void>
}

/**
 * ant 3886 worktree create branch. Returns null when no isolation is requested.
 * Throws (with a clear message) if worktree creation fails — the agent should
 * not silently run in the main tree when the user asked for isolation.
 */
export async function setupWorkflowAgentWorktree(
  index: number,
  label: string,
  log: (msg: string) => void,
): Promise<WorkflowWorktree> {
  const slug = `wf-${index}-${createAgentId().slice(0, 8)}`
  let worktree: {
    worktreePath: string
    worktreeBranch?: string
    headCommit?: string
    gitRoot?: string
  }
  try {
    worktree = await serializeWorktreeCreate(() => createAgentWorktree(slug))
  } catch (e) {
    throw new Error(
      `agent({isolation:'worktree'}): failed to create worktree: ${e instanceof Error ? e.message : String(e)}`,
    )
  }
  log(`[worktree] agent "${label}" isolated at ${worktree.worktreePath}`)

  return {
    worktreePath: worktree.worktreePath,
    async cleanup() {
      try {
        const changed = await hasWorktreeChanges(
          worktree.worktreePath,
          worktree.headCommit,
        )
        if (!changed) {
          await removeAgentWorktree(
            worktree.worktreePath,
            worktree.worktreeBranch,
            worktree.gitRoot,
          )
          log(`[worktree] agent "${label}" worktree removed (no changes)`)
        } else {
          log(
            `[worktree] agent "${label}" worktree kept (has changes): ${worktree.worktreePath}`,
          )
        }
      } catch (e) {
        logForDebugging(`workflow worktree cleanup failed: ${e}`)
      }
    },
  }
}
