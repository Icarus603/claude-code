import memoize from 'lodash-es/memoize.js'
import {
  getProviderForModel,
  isFirstPartyAnthropicEndpoint,
} from '../providers.js'
import { readEnv } from '@claude-code/config/env/utils'
import { unpackModelId } from '../connections.js'

export type ModelCapabilityOverride =
  | 'effort'
  | 'max_effort'
  | 'xhigh_effort'
  | 'thinking'
  | 'adaptive_thinking'
  | 'interleaved_thinking'

const ANTHROPIC_TIERS = [
  {
    modelEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
    capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
    capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
    capabilitiesEnvVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  },
] as const

const OPENAI_TIERS = [
  {
    modelEnvVar: 'OPENAI_DEFAULT_OPUS_MODEL',
    capabilitiesEnvVar: 'OPENAI_DEFAULT_OPUS_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'OPENAI_DEFAULT_SONNET_MODEL',
    capabilitiesEnvVar: 'OPENAI_DEFAULT_SONNET_MODEL_SUPPORTED_CAPABILITIES',
  },
  {
    modelEnvVar: 'OPENAI_DEFAULT_HAIKU_MODEL',
    capabilitiesEnvVar: 'OPENAI_DEFAULT_HAIKU_MODEL_SUPPORTED_CAPABILITIES',
  },
] as const

/**
 * Check whether a 3p model capability override is set for a model that matches one of
 * the pinned ANTHROPIC_DEFAULT_*_MODEL or OPENAI_DEFAULT_*_MODEL env vars.
 */
export const get3PModelCapabilityOverride = memoize(
  (model: string, capability: ModelCapabilityOverride): boolean | undefined => {
    const provider = getProviderForModel(model)
    // Skip override lookup only when this model lands on a true api.anthropic.com
    // endpoint — OAuth (Pro/Max), Console api_key, or env-only `firstParty`.
    // Anthropic-protocol *proxy* connections (LiteLLM etc.) need 3P overrides
    // because their models lie outside the first-party defaults pattern;
    // before the v26.5.26 fix this branch only matched env-only `firstParty`
    // (the cast leaked `'anthropic'` for connection-routed cases) and the
    // override path worked for proxies by accident. Now that
    // `getProviderForModel` translates `protocol='anthropic'` → `'firstParty'`,
    // we must distinguish native vs proxy endpoint here explicitly.
    if (provider === 'firstParty' && isFirstPartyAnthropicEndpoint(model)) {
      return undefined
    }
    const m = model.toLowerCase()
    const bareModel = unpackModelId(model).modelId.toLowerCase()
    // For proxy connections (provider==='firstParty' but endpoint != native),
    // use ANTHROPIC_TIERS — they speak Anthropic protocol and any pinned env
    // override applies the same way.
    const tiers = provider === 'openai' ? OPENAI_TIERS : ANTHROPIC_TIERS
    for (const tier of tiers) {
      const pinned = readEnv(tier.modelEnvVar)
      const capabilities = readEnv(tier.capabilitiesEnvVar)
      if (!pinned || capabilities === undefined) continue
      const normalizedPinned = pinned.toLowerCase()
      if (m !== normalizedPinned && bareModel !== normalizedPinned) continue
      return capabilities
        .toLowerCase()
        .split(',')
        .map(s => s.trim())
        .includes(capability)
    }
    return undefined
  },
  (model, capability) => `${model.toLowerCase()}:${capability}`,
)
