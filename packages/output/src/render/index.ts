/**
 * @claude-code/output/render — barrel export for Ink-backed render helpers.
 *
 * staticRender lives here because it's a general-purpose "render React →
 * string" utility used by headless JSON output. exportRenderer (which
 * imports concrete Message components) stays in src/ until the REPL
 * Wave-6 migration.
 */

export * from './static-render.js'
