// Forward shim — canonical owner is packages/storage/src/filePersistence/filePersistence.ts.
// Both versions had identical logic; only import notation differed (process.env vs readEnv).
// Sibling outputsScanner.ts and types.ts in this dir are already forward shims to the same package.
export * from '@claude-code/storage/filePersistence/filePersistence.js'
