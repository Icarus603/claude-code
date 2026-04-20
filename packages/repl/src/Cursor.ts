// Thin alias — canonical owner is src/utils/Cursor.ts (1529 LOC text-input
// cursor math + module-level kill-ring singleton). Consumers span @ant/ink
// (exempt from runtime-boundaries) and packages/repl, which routes via here.
// eslint-disable-next-line no-restricted-imports
export * from 'src/utils/Cursor.js'
