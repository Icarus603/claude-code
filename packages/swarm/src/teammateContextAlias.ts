/**
 * TeammateContext — Runtime context for in-process teammates.
 *
 * AsyncLocalStorage-based context for in-process teammates, enabling
 * concurrent teammate execution without global state conflicts.
 *
 * Relationship with other teammate identity mechanisms:
 * - Env vars (CLAUDE_CODE_AGENT_ID): Process-based teammates spawned via tmux
 * - dynamicTeamContext (teammate.ts): Process-based teammates joining at runtime
 * - TeammateContext (this file): In-process teammates via AsyncLocalStorage
 *
 * The helper functions in teammate.ts check AsyncLocalStorage first, then
 * dynamicTeamContext, then env vars.
 *
 * SINGLETON WARNING: The AsyncLocalStorage slot below is a module-level
 * singleton. Consumers must route through this canonical file (or its
 * src/ facade) — never instantiate a second AsyncLocalStorage under the
 * same name.
 */

import { AsyncLocalStorage } from 'async_hooks'

/**
 * Runtime context for in-process teammates.
 * Stored in AsyncLocalStorage for concurrent access.
 */
export type TeammateContext = {
  /** Full agent ID, e.g., "researcher@my-team" */
  agentId: string
  /** Display name, e.g., "researcher" */
  agentName: string
  /** Team name this teammate belongs to */
  teamName: string
  /** UI color assigned to this teammate */
  color?: string
  /** Whether teammate must enter plan mode before implementing */
  planModeRequired: boolean
  /** Leader's session ID (for transcript correlation) */
  parentSessionId: string
  /** Discriminator - always true for in-process teammates */
  isInProcess: true
  /** Abort controller for lifecycle management (linked to parent) */
  abortController: AbortController
}

const teammateContextStorage = new AsyncLocalStorage<TeammateContext>()

/**
 * Get the current in-process teammate context, if running as one.
 * Returns undefined if not running within an in-process teammate context.
 */
export function getTeammateContext(): TeammateContext | undefined {
  return teammateContextStorage.getStore()
}

/**
 * Run a function with teammate context set.
 * Used when spawning an in-process teammate to establish its execution context.
 */
export function runWithTeammateContext<T>(
  context: TeammateContext,
  fn: () => T,
): T {
  return teammateContextStorage.run(context, fn)
}

/**
 * Check if current execution is within an in-process teammate.
 * Faster than `getTeammateContext() !== undefined` for simple checks.
 */
export function isInProcessTeammate(): boolean {
  return teammateContextStorage.getStore() !== undefined
}

/**
 * Create a TeammateContext from spawn configuration.
 * The abortController is passed in by the caller. For in-process teammates,
 * this is typically an independent controller (not linked to parent) so
 * teammates continue running when the leader's query is interrupted.
 */
export function createTeammateContext(config: {
  agentId: string
  agentName: string
  teamName: string
  color?: string
  planModeRequired: boolean
  parentSessionId: string
  abortController: AbortController
}): TeammateContext {
  return {
    ...config,
    isInProcess: true,
  }
}
