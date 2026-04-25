// Forward shim — canonical owner is packages/updater/src/nativeInstaller/pidLock.ts.
// Identical pidlock logic; only import notation differed. Single-instance critical:
// running two locks against same pidfile defeats the lock entirely.
export * from '@claude-code/updater/nativeInstaller/pidLock.js'
