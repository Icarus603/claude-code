# @claude-code/config

Settings, env gates, platform detection, plugin loader, lazy schema
validation, and a small leaf-utility drawer.

V7 §8.4 — single source of truth for read-time configuration. Other
packages must go through this surface (`readEnv`, `getInitialSettings`,
`platform`) rather than touching process.env or fs directly.

## Subpaths

| Path | Owns |
|------|------|
| `./settings` | `getInitialSettings` (renamed from `getSettings_DEPRECATED` 2026-04-29), settings layering (user/project/local/managed/policy), schema validation |
| `./feature-flags` | `getFeatureValue_CACHED_MAY_BE_STALE` + GrowthBook stub fallback |
| `./platform` | `getPlatform()` — process.platform with a single source of truth |
| `./env/*` | `readEnv`, `isEnvTruthy`, `getClaudeConfigHomeDir`, env-truthy parsing |
| `./plugin/*` | Plugin loader, marketplace manager, manifest validation |
| `./frontmatterParser` | YAML frontmatter parsing for skills/commands/agents (V8 — moved here from agent/ to break the agent → config cycle) |
| `./yaml` | `parseYaml` wrapper around Bun.YAML / npm yaml |
| `./mcpConfigSchema` | All MCP server config-shape Zod schemas (V8 — moved here from mcp-runtime/types to break the config → mcp-runtime cycle); runtime types like `ConnectedMCPServer` stay in mcp-runtime |
| `./utils/expandTilde` | `~/foo` → `$HOME/foo` (no `~user` resolution; security-conservative) |
| `./utils/markdownDescription` | First-line-of-markdown extraction for skill/command descriptions |
| `./utils/envExpansion` | `${VAR}` / `${VAR:-default}` expansion for MCP env config (the `:-` bug is fixed since 2026-04-29) |
| `./utils/argumentSubstitution` | `$ARGUMENTS` / `$0` / named-arg substitution for slash command bodies |
