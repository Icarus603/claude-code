// Thin alias — canonical owner is src/utils/messages.ts. 5500 LOC of message
// helpers: id-minting counters, message-lookup caches, and shared parsers
// that must stay process-wide singletons. Route packages/* through this alias.
// eslint-disable-next-line no-restricted-imports
export * from 'src/utils/messages.js'
