// Forward shim — canonical owner is packages/updater/src/nativeInstaller/installer.ts.
// Both versions had identical install/cleanup logic; only import notation differed.
// Module-level lock state must be a single instance — pre-dedup, src and packages
// each held independent state, defeating the lock semantics.
export * from '@claude-code/updater/nativeInstaller/installer.js'
