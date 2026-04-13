import { randomUUID } from 'crypto'
import { queryModelWithStreaming } from '@claude-code/provider/claudeLegacy'
import { getAgentHostBindings } from '../host.js'
import type {
  AgentMessage,
  AgentQuerySource,
  AgentToolUseContext,
} from '../internalTypes.js'

export type QueryDeps = {
  callModel: typeof queryModelWithStreaming
  microcompact: (
    messages: AgentMessage[],
    toolUseContext?: AgentToolUseContext,
    querySource?: AgentQuerySource,
  ) => Promise<{ messages: AgentMessage[]; [key: string]: unknown }>
  autocompact: (
    messages: AgentMessage[],
    toolUseContext: AgentToolUseContext,
    cacheSafeParams: unknown,
    querySource?: AgentQuerySource,
    tracking?: unknown,
    snipTokensFreed?: number,
  ) => Promise<{
    wasCompacted: boolean
    compactionResult?: unknown
    consecutiveFailures?: number
  }>
  uuid: () => string
}

export function productionDeps(): QueryDeps {
  return {
    callModel: queryModelWithStreaming,
    microcompact: async (messages, toolUseContext, querySource) =>
      (await getAgentHostBindings().microcompactMessages?.(
        messages,
        toolUseContext,
        querySource,
      )) ?? { messages },
    autocompact: async (
      messages,
      toolUseContext,
      cacheSafeParams,
      querySource,
      tracking,
      snipTokensFreed,
    ) =>
      (await getAgentHostBindings().autoCompactIfNeeded?.(
        messages,
        toolUseContext,
        cacheSafeParams,
        querySource,
        tracking,
        snipTokensFreed,
      )) ?? { wasCompacted: false },
    uuid: randomUUID,
  }
}
