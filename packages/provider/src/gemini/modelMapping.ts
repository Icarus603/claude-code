import { ConfigurationError } from '../errors.js'
import { readEnv } from '@claude-code/config/env'
import { unpackModelId } from '../connections.js'

function getModelFamily(model: string): 'haiku' | 'sonnet' | 'opus' | null {
  if (/haiku/i.test(model)) return 'haiku'
  if (/opus/i.test(model)) return 'opus'
  if (/sonnet/i.test(model)) return 'sonnet'
  return null
}

export function resolveGeminiModel(anthropicModel: string): string {
  if (readEnv('GEMINI_MODEL')) {
    return readEnv('GEMINI_MODEL')
  }

  // Strip the connection-routing prefix before any further mapping. The
  // packed `<connId>:<modelId>` form is ccb-internal; the Gemini API URL
  // can't carry that prefix or it 404s. Same boundary the Anthropic adapter
  // uses (claudeLegacyRuntime.ts:1070).
  const bareModel = unpackModelId(anthropicModel).modelId
  const cleanModel = bareModel.replace(/\[1m\]$/i, '')
  const family = getModelFamily(cleanModel)

  if (!family) {
    return cleanModel
  }

  // First, try Gemini-specific DEFAULT variables (separated from Anthropic)
  const geminiEnvVar = `GEMINI_DEFAULT_${family.toUpperCase()}_MODEL`
  const geminiModel = readEnv(geminiEnvVar)
  if (geminiModel) {
    return geminiModel
  }

  // Fallback to Anthropic DEFAULT variables for backward compatibility
  const sharedEnvVar = `ANTHROPIC_DEFAULT_${family.toUpperCase()}_MODEL`
  const resolvedModel = readEnv(sharedEnvVar)
  if (resolvedModel) {
    return resolvedModel
  }

  throw new ConfigurationError(
    `Gemini provider requires GEMINI_MODEL or ${geminiEnvVar} (or ${sharedEnvVar} for backward compatibility) to be configured.`,
  )
}
