// Forward shim — canonical owner is packages/provider/src/vcr.ts.
// Both versions had identical logic; only env-access notation differed
// (process.env → readEnv from @claude-code/config/env/utils).
export * from '@claude-code/provider/vcr.js'
