// Thin alias — canonical owner is src/utils/fsOperations.ts. The fs
// implementation holds a module-level `fsImplementation` singleton that tests
// swap via setFsImplementation(); packages/* MUST go through this alias rather
// than duplicating the slot.
// eslint-disable-next-line no-restricted-imports
export {
  type FsOperations,
  safeResolvePath,
  isDuplicatePath,
  resolveDeepestExistingAncestorSync,
  getPathsForPermissionCheck,
  NodeFsOperations,
  setFsImplementation,
  getFsImplementation,
  setOriginalFsImplementation,
  type ReadFileRangeResult,
  readFileRange,
  tailFile,
  readLinesReverse,
} from 'src/utils/fsOperations.js'
