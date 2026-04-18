/**
 * @claude-code/config/plugin — public surface of the plugin subsystem.
 *
 * V7 §8.6 / §10.1 — plugin discovery / loading / marketplace /
 * installation / validation. Migrated from src/utils/plugins/ in
 * Round 4. All cross-boundary deps flow through ./_deps.ts.
 *
 * Callers should import from the leaf subpaths (e.g.
 * `@claude-code/config/plugin/pluginIdentifier`) to minimize their
 * transitive dependency surface; this barrel is provided as a
 * convenience for the src/ facades.
 */

export * from './types.js'
export * from './schemas.js'
export * from './pluginIdentifier.js'
