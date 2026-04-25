// Forward shim — canonical owner is packages/headless-sdk/src/controlTypes.ts.
// V7 reverse-shim flip: ownership moved from src/ to package. Content was
// 34 LOC of pure type aliases; no runtime state to migrate.
export type * from '@claude-code/headless-sdk/controlTypes.js'
