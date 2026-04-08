import { EventEmitter } from 'events'

type FeatureValue = unknown
type FeatureMap = Record<string, FeatureValue>
type Unsubscribe = () => void

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
  return (override !== undefined ? override : defaultValue) as T
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
