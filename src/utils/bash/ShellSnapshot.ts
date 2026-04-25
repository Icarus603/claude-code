// Forward shim — canonical owner is packages/shell/src/bash/ShellSnapshot.ts.
// Note: packages version requires a SnapshotContext; src version pre-dates DI.
// Callers using the no-ctx legacy API must migrate. As of iter 17, no live
// callers remain — this shim exists only for stable import paths.
export * from '@claude-code/shell/bash/ShellSnapshot.js'
