// Thin alias — canonical owner is src/utils/path.ts. Path helpers depend on
// getCwd()'s AsyncLocalStorage + fsOperations singleton, so packages/* MUST
// go through this alias rather than duplicating the underlying runtime state.
// eslint-disable-next-line no-restricted-imports
export {
  expandPath,
  toRelativePath,
  getDirectoryForPath,
  containsPathTraversal,
  sanitizePath,
  normalizePathForConfigKey,
} from 'src/utils/path.js'
