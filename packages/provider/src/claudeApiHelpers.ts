import type Anthropic from '@anthropic-ai/sdk'
import type {
  BetaTool,
  BetaToolUnion,
} from '@anthropic-ai/sdk/resources/beta/messages/messages.mjs'
import { createHash } from 'crypto'
import { SYSTEM_PROMPT_DYNAMIC_BOUNDARY } from '@claude-code/agent/prompts.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '@claude-code/config/feature-flags'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import { CLI_SYSPROMPT_PREFIXES } from './systemConstants.js'
import type { Tool, ToolPermissionContext, Tools } from '@claude-code/tool-registry/Tool.js'
import { AGENT_TOOL_NAME } from '@claude-code/tool-registry/tools/AgentTool/constants.js'
import type { AgentDefinition } from '@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js'
import { EXIT_PLAN_MODE_V2_TOOL_NAME } from '@claude-code/tool-registry/tools/ExitPlanModeTool/constants.js'
import { TASK_OUTPUT_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskOutputTool/constants.js'
import { isAgentSwarmsEnabled } from '@claude-code/agent/agentSwarmsEnabled.js'
import {
  modelSupportsStructuredOutputs,
  shouldUseGlobalCacheScope,
} from './betas.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { isEnvTruthy, readEnv } from '@claude-code/config/env/utils'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
} from './providers.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import type { SystemPrompt } from './systemPromptType.js'
import { getToolSchemaCache } from '@claude-code/tool-registry/toolSchemaCache.js'
import { zodToJsonSchema } from './zodToJsonSchema.js'

// Extended BetaTool type with strict mode and defer_loading support
type BetaToolWithExtras = BetaTool & {
  strict?: boolean
  defer_loading?: boolean
  cache_control?: {
    type: 'ephemeral'
    scope?: 'global' | 'org'
    ttl?: '5m' | '1h'
  }
  eager_input_streaming?: boolean
}

export type CacheScope = 'global' | 'org'
export type SystemPromptBlock = {
  text: string
  cacheScope: CacheScope | null
}

// Fields to filter from tool schemas when swarms are not enabled
const SWARM_FIELDS_BY_TOOL: Record<string, string[]> = {
  [EXIT_PLAN_MODE_V2_TOOL_NAME]: ['launchSwarm', 'teammateCount'],
  [AGENT_TOOL_NAME]: ['name', 'team_name', 'mode'],
}

/**
 * Filter swarm-related fields from a tool's input schema.
 * Called at runtime when isAgentSwarmsEnabled() returns false.
 */
function filterSwarmFieldsFromSchema(
  toolName: string,
  schema: Anthropic.Tool.InputSchema,
): Anthropic.Tool.InputSchema {
  const fieldsToRemove = SWARM_FIELDS_BY_TOOL[toolName]
  if (!fieldsToRemove || fieldsToRemove.length === 0) {
    return schema
  }

  // Clone the schema to avoid mutating the original
  const filtered = { ...schema }
  const props = filtered.properties
  if (props && typeof props === 'object') {
    const filteredProps = { ...(props as Record<string, unknown>) }
    for (const field of fieldsToRemove) {
      delete filteredProps[field]
    }
    filtered.properties = filteredProps
  }

  return filtered
}

export async function toolToAPISchema(
  tool: Tool,
  options: {
    getToolPermissionContext: () => Promise<ToolPermissionContext>
    tools: Tools
    agents: AgentDefinition[]
    allowedAgentTypes?: string[]
    model?: string
    /** When true, mark this tool with defer_loading for tool search */
    deferLoading?: boolean
    cacheControl?: {
      type: 'ephemeral'
      scope?: 'global' | 'org'
      ttl?: '5m' | '1h'
    }
  },
): Promise<BetaToolUnion> {
  // Session-stable base schema: name, description, input_schema, strict,
  // eager_input_streaming. These are computed once per session and cached to
  // prevent mid-session GrowthBook flips (tengu_tool_pear, tengu_fgts) or
  // tool.prompt() drift from churning the serialized tool array bytes.
  // See toolSchemaCache.ts for rationale.
  //
  // Cache key includes inputJSONSchema when present. StructuredOutput instances
  // share the name 'StructuredOutput' but carry different schemas per workflow
  // call — name-only keying returned a stale schema (5.4% → 51% err rate, see
  // PR#25424). MCP tools also set inputJSONSchema but each has a stable schema,
  // so including it preserves their GB-flip cache stability.
  const cacheKey =
    'inputJSONSchema' in tool && tool.inputJSONSchema
      ? `${tool.name}:${jsonStringify(tool.inputJSONSchema)}`
      : tool.name
  const cache = getToolSchemaCache()
  let base = cache.get(cacheKey)
  if (!base) {
    const strictToolsEnabled =
      checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_tool_pear')
    // Use tool's JSON schema directly if provided, otherwise convert Zod schema
    let input_schema = (
      'inputJSONSchema' in tool && tool.inputJSONSchema
        ? tool.inputJSONSchema
        : zodToJsonSchema(tool.inputSchema)
    ) as Anthropic.Tool.InputSchema

    // Filter out swarm-related fields when swarms are not enabled
    // This ensures external non-EAP users don't see swarm features in the schema
    if (!isAgentSwarmsEnabled()) {
      input_schema = filterSwarmFieldsFromSchema(tool.name, input_schema)
    }

    base = {
      name: tool.name,
      description: await tool.prompt({
        getToolPermissionContext: options.getToolPermissionContext,
        tools: options.tools,
        agents: options.agents,
        allowedAgentTypes: options.allowedAgentTypes,
      }),
      input_schema,
    }

    // Only add strict if:
    // 1. Feature flag is enabled
    // 2. Tool has strict: true
    // 3. Model is provided and supports it (not all models support it right now)
    //    (if model is not provided, assume we can't use strict tools)
    if (
      strictToolsEnabled &&
      tool.strict === true &&
      options.model &&
      modelSupportsStructuredOutputs(options.model)
    ) {
      base.strict = true
    }

    // Enable fine-grained tool streaming via per-tool API field.
    // Without FGTS, the API buffers entire tool input parameters before sending
    // input_json_delta events, causing multi-minute hangs on large tool inputs.
    // Gated to direct api.anthropic.com: proxies (LiteLLM etc.) and Bedrock/Vertex
    // with Claude 4.5 reject this field with 400. See GH#32742, PR #21729.
    if (
      getAPIProvider() === 'firstParty' &&
      isFirstPartyAnthropicBaseUrl() &&
      (getFeatureValue_CACHED_MAY_BE_STALE('tengu_fgts', false) ||
        isEnvTruthy(readEnv('CLAUDE_CODE_ENABLE_FINE_GRAINED_TOOL_STREAMING')))
    ) {
      base.eager_input_streaming = true
    }

    cache.set(cacheKey, base)
  }

  // Per-request overlay: defer_loading and cache_control vary by call
  // (tool search defers different tools per turn; cache markers move).
  // Explicit field copy avoids mutating the cached base and sidesteps
  // BetaTool.cache_control's `| null` clashing with our narrower type.
  const schema: BetaToolWithExtras = {
    name: base.name,
    description: base.description,
    input_schema: base.input_schema,
    ...(base.strict && { strict: true }),
    ...(base.eager_input_streaming && { eager_input_streaming: true }),
  }

  // Add defer_loading if requested (for tool search feature)
  if (options.deferLoading) {
    schema.defer_loading = true
  }

  if (options.cacheControl) {
    schema.cache_control = options.cacheControl
  }

  // CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS is the kill switch for beta API
  // shapes. Proxy gateways (ANTHROPIC_BASE_URL → LiteLLM → Bedrock) reject
  // fields like defer_loading with "Extra inputs are not permitted". The gates
  // above each field are scattered and not all provider-aware, so this strips
  // everything not in the base-tool allowlist at the one choke point all tool
  // schemas pass through — including fields added in the future.
  // cache_control is allowlisted: the base {type: 'ephemeral'} shape is
  // standard prompt caching (Bedrock/Vertex supported); the beta sub-fields
  // (scope, ttl) are already gated upstream by shouldIncludeFirstPartyOnlyBetas
  // which independently respects this kill switch.
  // github.com/anthropics/claude-code/issues/20031
  if (isEnvTruthy(readEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'))) {
    const allowed = new Set([
      'name',
      'description',
      'input_schema',
      'cache_control',
    ])
    const stripped = Object.keys(schema).filter(k => !allowed.has(k))
    if (stripped.length > 0) {
      logStripOnce(stripped)
      return {
        name: schema.name,
        description: schema.description,
        input_schema: schema.input_schema,
        ...(schema.cache_control && { cache_control: schema.cache_control }),
      }
    }
  }

  // Note: We cast to BetaTool but the extra fields are still present at runtime
  // and will be serialized in the API request, even though they're not in the SDK's
  // BetaTool type definition. This is intentional for beta features.
  return schema as BetaTool
}

let loggedStrip = false
function logStripOnce(stripped: string[]): void {
  if (loggedStrip) return
  loggedStrip = true
  logForDebugging(
    `[betas] Stripped from tool schemas: [${stripped.join(', ')}] (CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS=1)`,
  )
}

/**
 * Log stats about first block for analyzing prefix matching config
 * (see https://console.statsig.com/4aF3Ewatb6xPVpCwxb5nA3/dynamic_configs/claude_cli_system_prompt_prefixes)
 */
export function logAPIPrefix(systemPrompt: SystemPrompt): void {
  const [firstSyspromptBlock] = splitSysPromptPrefix(systemPrompt)
  const firstSystemPrompt = firstSyspromptBlock?.text
  logEvent('tengu_sysprompt_block', {
    snippet: firstSystemPrompt?.slice(
      0,
      20,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    length: firstSystemPrompt?.length ?? 0,
    hash: (firstSystemPrompt
      ? createHash('sha256').update(firstSystemPrompt).digest('hex')
      : '') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * Split system prompt blocks by content type for API matching and cache control.
 * See https://console.statsig.com/4aF3Ewatb6xPVpCwxb5nA3/dynamic_configs/claude_cli_system_prompt_prefixes
 *
 * Behavior depends on feature flags and options:
 *
 * 1. MCP tools present (skipGlobalCacheForSystemPrompt=true):
 *    Returns up to 3 blocks with org-level caching (no global cache on system prompt):
 *    - Attribution header (cacheScope=null)
 *    - System prompt prefix (cacheScope='org')
 *    - Everything else concatenated (cacheScope='org')
 *
 * 2. Global cache mode with boundary marker (1P only, boundary found):
 *    Returns up to 4 blocks:
 *    - Attribution header (cacheScope=null)
 *    - System prompt prefix (cacheScope=null)
 *    - Static content before boundary (cacheScope='global')
 *    - Dynamic content after boundary (cacheScope=null)
 *
 * 3. Default mode (3P providers, or boundary missing):
 *    Returns up to 3 blocks with org-level caching:
 *    - Attribution header (cacheScope=null)
 *    - System prompt prefix (cacheScope='org')
 *    - Everything else concatenated (cacheScope='org')
 */
export function splitSysPromptPrefix(
  systemPrompt: SystemPrompt,
  options?: { skipGlobalCacheForSystemPrompt?: boolean },
): SystemPromptBlock[] {
  const useGlobalCacheFeature = shouldUseGlobalCacheScope()
  if (useGlobalCacheFeature && options?.skipGlobalCacheForSystemPrompt) {
    logEvent('tengu_sysprompt_using_tool_based_cache', {
      promptBlockCount: systemPrompt.length,
    })

    // Filter out boundary marker, return blocks without global scope
    let attributionHeader: string | undefined
    let systemPromptPrefix: string | undefined
    const rest: string[] = []

    for (const prompt of systemPrompt) {
      if (!prompt) continue
      if (prompt === SYSTEM_PROMPT_DYNAMIC_BOUNDARY) continue // Skip boundary
      if (prompt.startsWith('x-anthropic-billing-header')) {
        attributionHeader = prompt
      } else if (CLI_SYSPROMPT_PREFIXES.has(prompt)) {
        systemPromptPrefix = prompt
      } else {
        rest.push(prompt)
      }
    }

    const result: SystemPromptBlock[] = []
    if (attributionHeader) {
      result.push({ text: attributionHeader, cacheScope: null })
    }
    if (systemPromptPrefix) {
      result.push({ text: systemPromptPrefix, cacheScope: 'org' })
    }
    const restJoined = rest.join('\n\n')
    if (restJoined) {
      result.push({ text: restJoined, cacheScope: 'org' })
    }
    return result
  }

  if (useGlobalCacheFeature) {
    const boundaryIndex = systemPrompt.indexOf(
      SYSTEM_PROMPT_DYNAMIC_BOUNDARY,
    )
    if (boundaryIndex !== -1) {
      let attributionHeader: string | undefined
      let systemPromptPrefix: string | undefined
      const staticBlocks: string[] = []
      const dynamicBlocks: string[] = []

      for (let i = 0; i < systemPrompt.length; i++) {
        const block = systemPrompt[i]
        if (!block || block === SYSTEM_PROMPT_DYNAMIC_BOUNDARY) continue

        if (block.startsWith('x-anthropic-billing-header')) {
          attributionHeader = block
        } else if (CLI_SYSPROMPT_PREFIXES.has(block)) {
          systemPromptPrefix = block
        } else if (i < boundaryIndex) {
          staticBlocks.push(block)
        } else {
          dynamicBlocks.push(block)
        }
      }

      const result: SystemPromptBlock[] = []
      if (attributionHeader)
        result.push({ text: attributionHeader, cacheScope: null })
      if (systemPromptPrefix)
        result.push({ text: systemPromptPrefix, cacheScope: null })
      const staticJoined = staticBlocks.join('\n\n')
      if (staticJoined)
        result.push({ text: staticJoined, cacheScope: 'global' })
      const dynamicJoined = dynamicBlocks.join('\n\n')
      if (dynamicJoined) result.push({ text: dynamicJoined, cacheScope: null })

      logEvent('tengu_sysprompt_boundary_found', {
        blockCount: result.length,
        staticBlockLength: staticJoined.length,
        dynamicBlockLength: dynamicJoined.length,
      })

      return result
    } else {
      logEvent('tengu_sysprompt_missing_boundary_marker', {
        promptBlockCount: systemPrompt.length,
      })
    }
  }
  let attributionHeader: string | undefined
  let systemPromptPrefix: string | undefined
  const rest: string[] = []

  for (const block of systemPrompt) {
    if (!block) continue

    if (block.startsWith('x-anthropic-billing-header')) {
      attributionHeader = block
    } else if (CLI_SYSPROMPT_PREFIXES.has(block)) {
      systemPromptPrefix = block
    } else {
      rest.push(block)
    }
  }

  const result: SystemPromptBlock[] = []
  if (attributionHeader)
    result.push({ text: attributionHeader, cacheScope: null })
  if (systemPromptPrefix)
    result.push({ text: systemPromptPrefix, cacheScope: 'org' })
  const restJoined = rest.join('\n\n')
  if (restJoined) result.push({ text: restJoined, cacheScope: 'org' })
  return result
}
