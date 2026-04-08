export { resolveMotion, isInclusiveMotion, isLinewiseMotion } from './motions.js'
export {
  executeIndent,
  executeJoin,
  executeLineOp,
  executeOpenLine,
  executeOperatorFind,
  executeOperatorG,
  executeOperatorGg,
  executeOperatorMotion,
  executeOperatorTextObj,
  executePaste,
  executeReplace,
  executeToggleCase,
  executeX,
  type OperatorContext,
} from './operators.js'
export { findTextObject, type TextObjectRange } from './textObjects.js'
export {
  transition,
  type TransitionContext,
  type TransitionResult,
} from './transitions.js'
export {
  FIND_KEYS,
  MAX_VIM_COUNT,
  OPERATORS,
  SIMPLE_MOTIONS,
  TEXT_OBJ_SCOPES,
  TEXT_OBJ_TYPES,
  createInitialPersistentState,
  createInitialVimState,
  isOperatorKey,
  isTextObjScopeKey,
  type CommandState,
  type FindType,
  type Operator,
  type PersistentState,
  type RecordedChange,
  type TextObjScope,
  type VimState,
} from './types.js'
