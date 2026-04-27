// Thin alias for src/utils/teammateContext. Canonical implementation stays
// in src/ because it wires an AsyncLocalStorage; duplicating it across
// package boundaries would break context propagation. This file exists so
// packages/* consumers stay inside V7 §11.2.
// eslint-disable-next-line no-restricted-imports
export {
  createTeammateContext,
  getTeammateContext,
  isInProcessTeammate,
  runWithTeammateContext,
} from './teammateContextAlias.js'
// eslint-disable-next-line no-restricted-imports
export type { TeammateContext } from './teammateContextAlias.js'
