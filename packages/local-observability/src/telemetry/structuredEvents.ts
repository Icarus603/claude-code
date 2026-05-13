/**
 * Port of ant v2.1.136 typed OTel event helpers (2642.js, 2643.js,
 * 2822.js, 2911.js, 2914.js, 4054.js, 5059.js).
 *
 * Each helper here wraps `logOTelEvent` with the exact metadata shape
 * ant emits for a specific event type. Without these wrappers, callers
 * across ccb would either drift on metadata keys (silent schema breakage
 * on dashboards) or skip telemetry entirely.
 *
 * Maps:
 *   ZzH → logCompactionEvent          ("compaction")
 *   LF9 → logInternalErrorEvent       ("internal_error")
 *   Ak  → logAtMentionEvent           ("at_mention")
 *   Ts  → logPermissionModeChangeEvent("permission_mode_changed")
 *   QN8 → logMcpServerConnectionEvent ("mcp_server_connection")
 *   ant 2911.js → logSystemPromptEvent("system_prompt")
 *   ant 2914.js → logApiRetriesExhaustedEvent ("api_retries_exhausted")
 *   ant 2643.js → logSkillActivatedEvent ("skill_activated")
 *   ant 2822.js → logPluginInstalledEvent ("plugin_installed")
 *   ant 5059.js → logFeedbackSurveyEvent ("feedback_survey")
 */

import { logOTelEvent } from './events.js'

// -- compaction (ant ZzH 2642.js) ---------------------------------------------
export type CompactionEvent = {
  trigger: string
  success: boolean
  durationMs: number
  preTokens?: number
  postTokens?: number
  error?: string
}
export async function logCompactionEvent(e: CompactionEvent): Promise<void> {
  await logOTelEvent('compaction', {
    trigger: e.trigger,
    success: String(e.success),
    duration_ms: String(Math.round(e.durationMs)),
    pre_tokens: e.preTokens !== undefined ? String(e.preTokens) : undefined,
    post_tokens: e.postTokens !== undefined ? String(e.postTokens) : undefined,
    error: e.error,
  })
}

// -- internal_error (ant LF9 2642.js) -----------------------------------------
// Re-entrancy guarded (y38 in ant): the error reporter must NEVER recurse if
// emitting the event itself throws, else a logger fault chains forever.
let internalErrorReentrancyGuard = false
export function logInternalErrorEvent(error: Error): void {
  if (internalErrorReentrancyGuard) return
  internalErrorReentrancyGuard = true
  try {
    const errorName =
      error.name !== 'Error'
        ? error.name
        : (error.constructor?.name ?? 'Error')
    const code = (error as Error & { code?: unknown }).code
    const errorCode =
      typeof code === 'string' && /^[A-Z][A-Z0-9_]*$/.test(code)
        ? code
        : undefined
    // Don't await — internal errors should fire-and-forget; failure to
    // emit must not stall the caller's recovery path.
    void logOTelEvent('internal_error', {
      error_name: errorName,
      error_code: errorCode,
    })
  } finally {
    internalErrorReentrancyGuard = false
  }
}

// -- at_mention (ant Ak 2642.js) ----------------------------------------------
export async function logAtMentionEvent(args: {
  mentionType: string
  success: boolean
}): Promise<void> {
  await logOTelEvent('at_mention', {
    mention_type: args.mentionType,
    success: String(args.success),
  })
}

// -- permission_mode_changed (ant Ts 2642.js) ---------------------------------
export async function logPermissionModeChangeEvent(args: {
  from: string
  to: string
  trigger?: string
}): Promise<void> {
  // Skip no-op transitions (matches ant `if (H.from === H.to) return;`).
  if (args.from === args.to) return
  await logOTelEvent('permission_mode_changed', {
    from_mode: args.from,
    to_mode: args.to,
    trigger: args.trigger,
  })
}

// -- mcp_server_connection (ant QN8 4054.js) ----------------------------------
export async function logMcpServerConnectionEvent(args: {
  serverName: string
  transportType?: string // defaults 'stdio' if undefined
  serverScope: string
  status: string
  durationMs: number
  errorCode?: string
  errorDetail?: string // only attached on ant non-customer builds (P$()=true)
  /** When false, server_name + error detail are stripped (PII gate). */
  includeIdentifyingFields?: boolean
}): Promise<void> {
  const includePII = args.includeIdentifyingFields ?? false
  await logOTelEvent('mcp_server_connection', {
    status: args.status,
    transport_type: args.transportType ?? 'stdio',
    server_scope: args.serverScope,
    duration_ms: String(Math.round(args.durationMs)),
    error_code: args.errorCode,
    server_name: includePII ? args.serverName : undefined,
    error: includePII ? args.errorDetail : undefined,
  })
}

// -- system_prompt (ant 2911.js) ----------------------------------------------
export async function logSystemPromptEvent(args: {
  hash: string
  content: string
  length: number
  truncated: boolean
}): Promise<void> {
  await logOTelEvent('system_prompt', {
    system_prompt_hash: args.hash,
    system_prompt: args.content,
    system_prompt_length: String(args.length),
    system_prompt_truncated: args.truncated ? 'true' : undefined,
  })
}

// -- api_retries_exhausted (ant 2914.js) --------------------------------------
export async function logApiRetriesExhaustedEvent(args: {
  model: string
  error: string
  statusCode?: string
  totalAttempts: number
  totalRetryDurationMs: number
  speed: 'fast' | 'normal'
  querySource?: string
  effort?: string
}): Promise<void> {
  await logOTelEvent('api_retries_exhausted', {
    model: args.model,
    error: args.error,
    status_code: args.statusCode,
    total_attempts: String(args.totalAttempts),
    total_retry_duration_ms: String(args.totalRetryDurationMs),
    speed: args.speed,
    query_source: args.querySource,
    effort: args.effort,
  })
}

// -- skill_activated (ant 2643.js) --------------------------------------------
export async function logSkillActivatedEvent(args: {
  skillName: string
  invocationTrigger: string
  skillSource?: string
  skillKind?: string
  /** Whether this skill is "official" (builtin/bundled/anthropic plugin). */
  isOfficial: boolean
  pluginName?: string
  marketplaceName?: string
}): Promise<void> {
  await logOTelEvent('skill_activated', {
    'skill.name': args.isOfficial ? args.skillName : 'custom_skill',
    invocation_trigger: args.invocationTrigger,
    'skill.source': args.skillSource,
    'skill.kind': args.skillKind,
    'plugin.name': args.isOfficial ? args.pluginName : undefined,
    'marketplace.name': args.isOfficial ? args.marketplaceName : undefined,
  })
}

// -- plugin_installed (ant 2822.js) -------------------------------------------
export async function logPluginInstalledEvent(args: {
  pluginName: string
  pluginVersion?: string
  marketplaceName?: string
  isOfficialMarketplace: boolean
  trigger?: string
  /** Whether plugin identity may flow with the event (PII gate). */
  includeIdentifyingFields?: boolean
}): Promise<void> {
  const includePII = args.includeIdentifyingFields ?? false
  await logOTelEvent('plugin_installed', {
    'plugin.name': includePII ? args.pluginName : undefined,
    'plugin.version': includePII ? args.pluginVersion : undefined,
    'marketplace.name': includePII ? args.marketplaceName : undefined,
    'marketplace.is_official': String(args.isOfficialMarketplace),
    'install.trigger': args.trigger,
  })
}

// -- feedback_survey (ant 5059.js) --------------------------------------------
export type FeedbackSurveyEvent = {
  eventType: 'appeared' | 'dismissed' | 'submitted'
  appearanceId: string
  surveyType: string
  enabledViaOverride?: boolean
}
export async function logFeedbackSurveyEvent(
  e: FeedbackSurveyEvent,
): Promise<void> {
  await logOTelEvent('feedback_survey', {
    event_type: e.eventType,
    appearance_id: e.appearanceId,
    survey_type: e.surveyType,
    enabled_via_override:
      e.enabledViaOverride !== undefined
        ? String(e.enabledViaOverride)
        : undefined,
  })
}
