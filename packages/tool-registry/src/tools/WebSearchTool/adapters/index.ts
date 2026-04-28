/**
 * Search adapter factory — currently always returns the Bing adapter.
 *
 * Earlier code conditionally cached an ApiSearchAdapter for first-party
 * Anthropic URLs, but the API path was disabled and the cache became
 * commented-out dead code. Adapter is stateless so a fresh instance per
 * call is fine.
 */

import { BingSearchAdapter } from './bingAdapter.js'
import type { WebSearchAdapter } from './types.js'

export type { SearchResult, SearchOptions, SearchProgress, WebSearchAdapter } from './types.js'

export function createAdapter(): WebSearchAdapter {
  return new BingSearchAdapter()
}
