/**
 * Computes `{attributionAgent, attributionSkill, attributionPlugin}` metadata
 * from the current querySource + spawnedBySkill + activeSkill.
 *
 * ant 2599.js La/yp1/d78 + 2547.js zAH/Z98 byte-identical port.
 *
 * Used by:
 *   - claudeLegacyRuntime: spread into assistant message events sent to SDK
 *     consumers, so tools downstream can route by agent/skill provenance.
 *   - logEvent attribution payloads (telemetry).
 *
 * @dynamicRequire
 */

/**
 * Normalize a querySource string to its broad family. ant 2547.js zAH.
 * Returns 'main' for SDK / repl-main-thread; 'subagent' for agent:* or
 * hook_agent / verification_agent; 'auxiliary' for everything else.
 */
export function querySourceFamily(querySource: string | undefined): 'main' | 'subagent' | 'auxiliary' | undefined {
  if (querySource === undefined) return undefined
  if (querySource.startsWith('repl_main_thread') || querySource === 'sdk') return 'main'
  if (querySource.startsWith('agent:') || querySource === 'hook_agent' || querySource === 'verification_agent') return 'subagent'
  return 'auxiliary'
}

/** Extract plugin name from `pluginName:skillName` slash-separated id. ant Z98. */
export function skillToPlugin(skillId: string): string | undefined {
  const i = skillId.indexOf(':')
  return i > 0 ? skillId.slice(0, i) : undefined
}

interface SkillBlock {
  attributionSkill?: string
  attributionPlugin?: string
}

/** ant 2599.js d78 — produce {attributionSkill, attributionPlugin} for a skill name. */
function skillAttribution(skillName: string | undefined, pluginOverride?: string): SkillBlock {
  if (!skillName) return pluginOverride ? { attributionPlugin: pluginOverride } : {}
  const plugin = skillToPlugin(skillName) ?? pluginOverride
  return {
    attributionSkill: skillName,
    ...(plugin && { attributionPlugin: plugin }),
  }
}

export interface AttributionMetadata {
  attributionAgent?: string
  attributionSkill?: string
  attributionPlugin?: string
}

/**
 * Compute attribution metadata for an in-flight query.
 * ant 2599.js yp1 byte-identical:
 *   - querySource = "agent:builtin:<name>"  → agent = <name>, + skill block
 *   - querySource = "agent:custom:<name>"   → agent = <name>, + skill block (with custom-plugin override)
 *   - querySource = main + activeSkill set  → skill block only (agent omitted)
 *   - else                                  → empty
 *
 * The wrapper (ant La) is exception-safe — returns {} on any throw.
 */
export function computeAttributionMetadata(
  querySource: string | undefined,
  spawnedBySkill: string | undefined,
  activeSkill: string | undefined,
): AttributionMetadata {
  try {
    if (!querySource) return {}
    if (querySource.startsWith('agent:builtin:')) {
      return { attributionAgent: querySource.slice('agent:builtin:'.length), ...skillAttribution(spawnedBySkill) }
    }
    if (querySource.startsWith('agent:custom:')) {
      const name = querySource.slice('agent:custom:'.length)
      return { attributionAgent: name, ...skillAttribution(spawnedBySkill, skillToPlugin(name)) }
    }
    if (querySourceFamily(querySource) === 'main' && activeSkill) {
      return skillAttribution(activeSkill)
    }
    return {}
  } catch {
    return {}
  }
}
