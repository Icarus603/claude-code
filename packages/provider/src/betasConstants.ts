import { feature } from 'bun:bundle'
import { readEnv } from '@claude-code/config/env/utils'

export const CLAUDE_CODE_20250219_BETA_HEADER = 'claude-code-20250219'
export const INTERLEAVED_THINKING_BETA_HEADER =
  'interleaved-thinking-2025-05-14'
export const CONTEXT_1M_BETA_HEADER = 'context-1m-2025-08-07'
export const CONTEXT_MANAGEMENT_BETA_HEADER = 'context-management-2025-06-27'
export const STRUCTURED_OUTPUTS_BETA_HEADER = 'structured-outputs-2025-12-15'
export const WEB_SEARCH_BETA_HEADER = 'web-search-2025-03-05'
// Tool search beta headers differ by provider:
// - Claude API / Foundry: advanced-tool-use-2025-11-20
// - Vertex AI / Bedrock: tool-search-tool-2025-10-19
export const TOOL_SEARCH_BETA_HEADER_1P = 'advanced-tool-use-2025-11-20'
export const TOOL_SEARCH_BETA_HEADER_3P = 'tool-search-tool-2025-10-19'
export const EFFORT_BETA_HEADER = 'effort-2025-11-24'
export const TASK_BUDGETS_BETA_HEADER = 'task-budgets-2026-03-13'
export const PROMPT_CACHING_SCOPE_BETA_HEADER =
  'prompt-caching-scope-2026-01-05'
export const FAST_MODE_BETA_HEADER = 'fast-mode-2026-02-01'
export const REDACT_THINKING_BETA_HEADER = 'redact-thinking-2026-02-12'
export const TOKEN_EFFICIENT_TOOLS_BETA_HEADER =
  'token-efficient-tools-2026-03-28'
export const AFK_MODE_BETA_HEADER = feature('TRANSCRIPT_CLASSIFIER')
  ? 'afk-mode-2026-01-31'
  : ''
export const CLI_INTERNAL_BETA_HEADER =
  process.env.USER_TYPE === 'ant' ? 'cli-internal-2026-02-09' : ''
export const ADVISOR_BETA_HEADER = 'advisor-tool-2026-03-01'

/**
 * Bedrock only supports a limited number of beta headers and only through
 * extraBodyParams. This set maintains the beta strings that should be in
 * Bedrock extraBodyParams *and not* in Bedrock headers.
 */
export const BEDROCK_EXTRA_PARAMS_HEADERS = new Set([
  INTERLEAVED_THINKING_BETA_HEADER,
  CONTEXT_1M_BETA_HEADER,
  TOOL_SEARCH_BETA_HEADER_3P,
])

/**
 * Betas allowed on Vertex countTokens API.
 * Other betas will cause 400 errors.
 */
export const VERTEX_COUNT_TOKENS_ALLOWED_BETAS = new Set([
  CLAUDE_CODE_20250219_BETA_HEADER,
  INTERLEAVED_THINKING_BETA_HEADER,
  CONTEXT_MANAGEMENT_BETA_HEADER,
])
export const CACHE_EDITING_BETA_HEADER: string = ''

// ant 1387.js aEH — opt-in cache diagnostics. When the server returns
// per-cache-block diagnostics, the legacy runtime can surface why a cache
// hit didn't land (cache_creation_input_tokens vs cache_read_input_tokens
// mismatch, cache key drift, 1h vs 5m TTL split, etc.). Self-host gate:
// CLAUDE_CODE_CACHE_DIAGNOSIS=1. ant additionally gates on the
// `tengu_prompt_cache_diagnostics` statsig flag; ccb's GrowthBook stub
// always returns false so the env var is the only effective trigger.
export const CACHE_DIAGNOSIS_BETA_HEADER = 'cache-diagnosis-2026-04-07'

// ant 1387.js kgq (v2.1.131) — `extended-cache-ttl-2025-04-11`. Allows
// longer prompt-cache TTL than the default 5 min (presumably 1h+). Tracked
// here as a registry constant so callers can opt in via env-gated flow.
// Not in any default beta list; the SDK only sends it when explicitly
// requested by the consumer.
export const EXTENDED_CACHE_TTL_BETA_HEADER = 'extended-cache-ttl-2025-04-11'

// ant gy 1413.js fp_ (v2.1.136) — mid-conversation-system. Server-side
// gate to allow changing the system prompt mid-conversation. Activated by
// CLAUDE_CODE_MID_CONVERSATION_SYSTEM env or `tengu_fennel_kite_model`
// flag matching the model name (substring match). NOT in default betas;
// added per-request via `isMidConversationSystemEnabled` (see betas.ts).
export const MID_CONVERSATION_SYSTEM_BETA_HEADER =
  'mid-conversation-system-2026-04-07'
