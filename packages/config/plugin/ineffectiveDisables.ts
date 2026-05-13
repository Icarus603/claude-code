/**
 * Detect plugins the user disabled in `userSettings.enabledPlugins`
 * but which some higher-precedence settings layer (project / local /
 * flag / managed policy) keeps enabled.
 *
 * Port of ant v2.1.136 `p8K` (4203.js m8K module) + `yE8` (formatter)
 * + `W33` (advice text).
 *
 * Used by /doctor to surface "your user disable is being shadowed by
 * X settings — change it there to take effect", and by /doctor:fix
 * to include remediation lines in the fix prompt.
 *
 * Critical semantic: ant walks ALL enabled sources after userSettings
 * IN ORDER, and **resets** `overriddenBy` if a LATER source ALSO
 * disables it. So a chain like
 *   project=true, local=false
 * yields NO override (because local re-disables), while
 *   project=true, local=true
 * yields `{overriddenBy: 'local'}` (the LAST enabling source wins).
 *
 * Ant identifier map:
 *   p8K → detectIneffectiveDisables
 *   yE8 → formatIneffectiveDisable
 *   W33 → buildIneffectiveDisableAdvice (helper)
 *   yR  → getEnabledSettingSources (ccb canonical name)
 *   Dr  → shortSourceName (ccb humanized name)
 */
import { getSettingsForSource } from '../settings/settings.js'
import { getEnabledSettingSources } from '../settings/constants.js'

export type IneffectiveDisableSource =
  | 'projectSettings'
  | 'localSettings'
  | 'flagSettings'
  | 'policySettings'

export type IneffectiveDisable = {
  pluginId: string
  /**
   * The higher-precedence source that re-enables this plugin. The
   * user's intent (false in userSettings) is overridden by
   * `overriddenBy`. Named after ant `K.push({pluginId, overriddenBy})`.
   */
  overriddenBy: IneffectiveDisableSource
}

function readEnabledPlugins(
  source: 'userSettings' | IneffectiveDisableSource,
): Record<string, boolean | undefined> | undefined {
  const settings = getSettingsForSource(source)
  const ep = (
    settings as { enabledPlugins?: Record<string, boolean | undefined> } | null
  )?.enabledPlugins
  return ep
}

/**
 * Ant `Dr` — short humanized name for a settings source. Used in the
 * sentence template "...is enabled by ${shortSourceName(source)}
 * settings...". Note that `localSettings` becomes "project,
 * gitignored" so the user knows which file to edit.
 */
function shortSourceName(source: IneffectiveDisableSource): string {
  switch (source) {
    case 'projectSettings':
      return 'project'
    case 'localSettings':
      return 'project, gitignored'
    case 'flagSettings':
      return 'cli flag'
    case 'policySettings':
      return 'managed'
  }
}

/**
 * Ant `W33` — per-source remediation hint. Empty string for
 * `userSettings` case in ant (kept here for completeness).
 */
function buildIneffectiveDisableAdvice(d: IneffectiveDisable): string {
  switch (d.overriddenBy) {
    case 'projectSettings':
      return `To opt out, set "enabledPlugins": {"${d.pluginId}": false} in .claude/settings.local.json.`
    case 'localSettings':
      return 'To opt out, change it to false in .claude/settings.local.json (that file currently enables it).'
    case 'flagSettings':
      return `This comes from the --settings flag; .claude/settings.local.json won't override it. Remove "${d.pluginId}" from the --settings value.`
    case 'policySettings':
      return "Managed policy can't be overridden locally — contact your administrator."
  }
}

/**
 * Ant `p8K` (4203.js) — byte-for-byte port.
 *
 * 1. Get the list of allowed/enabled settings sources in canonical
 *    order. If `userSettings` isn't in the merge chain we have
 *    nothing to detect (the user can't have a setting to override).
 * 2. Read user's enabledPlugins map. Empty/absent → no overrides.
 * 3. For each entry that the user set to `false`:
 *    - Walk every OTHER allowed source IN ORDER.
 *    - If that layer doesn't mention the plugin (`undefined`) →
 *      ignore that layer.
 *    - If that layer ALSO disables it → RESET `overriddenBy` to
 *      `null` (a later disable cancels an earlier enable).
 *    - Otherwise (layer enables it) → set `overriddenBy = source`.
 *    - LAST enabling source in the walk wins (matches ant's
 *      simple assignment in the loop).
 * 4. If after the walk `overriddenBy` is non-null → push to result.
 */
export function detectIneffectiveDisables(): IneffectiveDisable[] {
  const enabledSources = getEnabledSettingSources()
  if (!enabledSources.includes('userSettings')) return []
  const userEnabledPlugins = readEnabledPlugins('userSettings')
  if (!userEnabledPlugins) return []

  // Sources to walk after userSettings — preserve canonical order so
  // the "last enabling source wins" semantics match ant.
  const otherSources = enabledSources.filter(
    s => s !== 'userSettings',
  ) as IneffectiveDisableSource[]

  const out: IneffectiveDisable[] = []
  for (const [pluginId, value] of Object.entries(userEnabledPlugins)) {
    if (value !== false) continue
    let overriddenBy: IneffectiveDisableSource | null = null
    for (const source of otherSources) {
      const layer = readEnabledPlugins(source)
      const v = layer?.[pluginId]
      if (v === undefined) continue
      // Ant: `A = $ === !1 ? null : z` — a later disabling layer
      // RESETS the override so we don't false-flag a chain that
      // ends in another disable.
      overriddenBy = v === false ? null : source
    }
    if (overriddenBy === null) continue
    out.push({ pluginId, overriddenBy })
  }
  return out
}

/**
 * Ant `yE8` — human-readable message for one override.
 *   "${pluginId}" is enabled by ${shortSourceName} settings,
 *    which override your user setting. ${advice}
 */
export function formatIneffectiveDisable(d: IneffectiveDisable): string {
  const sourceName = shortSourceName(d.overriddenBy)
  return `"${d.pluginId}" is enabled by ${sourceName} settings, which override your user setting. ${buildIneffectiveDisableAdvice(d)}`
}
