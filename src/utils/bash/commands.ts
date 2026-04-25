// Forward shim — canonical owner is packages/shell/src/bash/commands.ts.
// Previously a 1339-LOC duplicate. Both versions had identical command-parsing
// logic; only the prefix-provider import differed. Consolidating ensures the
// module-level prefix caches are a single instance — calling clearCommandPrefixCaches
// from one path used to leave the other path's cache stale.
export * from '@claude-code/shell/bash/commands.js'
