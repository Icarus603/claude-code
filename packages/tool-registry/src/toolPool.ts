import { feature } from 'bun:bundle'
import partition from 'lodash-es/partition.js'
import uniqBy from 'lodash-es/uniqBy.js'
import { COORDINATOR_MODE_ALLOWED_TOOLS } from './toolConstants.js'
import { isMcpTool } from '@claude-code/mcp-runtime/utils.js'
import type { Tool, ToolPermissionContext, Tools } from './Tool.js'

// MCP tool name suffixes for PR activity subscription. These are lightweight
// orchestration actions the coordinator calls directly rather than delegating
// to workers. Matched by suffix since the MCP server name prefix may vary.
const PR_ACTIVITY_TOOL_SUFFIXES = [
  'subscribe_pr_activity',
  'unsubscribe_pr_activity',
]

export function isPrActivitySubscriptionTool(name: string): boolean {
  return PR_ACTIVITY_TOOL_SUFFIXES.some(suffix => name.endsWith(suffix))
}

// Dead code elimination: conditional imports for feature-gated modules
/* eslint-disable @typescript-eslint/no-require-imports */
const coordinatorModeModule = feature('COORDINATOR_MODE')
  ? (require('@claude-code/agent/coordinatorMode.js') as typeof import('@claude-code/agent/coordinatorMode.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Filters a tool array to the set allowed in coordinator mode.
 * Shared between the REPL path (mergeAndFilterTools) and the headless
 * path (main.tsx) so both stay in sync.
 *
 * PR activity subscription tools are always allowed since subscription
 * management is orchestration.
 */
export function applyCoordinatorToolFilter(tools: Tools): Tools {
  return tools.filter(
    t =>
      COORDINATOR_MODE_ALLOWED_TOOLS.has(t.name) ||
      isPrActivitySubscriptionTool(t.name),
  )
}

/**
 * Pure function that merges tool pools and applies coordinator mode filtering.
 *
 * Lives in a React-free file so print.ts can import it without pulling
 * react/ink into the SDK module graph. The useMergedTools hook delegates
 * to this function inside useMemo.
 */
export function mergeAndFilterTools(
  initialTools: Tools,
  assembled: Tools,
  mode: ToolPermissionContext['mode'],
): Tools {
  // Merge initialTools on top — they take precedence in deduplication.
  // Partition-sort for prompt-cache stability: built-ins must stay a
  // contiguous prefix for the server's cache policy.
  const [mcp, builtIn] = partition(
    uniqBy([...initialTools, ...assembled], 'name'),
    isMcpTool,
  )
  const byName = (a: Tool, b: Tool) => a.name.localeCompare(b.name)
  const tools = [...builtIn.sort(byName), ...mcp.sort(byName)]

  if (feature('COORDINATOR_MODE') && coordinatorModeModule) {
    if (coordinatorModeModule.isCoordinatorMode()) {
      return applyCoordinatorToolFilter(tools)
    }
  }

  return tools
}
