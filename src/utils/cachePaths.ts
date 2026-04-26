/**
 * V7 §10.3 facade — moved to `@claude-code/storage/cache-paths`.
 *
 * Wires the storage package's cwd setter to the host's fsOperations-backed
 * cwd() so subprocess environments that fork/chdir are respected.
 */

import {
  CACHE_PATHS,
  setCwdFn,
  setDjb2HashFn,
} from '@claude-code/storage/cache-paths'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'
import { djb2Hash } from '@claude-code/config/hash'

// eslint-disable-next-line custom-rules/no-top-level-side-effects
setCwdFn(() => getFsImplementation().cwd())
// eslint-disable-next-line custom-rules/no-top-level-side-effects
setDjb2HashFn(djb2Hash)

export { CACHE_PATHS }
