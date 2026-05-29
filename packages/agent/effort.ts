// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import { readEnv } from '@claude-code/config/env/utils'
import { isUltrathinkEnabled } from '@claude-code/provider/thinking.js'
import { getInitialSettings } from '@claude-code/config/settings'
import {
  isProSubscriber,
  isMaxSubscriber,
  isTeamSubscriber,
} from '@claude-code/provider/authAlias.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { getAPIProvider } from '@claude-code/provider/providers.js'
import {
  resolveConnectionForModel,
  isFirstPartyAnthropicEndpoint,
} from '@claude-code/provider/providers.js'
import { unpackModelId } from '@claude-code/provider/connections.js'
import { get3PModelCapabilityOverride } from '@claude-code/provider/model/modelSupportOverrides.js'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import type { EffortLevel } from '@claude-code/headless-sdk/runtimeTypes.js'
import type { ConnectionModelRecord } from '@claude-code/config'
import {
  resolveAntModel,
  getAntModelOverrideConfig,
} from '@claude-code/provider/antModels.js'

export type { EffortLevel }

export const EFFORT_LEVELS = [
  'low',
  'medium',
  'high',
  'xhigh',
  'max',
] as const satisfies readonly EffortLevel[]

export type EffortValue = EffortLevel | number

/**
 * Look up the connection-record entry that owns a given model id and
 * return the per-model effort metadata the backend reported for it.
 * Returns undefined when the model isn't covered by a connection (env
 * driven path or unknown model).
 *
 * Codex's `/models` endpoint tells us per-model `supported_reasoning_levels`
 * and `default_reasoning_level`, which is the right source of truth for
 * /effort on gpt-* models — far better than hardcoded family-name
 * allowlists tuned for Anthropic.
 */
function getConnectionModelEntry(
  model: string,
): Pick<ConnectionModelRecord, 'supportedEfforts' | 'defaultEffort'> | undefined {
  const conn = resolveConnectionForModel(model)
  if (!conn) return undefined
  const { modelId } = unpackModelId(model)
  const entry = conn.models.find(m => m.id === modelId)
  if (!entry) return undefined
  if (!entry.supportedEfforts && !entry.defaultEffort) return undefined
  return entry
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports the effort parameter.
export function modelSupportsEffort(model: string): boolean {
  if (isEnvTruthy(readEnv('CLAUDE_CODE_ALWAYS_ENABLE_EFFORT'))) {
    return true
  }
  // V7 §11.6 — connection-record metadata wins over hardcoded family
  // allowlists. Codex /models reports per-model supported reasoning
  // levels for the user's actual tier; trust that.
  const fromConnection = getConnectionModelEntry(model)?.supportedEfforts
  if (fromConnection !== undefined) {
    return fromConnection.length > 0
  }
  const supported3P = get3PModelCapabilityOverride(model, 'effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  const m = model.toLowerCase()
  if (
    m.includes('opus-4-8') ||
    m.includes('opus-4-7') ||
    m.includes('opus-4-6') ||
    m.includes('sonnet-4-6')
  ) {
    return true
  }
  if (m.includes('haiku') || m.includes('sonnet') || m.includes('opus')) {
    return false
  }

  // IMPORTANT: Do not change the default effort support without notifying
  // the model launch DRI and research. This is a sensitive setting that can
  // greatly affect model quality and bashing.

  return getAPIProvider() === 'firstParty'
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports 'max' effort.
// Per API docs, 'max' is on Mythos / Opus 4.8/4.7 / Opus 4.6 / Sonnet 4.6.
// 'max' is Anthropic-specific; gpt-* models reported via the connection
// record max out at xhigh, so the connection check below returns false
// for them and the request never carries an unsupported value.
//
// Native vs proxy asymmetry — same shape as `modelSupportsEffort` above.
// On *native* api.anthropic.com (Claude Account / Console / api_key) the
// Anthropic capability matrix is authoritative, so unknown models stay
// false. On anthropic-protocol *proxies* (DeepSeek's
// api.deepseek.com/anthropic, LiteLLM, self-hosted Anthropic-compat
// gateways) the proxy's own enum is what matters — we don't have it, the
// user does. DeepSeek's own docs instruct setting
// `CLAUDE_CODE_EFFORT_LEVEL=max`, and clamping that down to 'high' here
// would silently override a deliberate user choice. Default-trust the
// proxy and let the API surface a 400 if the value really is unsupported.
export function modelSupportsMaxEffort(model: string): boolean {
  const fromConnection = getConnectionModelEntry(model)?.supportedEfforts
  if (fromConnection !== undefined) {
    return fromConnection.includes('max')
  }
  const supported3P = get3PModelCapabilityOverride(model, 'max_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  const m = model.toLowerCase()
  if (
    m.includes('opus-4-8') ||
    m.includes('opus-4-7') ||
    m.includes('opus-4-6') ||
    m.includes('sonnet-4-6') ||
    m.includes('mythos')
  ) {
    return true
  }
  if (process.env.USER_TYPE === 'ant' && resolveAntModel(model)) {
    return true
  }
  // Anthropic-protocol proxy fallthrough: trust the user's endpoint.
  if (getAPIProvider() === 'firstParty' && !isFirstPartyAnthropicEndpoint(model)) {
    return true
  }
  return false
}

// @[MODEL LAUNCH]: Add the new model if it supports 'xhigh' effort.
// Per Anthropic docs (platform.claude.com/docs/en/build-with-claude/effort),
// xhigh is **Opus 4.8/4.7 only** on Anthropic — but Codex's gpt-* models
// also expose `xhigh` natively in their ReasoningEffort enum, surfaced
// via the connection record's supportedEfforts.
//
// Unlike `modelSupportsMaxEffort`, we DO NOT default-trust anthropic-
// protocol proxies for xhigh. Rationale: 'max' has explicit user-facing
// documentation from major proxy vendors (DeepSeek's official Claude
// Code recipe sets `CLAUDE_CODE_EFFORT_LEVEL=max`), but xhigh is a
// 2026-04-27 Anthropic-internal middle tier with no known proxy support.
// If we returned true here for proxies, /effort and the picker would
// offer users a level that the proxy almost certainly rejects with 400 —
// strictly worse than the old silent clamp. Proxies that genuinely
// support xhigh should declare it via a connection record's
// `supportedEfforts` (handled at the top of this function).
export function modelSupportsXhighEffort(model: string): boolean {
  const fromConnection = getConnectionModelEntry(model)?.supportedEfforts
  if (fromConnection !== undefined) {
    return fromConnection.includes('xhigh')
  }
  const supported3P = get3PModelCapabilityOverride(model, 'xhigh_effort')
  if (supported3P !== undefined) {
    return supported3P
  }
  const m = model.toLowerCase()
  if (m.includes('opus-4-8') || m.includes('opus-4-7') || m.includes('mythos')) {
    return true
  }
  if (process.env.USER_TYPE === 'ant' && resolveAntModel(model)) {
    return true
  }
  return false
}

export function isEffortLevel(value: string): value is EffortLevel {
  return (EFFORT_LEVELS as readonly string[]).includes(value)
}

export function parseEffortValue(value: unknown): EffortValue | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined
  }
  if (typeof value === 'number' && isValidNumericEffort(value)) {
    return value
  }
  const str = String(value).toLowerCase()
  if (isEffortLevel(str)) {
    return str
  }
  const numericValue = parseInt(str, 10)
  if (!isNaN(numericValue) && isValidNumericEffort(numericValue)) {
    return numericValue
  }
  return undefined
}

/**
 * Numeric values are model-default only and not persisted.
 * String levels (low/medium/high/xhigh/max) are persistable. Persistence
 * is the user's choice; the runtime (resolveAppliedEffort) clamps to
 * `high` when the active model doesn't support xhigh / max.
 * Write sites call this before saving to settings so the Zod schema
 * (which only accepts string levels) never rejects a write.
 */
export function toPersistableEffort(
  value: EffortValue | undefined,
): EffortLevel | undefined {
  if (
    value === 'low' ||
    value === 'medium' ||
    value === 'high' ||
    value === 'xhigh' ||
    value === 'max'
  ) {
    return value
  }
  return undefined
}

export function getInitialEffortSetting(): EffortLevel | undefined {
  return toPersistableEffort(getInitialSettings().effortLevel)
}

/**
 * Decide what effort level (if any) to persist when the user selects a model
 * in ModelPicker. Keeps an explicit prior /effort choice sticky even when it
 * matches the picked model's default, while letting purely-default and
 * session-ephemeral effort (CLI --effort, EffortCallout default) fall through
 * to undefined so it follows future model-default changes.
 *
 * priorPersisted must come from userSettings on disk
 * (getSettingsForSource('userSettings')?.effortLevel), NOT merged settings
 * (project/policy layers would leak into the user's global settings.json)
 * and NOT AppState.effortValue (includes session-scoped sources that
 * deliberately do not write to settings.json).
 */
export function resolvePickerEffortPersistence(
  picked: EffortLevel | undefined,
  modelDefault: EffortLevel,
  priorPersisted: EffortLevel | undefined,
  toggledInPicker: boolean,
): EffortLevel | undefined {
  const hadExplicit = priorPersisted !== undefined || toggledInPicker
  return hadExplicit || picked !== modelDefault ? picked : undefined
}

export function getEffortEnvOverride(): EffortValue | null | undefined {
  const envOverride = readEnv('CLAUDE_CODE_EFFORT_LEVEL')
  return envOverride?.toLowerCase() === 'unset' ||
    envOverride?.toLowerCase() === 'auto'
    ? null
    : parseEffortValue(envOverride)
}

/**
 * Resolve the effort value that will actually be sent to the API for a given
 * model, following the full precedence chain:
 *   env CLAUDE_CODE_EFFORT_LEVEL → appState.effortValue → model default
 *
 * Returns undefined when no effort parameter should be sent (env set to
 * 'unset', or no default exists for the model).
 */
export function resolveAppliedEffort(
  model: string,
  appStateEffortValue: EffortValue | undefined,
): EffortValue | undefined {
  const envOverride = getEffortEnvOverride()
  if (envOverride === null) {
    return undefined
  }
  const resolved =
    envOverride ?? appStateEffortValue ?? getDefaultEffortForModel(model)
  // Clamp unsupported levels down. xhigh requires Opus 4.8/4.7; max requires
  // Opus 4.8/4.7/4.6/Sonnet 4.6. Anything below tier falls to 'high', which
  // is the same value the API uses when no effort param is sent.
  if (resolved === 'max' && !modelSupportsMaxEffort(model)) {
    return 'high'
  }
  if (resolved === 'xhigh' && !modelSupportsXhighEffort(model)) {
    return 'high'
  }
  return resolved
}

/**
 * Resolve the effort level to show the user. Wraps resolveAppliedEffort
 * with the 'high' fallback (what the API uses when no effort param is sent).
 * Single source of truth for the status bar and /effort output (CC-1088).
 */
export function getDisplayedEffortLevel(
  model: string,
  appStateEffort: EffortValue | undefined,
): EffortLevel {
  const resolved = resolveAppliedEffort(model, appStateEffort) ?? 'high'
  return convertEffortValueToLevel(resolved)
}

/**
 * Build the ` with {level} effort` suffix shown in Logo/Spinner.
 * Returns empty string if the user hasn't explicitly set an effort value.
 * Delegates to resolveAppliedEffort() so the displayed level matches what
 * the API actually receives (including max→high clamp for non-Opus models).
 */
export function getEffortSuffix(
  model: string,
  effortValue: EffortValue | undefined,
): string {
  if (effortValue === undefined) return ''
  // Strip connection-id prefix (`<connId>:<modelId>`) before resolving
  // model capabilities — resolveAppliedEffort matches against bare model ids.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { unpackModelId } = require(
    '@claude-code/provider/connections.js',
  ) as typeof import('@claude-code/provider/connections.js')
  const { modelId } = unpackModelId(model)
  const resolved = resolveAppliedEffort(modelId, effortValue)
  if (resolved === undefined) return ''
  return ` with ${convertEffortValueToLevel(resolved)} effort`
}

export function isValidNumericEffort(value: number): boolean {
  return Number.isInteger(value)
}

export function convertEffortValueToLevel(value: EffortValue): EffortLevel {
  if (typeof value === 'string') {
    return isEffortLevel(value) ? value : 'high'
  }
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    // ant numeric range now spans 5 levels — keep low/medium/high
    // breakpoints unchanged to avoid disturbing existing tooling, slot
    // xhigh between high and max at the upper end.
    if (value <= 50) return 'low'
    if (value <= 85) return 'medium'
    if (value <= 95) return 'high'
    if (value <= 100) return 'xhigh'
    return 'max'
  }
  return 'high'
}

/**
 * Get user-facing description for effort levels
 */
export function getEffortLevelDescription(level: EffortLevel): string {
  // Wording matches Anthropic's official docs at
  // platform.claude.com/docs/en/build-with-claude/effort
  switch (level) {
    case 'low':
      return 'Most efficient — significant token savings, best for simple tasks'
    case 'medium':
      return 'Balanced — moderate token savings with solid performance'
    case 'high':
      return 'High capability — equivalent to not setting the parameter (default)'
    case 'xhigh':
      return 'Extended capability for long-horizon work (Opus 4.8/4.7 only)'
    case 'max':
      return 'Absolute maximum capability with no constraints on token spending'
  }
}

/**
 * Get user-facing description for effort values (both string and numeric)
 */
export function getEffortValueDescription(value: EffortValue): string {
  if (process.env.USER_TYPE === 'ant' && typeof value === 'number') {
    return `[ANT-ONLY] Numeric effort value of ${value}`
  }

  if (typeof value === 'string') {
    return getEffortLevelDescription(value)
  }
  return 'Balanced approach with standard implementation and testing'
}

export type OpusDefaultEffortConfig = {
  enabled: boolean
  dialogTitle: string
  dialogDescription: string
}

const OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT: OpusDefaultEffortConfig = {
  enabled: true,
  dialogTitle: 'We recommend medium effort for Opus',
  dialogDescription:
    'Effort determines how long Claude thinks for when completing your task. We recommend medium effort for most tasks to balance speed and intelligence and maximize rate limits. Use ultrathink to trigger high effort when needed.',
}

export function getOpusDefaultEffortConfig(): OpusDefaultEffortConfig {
  const config = getFeatureValue_CACHED_MAY_BE_STALE(
    'tengu_grey_step2',
    OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
  )
  return {
    ...OPUS_DEFAULT_EFFORT_CONFIG_DEFAULT,
    ...config,
  }
}

// @[MODEL LAUNCH]: Update the default effort levels for new models
export function getDefaultEffortForModel(
  model: string,
): EffortValue | undefined {
  // V7 §11.6 — connection record's `defaultEffort` wins over the
  // hardcoded Anthropic-only defaults below. Codex /models reports a
  // per-model default via `default_reasoning_level`; mirroring it here
  // means /effort auto on a codex model surfaces the server-side
  // recommendation (medium for current gpt-5.x) instead of falling
  // through to undefined and silently using whatever the backend picks.
  const connDefault = getConnectionModelEntry(model)?.defaultEffort
  if (connDefault !== undefined) return connDefault

  if (process.env.USER_TYPE === 'ant') {
    const config = getAntModelOverrideConfig()
    const isDefaultModel =
      config?.defaultModel !== undefined &&
      model.toLowerCase() === (config.defaultModel as string).toLowerCase()
    if (isDefaultModel && config?.defaultModelEffortLevel) {
      return config.defaultModelEffortLevel as EffortValue
    }
    const antModel = resolveAntModel(model)
    if (antModel) {
      if (antModel.defaultEffortLevel) {
        return antModel.defaultEffortLevel
      }
      if (antModel.defaultEffortValue !== undefined) {
        return antModel.defaultEffortValue
      }
    }
    return undefined
  }

  // IMPORTANT: Do not change the default effort level without notifying
  // the model launch DRI and research. Default effort is a sensitive setting
  // that can greatly affect model quality and bashing.

  // Opus 4.8 defaults to high; Opus 4.7 keeps its xhigh default for
  // coding/agentic workflows when the subscriber tier can afford it. Pro
  // subscribers stay at medium since their rate limits don't tolerate
  // xhigh's higher token spend by default.
  const m = model.toLowerCase()
  if (m.includes('opus-4-8')) {
    return 'high'
  }
  if (m.includes('opus-4-7')) {
    if (isProSubscriber()) {
      return 'medium'
    }
    if (
      getOpusDefaultEffortConfig().enabled &&
      (isMaxSubscriber() || isTeamSubscriber())
    ) {
      return 'xhigh'
    }
  }
  if (m.includes('opus-4-6')) {
    if (isProSubscriber()) {
      return 'medium'
    }
    if (
      getOpusDefaultEffortConfig().enabled &&
      (isMaxSubscriber() || isTeamSubscriber())
    ) {
      return 'medium'
    }
  }

  if (isUltrathinkEnabled() && modelSupportsEffort(model)) {
    return 'medium'
  }

  return undefined
}
