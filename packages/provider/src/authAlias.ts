// Thin alias — canonical owner is src/utils/auth.ts. Holds module-level
// OAuth token cache + API-key helper state that must stay process-wide; route
// packages/* through this alias rather than duplicating the state.
// eslint-disable-next-line no-restricted-imports
export * from 'src/utils/auth.js'
