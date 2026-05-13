/**
 * Plugin / skill / agent / output-style / command name collision telemetry —
 * byte-for-byte port of ant v2.1.136 `LzH` + `yF9` (2643.js).
 *
 * Two complementary events:
 *   - `tengu_plugin_folder_shadowed` — ant `yF9`. Fires once per shadowed
 *     folder when a plugin declares an explicit `<component>` list AND a
 *     standard folder also exists for the same component. Component-shadow
 *     check (ant `sc9`) not yet wired; helper kept callable for the future
 *     port.
 *   - `tengu_plugin_name_collision` — ant `LzH`. Fires once per item-name
 *     that has ≥2 *unique* sources contributing it. The `resolves` flavour
 *     attaches `winner_source = entries[last].source` (which is the LAST
 *     observed source — matches ant's `T[T.length-1]`). The `winner_source`
 *     here is observability-only and is NOT necessarily the same as the
 *     loader's deterministic winner (loaders pick earlier-wins or merge
 *     by precedence); this field just tells dashboards which source the
 *     analytics walker landed on last.
 *
 * No behavioural side-effect — purely diagnostic.
 *
 * Ant identifier map (4203.js / 2643.js):
 *   LzH → logNameCollision
 *   yF9 → logFolderShadowed
 *   VF9 → hashItemName (sha256 of `name@marketplace` + telemetry salt)
 *   Uc / Jn1 → buildPluginTelemetryFields (in pluginTelemetry.ts)
 */
import { createHash } from 'crypto'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability'
import { logEvent } from '@claude-code/local-observability'

// Inline ant `VF9` (2643.js) here — pluginTelemetry.ts already implements
// the same hash as `hashPluginId`, but it lives in @claude-code/tool-registry
// which transitively depends on @claude-code/config. Importing it back would
// create a config↔tool-registry cycle. Keeping a 5-line duplicate of a pure
// function is cheaper than adding a third package to host the shared helper.
// The salt must stay identical to pluginTelemetry.ts:PLUGIN_ID_HASH_SALT —
// changing one without the other breaks cross-event joins on item_name_hash.
const PLUGIN_ID_HASH_SALT = 'claude-plugin-telemetry-v1'

function hashItemName(name: string, marketplace?: string): string {
  const key = marketplace ? `${name}@${marketplace.toLowerCase()}` : name
  return createHash('sha256')
    .update(key + PLUGIN_ID_HASH_SALT)
    .digest('hex')
    .slice(0, 16)
}

export type CollisionItemType =
  | 'plugin'
  | 'skill'
  | 'agent'
  | 'outputStyle'
  | 'command'

export type CollisionEntry = {
  /** Item name (skill / agent / command / outputStyle / plugin id). */
  name: string
  /** Source label (e.g. 'user', 'project', 'managed', 'plugin', 'builtin'). */
  source: string
}

/**
 * Ant `yF9` — emit `tengu_plugin_folder_shadowed`. Call once per shadowed
 * folder (the loser, not the winner). Cheap — drops on the floor when
 * telemetry is disabled.
 *
 * Component-shadow detection (ant `sc9`) is not yet wired into the loader;
 * once it is, callers should invoke this helper from the loader path that
 * detects an explicit component list collocated with a standard folder.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _logFolderShadowed(opts: {
  pluginName: string
  marketplace: string | undefined
  component: 'commands' | 'agents' | 'skills' | 'outputStyles' | 'hooks'
}): void {
  // Inline the redacted/hash twins ourselves — we can't import the full
  // buildPluginTelemetryFields helper here without creating a config→
  // tool-registry import cycle (pluginTelemetry depends on @claude-code/
  // config/plugin/pluginIdentifier). The hashPluginId import is fine
  // because it's a single pure function and doesn't transitively pull
  // the config/plugin types graph back in.
  logEvent('tengu_plugin_folder_shadowed', {
    component:
      opts.component as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    plugin_id_hash: hashItemName(
      opts.pluginName,
      opts.marketplace,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}

/**
 * Ant `LzH` — emit `tengu_plugin_name_collision` once per item-name with
 * ≥2 unique sources. Byte-for-byte port of the inner loop:
 *
 * ```js
 * function LzH(H, _, q) {
 *   let K = new Map();
 *   for (let { name: O, source: T } of _) {
 *     let A = K.get(O);
 *     if (A === undefined) K.set(O, [T]);
 *     else A.push(T);
 *   }
 *   for (let [O, T] of K) {
 *     let A = Array.from(new Set(T));     // dedupe sources
 *     if (A.length < 2) continue;          // skip same-source duplicates
 *     d("tengu_plugin_name_collision", {
 *       item_type: H,
 *       _PROTO_skill_name: O,              // PII-tagged column (ant's name)
 *       item_name_hash: VF9(O),            // sha256 hash for aggregation
 *       source_count: A.length,            // UNIQUE count, not raw
 *       sources: A.sort().join(","),       // sorted unique sources
 *       ...(q.resolves && { winner_source: T[T.length - 1] }),
 *     });
 *   }
 * }
 * ```
 *
 * Critical: `source_count` is the *unique* dedupe count, `sources` is the
 * sorted joined string, and `winner_source` is the LAST raw push to the
 * name's entries list — NOT the first, NOT a min-by-precedence pick.
 */
export function logNameCollision(opts: {
  itemType: CollisionItemType
  entries: ReadonlyArray<CollisionEntry>
  resolves: boolean
}): void {
  // Ant builds the map in one pass — name → ordered list of raw sources.
  const buckets = new Map<string, string[]>()
  for (const { name, source } of opts.entries) {
    const arr = buckets.get(name)
    if (arr === undefined) buckets.set(name, [source])
    else arr.push(source)
  }
  for (const [name, sources] of buckets) {
    const uniqueSources = Array.from(new Set(sources))
    if (uniqueSources.length < 2) continue
    logEvent('tengu_plugin_name_collision', {
      item_type:
        opts.itemType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      // Ant uses _PROTO_skill_name even for non-skill item types — keep
      // the column name verbatim for warehouse compatibility.
      _PROTO_skill_name:
        name as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      item_name_hash: hashItemName(
        name,
      ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      source_count: uniqueSources.length,
      sources: uniqueSources
        .sort()
        .join(',') as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      ...(opts.resolves && sources.length > 0
        ? {
            winner_source: sources[
              sources.length - 1
            ] as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
          }
        : {}),
    })
  }
}
