/**
 * @claude-code/config/env — barrel export.
 *
 * NOTE: `utils.ts` is re-exported individually so the `isInProtectedNamespace`
 * setter is visible alongside the public helpers.
 */

export * from './utils.js'
export * from './validation.js'
export * from './privacy.js'
export * from './git-settings.js'
export * from './paths.js'
export * from './dynamic.js'
