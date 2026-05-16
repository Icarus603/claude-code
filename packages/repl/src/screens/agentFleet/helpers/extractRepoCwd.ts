/**
 * Resolve a free-text token to a directory that lives in the agent
 * registry (a known repo or path).
 *
 * Source: ant zi8 (5092.js:688-698) + ms3 (5092.js:676-683).
 *
 * Scans the query for `@name` tokens; if `name` matches an entry in
 * `agentMap` AND that agent has a `cwd`, returns it. Otherwise undefined.
 *
 * Used by the dispatch flow so `@my-agent fix the bug` can route to the
 * correct working tree.
 */

import type { ResolvedAgent } from '@claude-code/tool-registry/tools/AgentTool/agentDisplay.js'

const AT_REF_RE = /(?:^|\s)@(\S+)/g

interface AgentLike {
  name: string
  cwd?: string
}

/** Source: ant zi8. */
export function extractRepoCwd<T extends AgentLike | ResolvedAgent>(
  query: string,
  agentMap: Record<string, T>,
  fleetAgents: readonly { name: string }[] = [],
): T | undefined {
  const seenAgentNames = new Set(fleetAgents.map(a => a.name.toLowerCase()))
  const keys = Object.keys(agentMap)
  for (const match of query.matchAll(AT_REF_RE)) {
    const name = match[1].toLowerCase()
    if (seenAgentNames.has(name)) continue
    const key = keys.find(k => k.toLowerCase() === name)
    if (key !== undefined) return agentMap[key]
  }
  return undefined
}
