// Thin alias — canonical owner is src/utils/cleanupRegistry.ts. The registry
// holds a module-level Set that must stay a process-wide singleton, so
// packages/* MUST go through this alias (not duplicate the Set).
// eslint-disable-next-line no-restricted-imports
export {
  registerCleanup,
  runCleanupFunctions,
} from 'src/utils/cleanupRegistry.js'
