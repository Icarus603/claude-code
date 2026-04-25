// Forward shim — canonical owner is packages/config/settings/schemas/hooks.ts.
// V7 §8.6 — config owns settings schemas. HOOK_EVENTS/SHELL_TYPES inlined
// in canonical to avoid cross-layer deps; this facade preserves src/ imports.
export * from '@claude-code/config/settings/schemas/hooks'
