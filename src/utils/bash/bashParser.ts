// Forward shim — canonical owner is packages/shell/src/bash/bashParser.ts.
// This file used to host a 4432-LOC fork that diverged from the canonical
// (4 missing `continue` paths). Kept as a re-export so any lingering
// `import './bashParser.js'` in src/utils/bash/* still resolves.
export * from '@claude-code/shell/bash/bashParser.js'
