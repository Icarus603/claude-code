// Thin alias — canonical owner is src/history.ts (module-level state +
// fs-based session history file). Consumers live entirely in packages/repl,
// so this shim localizes the src/ bridge.
// eslint-disable-next-line no-restricted-imports
export * from 'src/history.js'
