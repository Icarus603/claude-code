// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import type { Theme } from '@anthropic/ink'
import { feature } from 'bun:bundle'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import { getCanonicalName } from './model.js'
import { get3PModelCapabilityOverride } from './model/modelSupportOverrides.js'
import {
  getAPIProvider,
  isFirstPartyAnthropicBaseUrl,
  resolveConnectionForModel,
} from './providers.js'
import { getSettingsWithErrors } from '@claude-code/config/settings'
import { resolveAntModel } from './antModels.js'
import { readEnv } from '@claude-code/config/env/utils'
import type { ConnectionRecord } from '@claude-code/config'

/**
 * Mirrors ant 2.1.121's 2833.js schema: thinking config carries an
 * optional `display` flag controlling how server emits thinking content
 * in the response stream.
 *
 *   - 'summarized' = server emits a short summary in place of full reasoning.
 *     Massively reduces tokens-in-history on subsequent turns (each
 *     thinking block previously round-tripped at full size). Recommended
 *     default for interactive sessions.
 *   - 'omitted' = server emits no thinking content at all. Maximum
 *     savings, but loses transparency — user can't see why the model
 *     chose what it did. Useful for headless/-p where reasoning is noise.
 *   - undefined = legacy behavior, full reasoning emitted.
 *
 * Adaptive and enabled (fixed-budget) both accept it; disabled does not.
 */
export type ThinkingDisplay = 'summarized' | 'omitted'

export type ThinkingConfig =
  | { type: 'adaptive'; display?: ThinkingDisplay }
  | { type: 'enabled'; budgetTokens: number; display?: ThinkingDisplay }
  | { type: 'disabled' }

/**
 * Default thinking display mode. Read from CCB_THINKING_DISPLAY (override)
 * or fall back to 'summarized' for ccb's interactive default — saves
 * substantial token round-trip on long sessions while keeping a visible
 * summary for transparency. Set to 'omitted' for hardest savings.
 * Set to 'full' (or anything not in the enum) to emit nothing here and
 * let the server's default behavior emit full reasoning.
 */
export function getDefaultThinkingDisplay(): ThinkingDisplay | undefined {
  const override = readEnv('CCB_THINKING_DISPLAY')?.toLowerCase()
  if (override === 'summarized') return 'summarized'
  if (override === 'omitted') return 'omitted'
  if (override === 'full' || override === 'none') return undefined
  return 'summarized'
}

/**
 * Build-time gate (feature) + runtime gate (GrowthBook). The build flag
 * controls code inclusion in external builds; the GB flag controls rollout.
 */
export function isUltrathinkEnabled(): boolean {
  if (!feature('ULTRATHINK')) {
    return false
  }
  return getFeatureValue_CACHED_MAY_BE_STALE('tengu_turtle_carbon', true)
}

/**
 * Check if text contains the "ultrathink" keyword.
 */
export function hasUltrathinkKeyword(text: string): boolean {
  return /\bultrathink\b/i.test(text)
}

/**
 * Find positions of "ultrathink" keyword in text (for UI highlighting/notification)
 */
export function findThinkingTriggerPositions(text: string): Array<{
  word: string
  start: number
  end: number
}> {
  const positions: Array<{ word: string; start: number; end: number }> = []
  // Fresh /g literal each call — String.prototype.matchAll copies lastIndex
  // from the source regex, so a shared instance would leak state from
  // hasUltrathinkKeyword's .test() into this call on the next render.
  const matches = text.matchAll(/\bultrathink\b/gi)

  for (const match of matches) {
    if (match.index !== undefined) {
      positions.push({
        word: match[0],
        start: match.index,
        end: match.index + match[0].length,
      })
    }
  }

  return positions
}

const RAINBOW_COLORS: Array<keyof Theme> = [
  'rainbow_red',
  'rainbow_orange',
  'rainbow_yellow',
  'rainbow_green',
  'rainbow_blue',
  'rainbow_indigo',
  'rainbow_violet',
]

const RAINBOW_SHIMMER_COLORS: Array<keyof Theme> = [
  'rainbow_red_shimmer',
  'rainbow_orange_shimmer',
  'rainbow_yellow_shimmer',
  'rainbow_green_shimmer',
  'rainbow_blue_shimmer',
  'rainbow_indigo_shimmer',
  'rainbow_violet_shimmer',
]

export function getRainbowColor(
  charIndex: number,
  shimmer: boolean = false,
): keyof Theme {
  const colors = shimmer ? RAINBOW_SHIMMER_COLORS : RAINBOW_COLORS
  return colors[charIndex % colors.length]!
}

function isFirstPartyAnthropicEndpoint(endpoint: string | undefined): boolean {
  if (!endpoint) return true
  try {
    const host = new URL(endpoint).host
    return host === 'api.anthropic.com' || host === 'api-staging.anthropic.com'
  } catch {
    return false
  }
}

export function isFirstPartyAnthropicConnection(
  conn: ConnectionRecord | undefined,
): boolean {
  return conn?.protocol === 'anthropic' && isFirstPartyAnthropicEndpoint(conn.endpoint)
}

export function shouldRequireThinkingSignatureForModel(model: string): boolean {
  const conn = resolveConnectionForModel(model)
  if (conn) return isFirstPartyAnthropicConnection(conn)
  return isFirstPartyAnthropicBaseUrl()
}

function getAnthropicConnectionThinkingDefault(
  model: string,
): boolean | undefined {
  const conn = resolveConnectionForModel(model)
  if (!conn || conn.protocol !== 'anthropic') return undefined
  return isFirstPartyAnthropicConnection(conn)
}

function shouldUseFirstPartyThinkingDefaults(model: string): boolean {
  const connDefault = getAnthropicConnectionThinkingDefault(model)
  if (connDefault !== undefined) return connDefault
  return getAPIProvider() === 'firstParty'
}

// TODO(inigo): add support for probing unknown models via API error detection
// Provider-aware thinking support detection (aligns with modelSupportsISP in betas.ts)
export function modelSupportsThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  if (process.env.USER_TYPE === 'ant') {
    if (resolveAntModel(model.toLowerCase())) {
      return true
    }
  }
  // IMPORTANT: Do not change thinking support without notifying the model
  // launch DRI and research. This can greatly affect model quality and bashing.
  const canonical = getCanonicalName(model)
  const connDefault = getAnthropicConnectionThinkingDefault(model)
  if (connDefault !== undefined) {
    return connDefault && !canonical.includes('claude-3-')
  }
  const provider = getAPIProvider()
  // 1P and Foundry: all Claude 4+ models (including Haiku 4.5)
  if (provider === 'foundry' || provider === 'firstParty') {
    return !canonical.includes('claude-3-')
  }
  // 3P (Bedrock/Vertex): only Opus 4+ and Sonnet 4+
  return canonical.includes('sonnet-4') || canonical.includes('opus-4')
}

// @[MODEL LAUNCH]: Add the new model to the allowlist if it supports adaptive thinking.
export function modelSupportsAdaptiveThinking(model: string): boolean {
  const supported3P = get3PModelCapabilityOverride(model, 'adaptive_thinking')
  if (supported3P !== undefined) {
    return supported3P
  }
  const canonical = getCanonicalName(model)
  const connDefault = getAnthropicConnectionThinkingDefault(model)
  if (connDefault === false) {
    return false
  }
  if (canonical.includes('opus-4-7') || canonical.includes('opus-4-6') || canonical.includes('sonnet-4-6')) {
    return shouldUseFirstPartyThinkingDefaults(model)
  }
  if (
    canonical.includes('opus') ||
    canonical.includes('sonnet') ||
    canonical.includes('haiku')
  ) {
    return false
  }
  // IMPORTANT: Do not change adaptive thinking support without notifying the
  // model launch DRI and research. This can greatly affect model quality and
  // bashing.
  //
  // Newer models (4.6+) are all trained on adaptive thinking and MUST have it
  // enabled for model testing. DO NOT default to false for first party, otherwise
  // we may silently degrade model quality.
  //
  // Default to true for unknown model strings on 1P and Foundry (because Foundry
  // is a proxy). Do not default to true for other 3P as they have different formats
  // for their model strings.
  const provider = getAPIProvider()
  return provider === 'foundry' || shouldUseFirstPartyThinkingDefaults(model)
}

/**
 * Some models REQUIRE adaptive thinking — they don't accept the legacy
 * `budget_tokens` enabled mode. Opus 4.7 dropped budget_tokens entirely
 * (sending it returns 400). Mirrors ant 4682.js disable-adaptive guard:
 * `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` is honoured ONLY for the
 * deprecation-window models (4.6 / Sonnet 4.6) — for newer models the
 * env var is ignored to avoid wedging API requests.
 */
export function mustUseAdaptiveThinking(model: string): boolean {
  const canonical = getCanonicalName(model)
  return canonical.includes('opus-4-7')
}

/**
 * Per-model runtime override for thinking type. Mirrors ant's
 * `g_.thinkingTypeOverrides` (0126.js xP6/uP6) — lets specific code
 * paths force a model into 'adaptive' or 'enabled' mode regardless of
 * the default policy. Empty by default; populated only when explicitly
 * set by callers (e.g. an experiment, a per-request flag).
 *
 * Read-then-act, never store the override permanently across sessions.
 */
const thinkingTypeOverrides = new Map<string, 'adaptive' | 'enabled'>()
export function getThinkingTypeOverride(
  model: string,
): 'adaptive' | 'enabled' | undefined {
  return thinkingTypeOverrides.get(model)
}
export function setThinkingTypeOverride(
  model: string,
  override: 'adaptive' | 'enabled' | undefined,
): void {
  if (override === undefined) thinkingTypeOverrides.delete(model)
  else thinkingTypeOverrides.set(model, override)
}

export function shouldEnableThinkingByDefault(): boolean {
  if (readEnv('MAX_THINKING_TOKENS')) {
    return parseInt(readEnv('MAX_THINKING_TOKENS'), 10) > 0
  }

  const { settings } = getSettingsWithErrors()
  if (settings.alwaysThinkingEnabled === false) {
    return false
  }

  // IMPORTANT: Do not change default thinking enabled value without notifying
  // the model launch DRI and research. This can greatly affect model quality and
  // bashing.
  //
  // Enable thinking by default unless explicitly disabled.
  return true
}
