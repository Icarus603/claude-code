import memoize from 'lodash-es/memoize.js'
import { getAPIProvider } from '@claude-code/provider/providers.js'
import { readEnv } from '@claude-code/config/env/utils'

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
    if (getAPIProvider() === 'firstParty') {
      return undefined
    }
    const m = model.toLowerCase()
    const tiers = getAPIProvider() === 'openai' ? OPENAI_TIERS : ANTHROPIC_TIERS
    for (const tier of tiers) {
      const pinned = readEnv(tier.modelEnvVar)
      const capabilities = readEnv(tier.capabilitiesEnvVar)
      if (!pinned || capabilities === undefined) continue
      if (m !== pinned.toLowerCase()) continue
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
