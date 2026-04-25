// Forward shim — canonical owner is packages/shell/src/bash/shellQuote.ts.
// packages version uses typed `QuotingError` (extends Error) instead of bare Error.
// Both versions otherwise have identical quote/parse semantics.
export * from '@claude-code/shell/bash/shellQuote.js'
