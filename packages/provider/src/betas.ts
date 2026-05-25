import { feature } from 'bun:bundle'
import memoize from 'lodash-es/memoize.js'
import {
  checkStatsigFeatureGate_CACHED_MAY_BE_STALE,
  getFeatureValue_CACHED_MAY_BE_STALE,
} from '@claude-code/config/feature-flags'
import {
  getIsNonInteractiveSession,
  getSdkBetas,
} from '@claude-code/app-host/bootstrap/state.js'
import {
  BEDROCK_EXTRA_PARAMS_HEADERS,
  CLAUDE_CODE_20250219_BETA_HEADER,
  CLI_INTERNAL_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
  LN_BETA_HEADER,
  MID_CONVERSATION_SYSTEM_BETA_HEADER,
  PROMPT_CACHING_SCOPE_BETA_HEADER,
  REDACT_THINKING_BETA_HEADER,
  STRUCTURED_OUTPUTS_BETA_HEADER,
  TOKEN_EFFICIENT_TOOLS_BETA_HEADER,
  TOOL_SEARCH_BETA_HEADER_1P,
  TOOL_SEARCH_BETA_HEADER_3P,
  WEB_SEARCH_BETA_HEADER,
} from './betasConstants.js'
import { OAUTH_BETA_HEADER } from './oauthConstants.js'
import { isClaudeAISubscriber } from './authAlias.js'
import { has1mContext } from '@claude-code/agent/context.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '@claude-code/config/env/utils'
import { getCanonicalName } from './model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import { getAPIProvider } from './providers.js'
import { getInitialSettings } from '@claude-code/config/settings'
import { readEnv } from '@claude-code/config/env/utils'

/**
 * SDK-provided betas that are allowed for API key users.
 * Only betas in this list can be passed via SDK options.
 */
const ALLOWED_SDK_BETAS = [CONTEXT_1M_BETA_HEADER]

/**
 * Filter betas to only include those in the allowlist.
 * Returns allowed and disallowed betas separately.
 */
function partitionBetasByAllowlist(betas: string[]): {
  allowed: string[]
  disallowed: string[]
} {
  const allowed: string[] = []
  const disallowed: string[] = []
  for (const beta of betas) {
    if (ALLOWED_SDK_BETAS.includes(beta)) {
      allowed.push(beta)
    } else {
      disallowed.push(beta)
    }
  }
  return { allowed, disallowed }
}

/**
 * Filter SDK betas to only include allowed ones.
 * Warns about disallowed betas and subscriber restrictions.
 * Returns undefined if no valid betas remain or if user is a subscriber.
 */
export function filterAllowedSdkBetas(
  sdkBetas: string[] | undefined,
): string[] | undefined {
  if (!sdkBetas || sdkBetas.length === 0) {
    return undefined
  }

  if (isClaudeAISubscriber()) {
    console.warn(
      'Warning: Custom betas are only available for API key users. Ignoring provided betas.',
    )
    return undefined
  }

  const { allowed, disallowed } = partitionBetasByAllowlist(sdkBetas)
  for (const beta of disallowed) {
    console.warn(
      `Warning: Beta header '${beta}' is not allowed. Only the following betas are supported: ${ALLOWED_SDK_BETAS.join(', ')}`,
    )
  }
  return allowed.length > 0 ? allowed : undefined
}

/**
 * Port of ant v2.1.136 `hQ_` (YG / 1989.js). Predicates whether the current
 * model should opt into the `mid-conversation-system-2026-04-07` beta.
 *
 * Activation order:
 *   1. env `CLAUDE_CODE_MID_CONVERSATION_SYSTEM` — value is matched as a
 *      substring of the model id. Useful for local pinning.
 *   2. GrowthBook flag `tengu_fennel_kite_model` — same substring semantics.
 *      ant's cache-aware lookup is collapsed into a single getFeatureValue
 *      call here since ccb doesn't expose the dual path.
 *
 * Returns false by default. Provider must be firstParty / foundry — the
 * server-side gate doesn't exist on Bedrock/Vertex/3P routes.
 */
export function isMidConversationSystemEnabled(model: string): boolean {
  const provider = getAPIProvider()
  if (provider !== 'firstParty' && provider !== 'foundry') return false

  const canonical = getCanonicalName(model)

  const envValue = readEnv('CLAUDE_CODE_MID_CONVERSATION_SYSTEM')
  if (envValue && canonical.includes(envValue)) return true

  const flagValue = getFeatureValue_CACHED_MAY_BE_STALE<string>(
    'tengu_fennel_kite_model',
    '',
  )
  if (typeof flagValue === 'string' && flagValue.length > 0) {
    return canonical.includes(flagValue)
  }

  return false
}

export function modelSupportsISP(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(
    model,
    'interleaved_thinking',
  )
  if (supported3P !== undefined) {
    return supported3P
  }
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  if (provider === 'foundry') {
    return true
  }
  if (provider === 'firstParty') {
    return !canonical.includes('claude-3-')
  }
  return (
    canonical.includes('claude-opus-4') || canonical.includes('claude-sonnet-4')
  )
}

function vertexModelSupportsWebSearch(model: string): boolean {
  const canonical = getCanonicalName(model)
  return (
    canonical.includes('claude-opus-4') ||
    canonical.includes('claude-sonnet-4') ||
    canonical.includes('claude-haiku-4')
  )
}

// Context management is supported on Claude 4+ models
export function modelSupportsContextManagement(model: string): boolean {
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  if (provider === 'foundry') {
    return true
  }
  if (provider === 'firstParty') {
    return !canonical.includes('claude-3-')
  }
  return (
    canonical.includes('claude-opus-4') ||
    canonical.includes('claude-sonnet-4') ||
    canonical.includes('claude-haiku-4')
  )
}

// @[MODEL LAUNCH]: Add the new model ID to this list if it supports structured outputs.
export function modelSupportsStructuredOutputs(model: string): boolean {
  const canonical = getCanonicalName(model)
  const provider = getAPIProvider()
  if (provider !== 'firstParty' && provider !== 'foundry') {
    return false
  }
  return (
    canonical.includes('claude-sonnet-4-6') ||
    canonical.includes('claude-sonnet-4-5') ||
    canonical.includes('claude-opus-4-1') ||
    canonical.includes('claude-opus-4-5') ||
    canonical.includes('claude-opus-4-6') ||
    canonical.includes('claude-opus-4-7') ||
    canonical.includes('claude-haiku-4-5')
  )
}

// @[MODEL LAUNCH]: Add the new model if it supports auto mode.
// ccb: relaxed for fork — auto mode is gated only on (a) the build flag and
// (b) excluding legacy Claude models that lack the tool-use behavior the
// classifier relies on. All providers (firstParty, bedrock, vertex, openai,
// gemini, etc.) are allowed; users who pick a 3P provider accept that
// classifier quality may vary.
export function modelSupportsAutoMode(model: string): boolean {
  if (!feature('TRANSCRIPT_CLASSIFIER')) return false
  const m = getCanonicalName(model)
  const config = getFeatureValue_CACHED_MAY_BE_STALE<{
    allowModels?: string[]
  }>('tengu_auto_mode_config', {})
  const rawLower = model.toLowerCase()
  if (
    config?.allowModels?.some(
      am => am.toLowerCase() === rawLower || am.toLowerCase() === m,
    )
  ) {
    return true
  }
  if (m.includes('claude-3-')) return false
  if (/claude-(opus|sonnet|haiku)-4(?!-[6-9])/.test(m)) return false
  return true
}

/**
 * Get the correct tool search beta header for the current API provider.
 * - Claude API / Foundry: advanced-tool-use-2025-11-20
 * - Vertex AI / Bedrock: tool-search-tool-2025-10-19
 */
export function getToolSearchBetaHeader(): string {
  const provider = getAPIProvider()
  if (provider === 'vertex' || provider === 'bedrock') {
    return TOOL_SEARCH_BETA_HEADER_3P
  }
  return TOOL_SEARCH_BETA_HEADER_1P
}

export function shouldIncludeFirstPartyOnlyBetas(): boolean {
  return (
    (getAPIProvider() === 'firstParty' || getAPIProvider() === 'foundry') &&
    !isEnvTruthy(readEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'))
  )
}

export function shouldUseGlobalCacheScope(): boolean {
  return (
    getAPIProvider() === 'firstParty' &&
    !isEnvTruthy(readEnv('CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS'))
  )
}

export const getAllModelBetas = memoize((model: string): string[] => {
  const betaHeaders = []
  const isHaiku = getCanonicalName(model).includes('haiku')
  const provider = getAPIProvider()
  const includeFirstPartyOnlyBetas = shouldIncludeFirstPartyOnlyBetas()

  if (!isHaiku) {
    betaHeaders.push(CLAUDE_CODE_20250219_BETA_HEADER)
    if (
      process.env.USER_TYPE === 'ant' &&
      readEnv('CLAUDE_CODE_ENTRYPOINT') === 'cli'
    ) {
      if (CLI_INTERNAL_BETA_HEADER) {
        betaHeaders.push(CLI_INTERNAL_BETA_HEADER)
      }
    }
  }
  if (isClaudeAISubscriber()) {
    betaHeaders.push(OAUTH_BETA_HEADER)
  }
  if (has1mContext(model)) {
    betaHeaders.push(CONTEXT_1M_BETA_HEADER)
  }
  if (
    !isEnvTruthy(readEnv('DISABLE_INTERLEAVED_THINKING')) &&
    modelSupportsISP(model)
  ) {
    betaHeaders.push(INTERLEAVED_THINKING_BETA_HEADER)
  }

  if (
    includeFirstPartyOnlyBetas &&
    modelSupportsISP(model) &&
    !getIsNonInteractiveSession() &&
    getInitialSettings().showThinkingSummaries !== true
  ) {
    betaHeaders.push(REDACT_THINKING_BETA_HEADER)
  }

  // ant 2005.js (v2.1.150) — ln beta gate. Mirrors the redact-thinking
  // predicate (firstParty/experimental + ISP + interactive) but with the
  // server-side `tengu_ln` flag (default off) as the final gate instead of
  // the showThinkingSummaries setting:
  //   if (ul_ && O && H38(H) && !h8() && k_("tengu_ln", !1)) _.push(ul_)
  if (
    includeFirstPartyOnlyBetas &&
    modelSupportsISP(model) &&
    !getIsNonInteractiveSession() &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_ln', false)
  ) {
    betaHeaders.push(LN_BETA_HEADER)
  }

  const antOptedIntoToolClearing =
    isEnvTruthy(readEnv('USE_API_CONTEXT_MANAGEMENT')) &&
    process.env.USER_TYPE === 'ant'

  const thinkingPreservationEnabled = modelSupportsContextManagement(model)

  if (
    shouldIncludeFirstPartyOnlyBetas() &&
    (antOptedIntoToolClearing || thinkingPreservationEnabled)
  ) {
    betaHeaders.push(CONTEXT_MANAGEMENT_BETA_HEADER)
  }
  const strictToolsEnabled =
    checkStatsigFeatureGate_CACHED_MAY_BE_STALE('tengu_tool_pear')
  const tokenEfficientToolsEnabled =
    !strictToolsEnabled &&
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_json_tools', false)
  if (
    includeFirstPartyOnlyBetas &&
    modelSupportsStructuredOutputs(model) &&
    strictToolsEnabled
  ) {
    betaHeaders.push(STRUCTURED_OUTPUTS_BETA_HEADER)
  }
  if (
    process.env.USER_TYPE === 'ant' &&
    includeFirstPartyOnlyBetas &&
    tokenEfficientToolsEnabled
  ) {
    betaHeaders.push(TOKEN_EFFICIENT_TOOLS_BETA_HEADER)
  }

  if (provider === 'vertex' && vertexModelSupportsWebSearch(model)) {
    betaHeaders.push(WEB_SEARCH_BETA_HEADER)
  }
  if (provider === 'foundry') {
    betaHeaders.push(WEB_SEARCH_BETA_HEADER)
  }

  if (includeFirstPartyOnlyBetas) {
    betaHeaders.push(PROMPT_CACHING_SCOPE_BETA_HEADER)
  }

  // Port of ant v2.1.136 — mid-conversation-system gate. Only added when the
  // env var or `tengu_fennel_kite_model` flag explicitly opts in (default
  // false). Server-side feature; non-firstParty providers ignore the header.
  if (
    shouldIncludeFirstPartyOnlyBetas() &&
    isMidConversationSystemEnabled(model)
  ) {
    betaHeaders.push(MID_CONVERSATION_SYSTEM_BETA_HEADER)
  }

  if (readEnv('ANTHROPIC_BETAS')) {
    betaHeaders.push(
      ...readEnv('ANTHROPIC_BETAS').split(',')
        .map(_ => _.trim())
        .filter(Boolean),
    )
  }
  return betaHeaders
})

export const getModelBetas = memoize((model: string): string[] => {
  const modelBetas = getAllModelBetas(model)
  if (getAPIProvider() === 'bedrock') {
    return modelBetas.filter(b => !BEDROCK_EXTRA_PARAMS_HEADERS.has(b))
  }
  return modelBetas
})

export const getBedrockExtraBodyParamsBetas = memoize(
  (model: string): string[] => {
    const modelBetas = getAllModelBetas(model)
    return modelBetas.filter(b => BEDROCK_EXTRA_PARAMS_HEADERS.has(b))
  },
)

/**
 * Merge SDK-provided betas with auto-detected model betas.
 * SDK betas are read from global state (set via setSdkBetas in main.tsx).
 * The betas are pre-filtered by filterAllowedSdkBetas which handles
 * subscriber checks and allowlist validation with warnings.
 *
 * @param options.isAgenticQuery - When true, ensures the beta headers needed
 *   for agentic queries are present. For non-Haiku models these are already
 *   included by getAllModelBetas(); for Haiku they're excluded since
 *   non-agentic calls (compaction, classifiers, token estimation) don't need them.
 */
export function getMergedBetas(
  model: string,
  options?: { isAgenticQuery?: boolean },
): string[] {
  const baseBetas = sanitizeBetaHeaders(getModelBetas(model))

  if (options?.isAgenticQuery) {
    if (!baseBetas.includes(CLAUDE_CODE_20250219_BETA_HEADER)) {
      baseBetas.push(CLAUDE_CODE_20250219_BETA_HEADER)
    }
    if (
      process.env.USER_TYPE === 'ant' &&
      readEnv('CLAUDE_CODE_ENTRYPOINT') === 'cli' &&
      CLI_INTERNAL_BETA_HEADER &&
      !baseBetas.includes(CLI_INTERNAL_BETA_HEADER)
    ) {
      baseBetas.push(CLI_INTERNAL_BETA_HEADER)
    }
  }

  const sdkBetas = getSdkBetas()

  if (!sdkBetas || sdkBetas.length === 0) {
    return baseBetas
  }

  return sanitizeBetaHeaders([
    ...baseBetas,
    ...sdkBetas.filter(b => !baseBetas.includes(b)),
  ])
}

export function clearBetasCaches(): void {
  getAllModelBetas.cache?.clear?.()
  getModelBetas.cache?.clear?.()
  getBedrockExtraBodyParamsBetas.cache?.clear?.()
}

export function sanitizeBetaHeaders(betas: readonly string[]): string[] {
  return [
    ...new Set(betas.map(beta => beta.trim()).filter(beta => beta.length > 0)),
  ]
}
