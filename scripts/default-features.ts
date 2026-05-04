/**
 * Single source of truth for feature flags enabled at build time.
 *
 * Both `scripts/dev.ts` (dev mode, via Bun -d flags) and `build.ts`
 * (release builds, via Bun.build's `--feature` option) import from
 * here so the lists can't drift. Additional flags can be enabled
 * per-run via FEATURE_<NAME>=1 env vars.
 *
 * See `docs/feature-flags.md` for the full registry.
 */

/**
 * Features ON by default in dev (`bun run dev`) AND release builds.
 * Stable / shipped functionality.
 */
const STABLE_FEATURES = [
  'AGENT_TRIGGERS_REMOTE',
  'CHICAGO_MCP',
  'VOICE_MODE',
  'SHOT_STATS',
  'PROMPT_CACHE_BREAK_DETECTION',
  'TOKEN_BUDGET',
  'NATIVE_CLIPBOARD_IMAGE',
  'BRIDGE_MODE',
  'MCP_SKILLS',
  'TEMPLATES',
  'COORDINATOR_MODE',
  'TRANSCRIPT_CLASSIFIER',
  'MCP_RICH_OUTPUT',
  'MESSAGE_ACTIONS',
  'HISTORY_PICKER',
  'QUICK_SEARCH',
  'CACHED_MICROCOMPACT',
  'REACTIVE_COMPACT',
  'FILE_PERSISTENCE',
  'DUMP_SYSTEM_PROMPT',
  'BREAK_CACHE_COMMAND',
  // P0: local features (upstream)
  'AGENT_TRIGGERS',
  'ULTRATHINK',
  'BUILTIN_EXPLORE_PLAN_AGENTS',
  'LODESTONE',
  // P1: API-dependent features (upstream)
  'EXTRACT_MEMORIES',
  'VERIFICATION_AGENT',
  'KAIROS_BRIEF',
  'KAIROS_DREAM',
  'KAIROS_PUSH',
  'AWAY_SUMMARY',
  'ULTRAPLAN',
  // P2: daemon + remote control server
  'DAEMON',
] as const

/**
 * Helper: collect FEATURE_* env vars and merge with the stable list.
 * Returns the deduplicated set.
 */
export function getEnabledFeatures(env: NodeJS.ProcessEnv = process.env): string[] {
  const envFeatures = Object.keys(env)
    .filter(k => k.startsWith('FEATURE_'))
    .map(k => k.replace('FEATURE_', ''))
  return [...new Set([...STABLE_FEATURES, ...envFeatures])]
}
