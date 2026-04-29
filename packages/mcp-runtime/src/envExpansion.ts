// Forward shim — moved to @claude-code/config/utils/envExpansion to break
// the config → mcp-runtime cycle that forced a lazy-require fallback in
// config/plugin/_deps.ts. Re-exported so existing imports keep working.
export { expandEnvVarsInString } from '@claude-code/config/utils/envExpansion.js'
