// Thin alias for src/utils/slowOperations. Canonical implementation stays in
// src/ until its debug.js dep is migrated; this file exists so packages/*
// consumers stay inside V7 §11.2 boundaries.
// eslint-disable-next-line no-restricted-imports
export {
  SLOW_OPERATION_THRESHOLD_MS,
  callerFrame,
  clone,
  cloneDeep,
  jsonParse,
  jsonStringify,
  slowLogging,
  writeFileSync_DEPRECATED,
} from 'src/utils/slowOperations.js'
