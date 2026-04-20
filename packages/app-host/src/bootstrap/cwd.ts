// Thin alias. The canonical owner is src/utils/cwd.ts; consumers under packages/*
// use this path so the V7 §11.2 import-graph check doesn't flag them. Both paths
// must resolve to the same module so the AsyncLocalStorage instance is shared.
export {
  getCwd,
  pwd,
  runWithCwdOverride,
} from 'src/utils/cwd.js'
