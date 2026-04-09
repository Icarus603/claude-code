import type { ClientOptions } from '@anthropic-ai/sdk'
import type {
  ProviderAgentDefinition,
  ProviderAgentId,
  ProviderEffortValue,
  ProviderNotification,
  ProviderQueryChainTracking,
  ProviderQuerySource,
  ProviderToolPermissionContext,
  ProviderTools,
} from './contracts.js'

export type ProviderRequestOptions = {
  getToolPermissionContext?: () => Promise<ProviderToolPermissionContext>
  model: string
  toolChoice?: import('@anthropic-ai/sdk/resources/beta/messages/messages.mjs').BetaToolChoiceTool | import('@anthropic-ai/sdk/resources/beta/messages/messages.mjs').BetaToolChoiceAuto | undefined
  isNonInteractiveSession: boolean
  extraToolSchemas?: import('@anthropic-ai/sdk/resources/beta/messages/messages.mjs').BetaToolUnion[]
  maxOutputTokensOverride?: number
  fallbackModel?: string
  onStreamingFallback?: () => void
  querySource: ProviderQuerySource
  agents?: readonly ProviderAgentDefinition[]
  allowedAgentTypes?: string[]
  hasAppendSystemPrompt: boolean
  fetchOverride?: ClientOptions['fetch']
  enablePromptCaching?: boolean
  skipCacheWrite?: boolean
  temperatureOverride?: number
  effortValue?: ProviderEffortValue
  mcpTools: ProviderTools
  hasPendingMcpServers?: boolean
  queryTracking?: ProviderQueryChainTracking
  agentId?: ProviderAgentId
  outputFormat?: import('@anthropic-ai/sdk/resources/beta/messages/messages.mjs').BetaJSONOutputFormat
  fastMode?: boolean
  advisorModel?: string
  addNotification?: (notif: ProviderNotification) => void
  taskBudget?: { total: number; remaining?: number }
}
