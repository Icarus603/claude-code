import { EventEmitter } from 'events'

type FeatureValue = unknown
type FeatureMap = Record<string, FeatureValue>
type Unsubscribe = () => void

// Locally-enabled gate defaults. GrowthBook was stubbed out (see CLAUDE.md
// "Analytics / GrowthBook / Sentry | Empty implementations") but several
// shipping features still call getFeatureValue_CACHED_MAY_BE_STALE at
// runtime with `false` as their fallback. Without this table those
// features silently disable themselves. This table preserves the "on by
// default in the open-source build" semantic. Covered by
// scripts/verify-gates.ts.
const LOCAL_GATE_DEFAULTS: FeatureMap = {
  // P0: pure local
  tengu_keybinding_customization_release: true,
  tengu_streaming_tool_execution2: true,
  tengu_kairos_cron: true,
  tengu_amber_json_tools: true,
  tengu_immediate_model_command: true,
  tengu_basalt_3kr: true,
  tengu_pebble_leaf_prune: true,
  tengu_chair_sermon: true,
  tengu_lodestone_enabled: true,
  tengu_auto_background_agents: true,
  tengu_fgts: true,
  // P1: API-dependent but default on
  tengu_session_memory: true,
  tengu_passport_quail: true,
  tengu_moth_copse: true,
  tengu_coral_fern: true,
  tengu_chomp_inflection: true,
  tengu_hive_evidence: true,
  tengu_kairos_brief: true,
  tengu_sedge_lantern: true,
  tengu_willow_mode: 'dialog',
  // Kill switches (default on)
  tengu_turtle_carbon: true,
  tengu_amber_stoat: true,
  tengu_amber_flint: true,
  tengu_slim_subagent_claudemd: true,
  tengu_birch_trellis: true,
  tengu_collage_kaleidoscope: true,
  tengu_compact_cache_prefix: true,
  tengu_kairos_cron_durable: true,
  tengu_attribution_header: true,
  tengu_slate_prism: true,
}

const refreshed = new EventEmitter()
const configOverrides = new Map<string, FeatureValue>()
let envOverridesParsed = false
let envOverrides: FeatureMap = {}

function parseEnvOverrides(): FeatureMap {
  if (envOverridesParsed) {
    return envOverrides
  }

  envOverridesParsed = true
  const raw = process.env.CLAUDE_CODE_FEATURE_OVERRIDES
  if (!raw) {
    envOverrides = {}
    return envOverrides
  }

  try {
    const parsed = JSON.parse(raw)
    envOverrides =
      parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as FeatureMap)
        : {}
  } catch {
    envOverrides = {}
  }

  return envOverrides
}

function getOverride(name: string): FeatureValue | undefined {
  const envValue = parseEnvOverrides()[name]
  if (envValue !== undefined) return envValue
  return configOverrides.get(name)
}

export async function initializeGrowthBook(): Promise<null> {
  return null
}

export async function getFeatureValue_DEPRECATED<T>(
  feature: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)
}

export function getFeatureValue_CACHED_MAY_BE_STALE<T>(
  feature: string,
  defaultValue?: T,
): T {
  const override = getOverride(feature)
  if (override !== undefined) return override as T
  if (feature in LOCAL_GATE_DEFAULTS) return LOCAL_GATE_DEFAULTS[feature] as T
  return defaultValue as T
}

export function getFeatureValue_CACHED_WITH_REFRESH<T>(
  feature: string,
  defaultValue: T,
  _refreshIntervalMs: number,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue)
}

export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE(
  gate: string,
): boolean {
  return Boolean(getFeatureValue_CACHED_MAY_BE_STALE(gate, false))
}

export async function checkSecurityRestrictionGate(
  gate: string,
): Promise<boolean> {
  return Boolean(getFeatureValue_CACHED_MAY_BE_STALE(gate, false))
}

export async function checkGate_CACHED_OR_BLOCKING(
  gate: string,
): Promise<boolean> {
  return Boolean(getFeatureValue_CACHED_MAY_BE_STALE(gate, false))
}

export function refreshGrowthBookAfterAuthChange(): void {
  refreshed.emit('refresh')
}

export function resetGrowthBook(): void {
  configOverrides.clear()
  envOverrides = {}
  envOverridesParsed = false
  refreshed.removeAllListeners()
}

export async function refreshGrowthBookFeatures(): Promise<void> {
  refreshed.emit('refresh')
}

export function setupPeriodicGrowthBookRefresh(): void {}

export function stopPeriodicGrowthBookRefresh(): void {}

export async function getDynamicConfig_BLOCKS_ON_INIT<T>(
  configName: string,
  defaultValue: T,
): Promise<T> {
  return getFeatureValue_CACHED_MAY_BE_STALE(configName, defaultValue)
}

export function getDynamicConfig_CACHED_MAY_BE_STALE<T>(
  configName: string,
  defaultValue: T,
): T {
  return getFeatureValue_CACHED_MAY_BE_STALE(configName, defaultValue)
}

export function onGrowthBookRefresh(callback: () => void): Unsubscribe {
  refreshed.on('refresh', callback)
  return () => refreshed.off('refresh', callback)
}

export function hasGrowthBookEnvOverride(name: string): boolean {
  return parseEnvOverrides()[name] !== undefined
}

export function getAllGrowthBookFeatures(): FeatureMap {
  return {
    ...parseEnvOverrides(),
    ...Object.fromEntries(configOverrides.entries()),
  }
}

export function getGrowthBookConfigOverrides(): FeatureMap {
  return Object.fromEntries(configOverrides.entries())
}

export function setGrowthBookConfigOverride(
  name: string,
  value: FeatureValue,
): void {
  configOverrides.set(name, value)
  refreshed.emit('refresh')
}

export function clearGrowthBookConfigOverrides(): void {
  if (configOverrides.size === 0) return
  configOverrides.clear()
  refreshed.emit('refresh')
}

export const FeatureFlagProvider = {
  getValue<T>(name: string): T | undefined {
    return getFeatureValue_CACHED_MAY_BE_STALE<T>(name)
  },
  hasEnvOverride(name: string): boolean {
    return hasGrowthBookEnvOverride(name)
  },
  getAll(): Record<string, unknown> {
    return getAllGrowthBookFeatures()
  },
  getConfigOverrides(): Record<string, unknown> {
    return getGrowthBookConfigOverrides()
  },
  setConfigOverride(name: string, value: unknown): void {
    setGrowthBookConfigOverride(name, value)
  },
  clearConfigOverrides(): void {
    clearGrowthBookConfigOverrides()
  },
  onRefresh(callback: () => void): Unsubscribe {
    return onGrowthBookRefresh(callback)
  },
  async refresh(): Promise<void> {
    return refreshGrowthBookFeatures()
  },
} as const
