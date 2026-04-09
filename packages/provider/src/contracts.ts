import type { ClientOptions } from '@anthropic-ai/sdk'
import type {
  BetaToolUnion,
  BetaUsage,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import type { ContentBlock, ContentBlockParam } from '@anthropic-ai/sdk/resources/index.mjs'
import type { UUID } from 'crypto'

export type ProviderAPIProvider =
  | 'firstParty'
  | 'bedrock'
  | 'vertex'
  | 'foundry'
  | 'openai'
  | 'gemini'
  | 'grok'

export type ProviderModelOption = {
  value: string | null
  label: string
  description: string
  descriptionForModel?: string
}

export type ProviderSystemPrompt = readonly string[] & {
  readonly __brand?: 'SystemPrompt'
}

export type ProviderThinkingConfig =
  | { type: 'adaptive' }
  | { type: 'enabled'; budgetTokens: number }
  | { type: 'disabled' }

export type ProviderMessageType =
  | 'user'
  | 'assistant'
  | 'system'
  | 'attachment'
  | 'progress'
  | 'grouped_tool_use'
  | 'collapsed_read_search'

export type ProviderMessageContent = string | ContentBlockParam[] | ContentBlock[]

export type ProviderMessage = {
  type: ProviderMessageType
  uuid: UUID | string
  isMeta?: boolean
  isCompactSummary?: boolean
  toolUseResult?: unknown
  isVisibleInTranscriptOnly?: boolean
  attachment?: { type: string; toolUseID?: string; [key: string]: unknown }
  message?: {
    role?: string
    id?: string
    content?: ProviderMessageContent
    usage?: BetaUsage | Record<string, unknown>
    [key: string]: unknown
  }
  [key: string]: unknown
}

export type ProviderAssistantMessage = ProviderMessage & { type: 'assistant' }
export type ProviderUserMessage = ProviderMessage & { type: 'user' }
export type ProviderSystemAPIErrorMessage = ProviderMessage & {
  type: 'system'
}
export type ProviderStreamEvent = {
  type: string
  [key: string]: unknown
}

export type ProviderQueryChainTracking = {
  chainId: string
  depth: number
}

export type ProviderToolPermissionContext = {
  mode?: string
  additionalWorkingDirectories?: Map<string, unknown>
  alwaysAllowRules?: Record<string, unknown>
  alwaysDenyRules?: Record<string, unknown>
  alwaysAskRules?: Record<string, unknown>
  isBypassPermissionsModeAvailable?: boolean
  [key: string]: unknown
}

export function getEmptyProviderToolPermissionContext(): ProviderToolPermissionContext {
  return {
    mode: 'default',
    additionalWorkingDirectories: new Map(),
    alwaysAllowRules: {},
    alwaysDenyRules: {},
    alwaysAskRules: {},
    isBypassPermissionsModeAvailable: false,
  }
}

export type ProviderTool = {
  name: string
  aliases?: string[]
  alwaysLoad?: boolean
  isMcp?: boolean
  shouldDefer?: boolean
  [key: string]: unknown
}

export type ProviderTools = readonly ProviderTool[]

export function providerToolMatchesName(
  tool: Pick<ProviderTool, 'name' | 'aliases'>,
  name: string,
): boolean {
  return tool.name === name || (tool.aliases?.includes(name) ?? false)
}

export type ProviderQuerySource = string
export type ProviderAgentDefinition = {
  agentType: string
  source: string
  [key: string]: unknown
}
export type ProviderAgentId = string & { readonly __brand: 'AgentId' }
export type ProviderEffortValue = string | number
export type ProviderNotification = {
  key: string
  priority: string
  [key: string]: unknown
}

export type ProviderToolSchemaOptions = {
  getToolPermissionContext?: () => Promise<ProviderToolPermissionContext>
  tools: ProviderTools
  agents: readonly ProviderAgentDefinition[]
  allowedAgentTypes?: string[]
  model?: string
  deferLoading?: boolean
  cacheControl?: {
    type: 'ephemeral'
    scope?: 'global' | 'org'
    ttl?: '5m' | '1h'
  }
}

export type ProviderDebugOptions = {
  level?: string
  [key: string]: unknown
}

export type ProviderOAuthTokens = {
  accessToken?: string | null
  [key: string]: unknown
} | null

export type ProviderOauthConfig = {
  BASE_API_URL: string
  [key: string]: unknown
}

export type ProviderAwsCredentials = {
  accessKeyId: string
  secretAccessKey: string
  sessionToken?: string
  [key: string]: unknown
}

export type ProviderSafeParseJSONFn = ((
  json: string,
  shouldLogError?: boolean,
) => unknown) & {
  cache: {
    clear(): void
    size?(): number
    delete?(key: string): boolean
    get?(key: string): unknown
    has?(key: string): boolean
  }
}

export type ProviderCachedAsyncFn<T> = (() => Promise<T>) & {
  cache: {
    clear(): void
  }
}

export type ProviderClientFetch = ClientOptions['fetch']
export type ProviderToolSchema = BetaToolUnion
