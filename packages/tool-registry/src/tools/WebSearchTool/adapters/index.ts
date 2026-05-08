/**
 * Search adapter factory — provider-aware routing.
 *
 * Anthropic-native providers (firstParty / Bedrock / Vertex on
 * Claude-4 / Foundry) get ant's original `web_search_20250305`
 * server-tool path via ApiSearchAdapter — which lets the model
 * iterate up to 8 search refinements per call.
 *
 * Other providers (OpenAI / Gemini / Codex / Ollama-compat)
 * fall back to BingSearchAdapter — they can't serve the Anthropic
 * server tool, so a client-side scrape is the only option until each
 * provider's native search tool is wired in.
 *
 * `WEB_SEARCH_ADAPTER=api|bing` env var forces a specific adapter
 * — escape hatch when routing misjudges or the user wants to compare
 * results directly. Unknown values (typos, blanks) silently fall
 * through to provider-based routing rather than erroring; the env
 * var is a hint, not a contract.
 *
 * Adapter is stateless so a fresh instance per call is fine.
 */

import { readEnv } from '@claude-code/config/env/utils'
import { getMainLoopModel } from '@claude-code/provider/model.js'
import { supportsAnthropicServerWebSearch } from '@claude-code/provider/providers.js'
import { ApiSearchAdapter } from './apiAdapter.js'
import { BingSearchAdapter } from './bingAdapter.js'
import type { WebSearchAdapter } from './types.js'

export type { SearchResult, SearchOptions, SearchProgress, WebSearchAdapter } from './types.js'

export function createAdapter(): WebSearchAdapter {
  const override = readEnv('WEB_SEARCH_ADAPTER')?.toLowerCase()
  if (override === 'api') return new ApiSearchAdapter()
  if (override === 'bing') return new BingSearchAdapter()

  let model: string | undefined
  try {
    model = getMainLoopModel()
  } catch {
    // Bootstrap path before settings are populated — fall through to
    // global provider check inside supportsAnthropicServerWebSearch.
  }

  if (supportsAnthropicServerWebSearch(model)) {
    return new ApiSearchAdapter()
  }
  return new BingSearchAdapter()
}
