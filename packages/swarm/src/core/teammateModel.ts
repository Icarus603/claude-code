import { CLAUDE_OPUS_4_7_CONFIG } from '../adapters/appRuntime.js'
import { getAPIProvider } from '../adapters/appRuntime.js'

// @[MODEL LAUNCH]: Update the fallback model below.
// When the user has never set teammateDefaultModel in /config, new teammates
// use Opus 4.7. Must be provider-aware so Bedrock/Vertex/Foundry customers get
// the correct model ID.
export function getHardcodedTeammateModelFallback(): string {
  return CLAUDE_OPUS_4_7_CONFIG[getAPIProvider()]
}
