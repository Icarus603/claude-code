import { resolveMotion } from './motions.js'
import {
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
import {
  type CommandState,
  FIND_KEYS,
  type FindType,
  isOperatorKey,
  isTextObjScopeKey,
  MAX_VIM_COUNT,
  OPERATORS,
  type Operator,
  SIMPLE_MOTIONS,
  TEXT_OBJ_SCOPES,
  TEXT_OBJ_TYPES,
} from './types.js'

export type TransitionContext = OperatorContext & {
  onUndo?: () => void
  onDotRepeat?: () => void
}

export type TransitionResult = {
  next?: CommandState
  execute?: () => void
}

export function transition(
  state: CommandState,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  switch (state.type) {
    case 'idle':
      return fromIdle(input, ctx)
    case 'count':
      return fromCount(state, input, ctx)
    case 'operator':
      return fromOperator(state, input, ctx)
    case 'operatorCount':
      return fromOperatorCount(state, input, ctx)
    case 'operatorFind':
      return fromOperatorFind(state, input, ctx)
    case 'operatorTextObj':
      return fromOperatorTextObj(state, input, ctx)
    case 'find':
      return fromFind(state, input, ctx)
    case 'g':
      return fromG(state, input, ctx)
    case 'operatorG':
      return fromOperatorG(state, input, ctx)
    case 'replace':
      return fromReplace(state, input, ctx)
    case 'indent':
      return fromIndent(state, input, ctx)
  }
}

function handleNormalInput(
  input: string,
  count: number,
  ctx: TransitionContext,
): TransitionResult | null {
  if (isOperatorKey(input)) {
    return { next: { type: 'operator', op: OPERATORS[input], count } }
  }

  if (SIMPLE_MOTIONS.has(input)) {
    return {
      execute: () => {
        const target = resolveMotion(input, ctx.cursor, count)
        ctx.setOffset(target.offset)
      },
    }
  }

  if (FIND_KEYS.has(input)) {
    return { next: { type: 'find', find: input as FindType, count } }
  }

  if (input === 'g') return { next: { type: 'g', count } }
  if (input === 'r') return { next: { type: 'replace', count } }
  if (input === '>' || input === '<') {
    return { next: { type: 'indent', dir: input, count } }
  }
  if (input === '~') {
    return { execute: () => executeToggleCase(count, ctx) }
  }
  if (input === 'x') {
    return { execute: () => executeX(count, ctx) }
  }
  if (input === 'J') {
    return { execute: () => executeJoin(count, ctx) }
  }
  if (input === 'p' || input === 'P') {
    return { execute: () => executePaste(input === 'p', count, ctx) }
  }
  if (input === 'D') {
    return { execute: () => executeOperatorMotion('delete', '$', 1, ctx) }
  }
  if (input === 'C') {
    return { execute: () => executeOperatorMotion('change', '$', 1, ctx) }
  }
  if (input === 'Y') {
    return { execute: () => executeLineOp('yank', count, ctx) }
  }
  if (input === 'G') {
    return {
      execute: () => {
        if (count === 1) {
          ctx.setOffset(ctx.cursor.startOfLastLine().offset)
        } else {
          ctx.setOffset(ctx.cursor.goToLine(count).offset)
        }
      },
    }
  }
  if (input === '.') {
    return { execute: () => ctx.onDotRepeat?.() }
  }
  if (input === ';' || input === ',') {
    return { execute: () => executeRepeatFind(input === ',', count, ctx) }
  }
  if (input === 'u') {
    return { execute: () => ctx.onUndo?.() }
  }
  if (input === 'i') {
    return { execute: () => ctx.enterInsert(ctx.cursor.offset) }
  }
  if (input === 'I') {
    return {
      execute: () =>
        ctx.enterInsert(ctx.cursor.firstNonBlankInLogicalLine().offset),
    }
  }
  if (input === 'a') {
    return {
      execute: () => {
        const newOffset = ctx.cursor.isAtEnd()
          ? ctx.cursor.offset
          : ctx.cursor.right().offset
        ctx.enterInsert(newOffset)
      },
    }
  }
  if (input === 'A') {
    return {
      execute: () => ctx.enterInsert(ctx.cursor.endOfLogicalLine().offset),
    }
  }
  if (input === 'o') {
    return { execute: () => executeOpenLine('below', ctx) }
  }
  if (input === 'O') {
    return { execute: () => executeOpenLine('above', ctx) }
  }

  return null
}

function handleOperatorInput(
  op: Operator,
  count: number,
  input: string,
  ctx: TransitionContext,
): TransitionResult | null {
  if (isTextObjScopeKey(input)) {
    return {
      next: {
        type: 'operatorTextObj',
        op,
        count,
        scope: TEXT_OBJ_SCOPES[input],
      },
    }
  }

  if (FIND_KEYS.has(input)) {
    return {
      next: { type: 'operatorFind', op, count, find: input as FindType },
    }
  }

  if (SIMPLE_MOTIONS.has(input)) {
    return { execute: () => executeOperatorMotion(op, input, count, ctx) }
  }

  if (input === 'G') {
    return { execute: () => executeOperatorG(op, count, ctx) }
  }

  if (input === 'g') {
    return { next: { type: 'operatorG', op, count } }
  }

  return null
}

function fromIdle(input: string, ctx: TransitionContext): TransitionResult {
  if (/[1-9]/.test(input)) {
    return { next: { type: 'count', digits: input } }
  }
  if (input === '0') {
    return {
      execute: () => ctx.setOffset(ctx.cursor.startOfLogicalLine().offset),
    }
  }

  const result = handleNormalInput(input, 1, ctx)
  if (result) return result
  return {}
}

function fromCount(
  state: Extract<CommandState, { type: 'count' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (/\d/.test(input)) {
    const digits = `${state.digits}${input}`
    if (Number(digits) <= MAX_VIM_COUNT) {
      return { next: { type: 'count', digits } }
    }
  }

  const result = handleNormalInput(input, Number(state.digits), ctx)
  if (result) return result
  return {}
}

function fromOperator(
  state: Extract<CommandState, { type: 'operator' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (/\d/.test(input)) {
    return { next: { type: 'operatorCount', ...state, digits: input } }
  }

  if (input === state.op[0]) {
    return { execute: () => executeLineOp(state.op, state.count, ctx) }
  }

  return handleOperatorInput(state.op, state.count, input, ctx) ?? {}
}

function fromOperatorCount(
  state: Extract<CommandState, { type: 'operatorCount' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (/\d/.test(input)) {
    const digits = `${state.digits}${input}`
    if (Number(digits) <= MAX_VIM_COUNT) {
      return { next: { ...state, digits } }
    }
  }

  return handleOperatorInput(
    state.op,
    state.count * Number(state.digits),
    input,
    ctx,
  ) ?? {}
}

function fromOperatorFind(
  state: Extract<CommandState, { type: 'operatorFind' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  return {
    execute: () =>
      executeOperatorFind(state.op, state.find, input, state.count, ctx),
  }
}

function fromOperatorTextObj(
  state: Extract<CommandState, { type: 'operatorTextObj' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (!TEXT_OBJ_TYPES.has(input)) return {}
  return {
    execute: () =>
      executeOperatorTextObj(state.op, state.scope, input, state.count, ctx),
  }
}

function fromFind(
  state: Extract<CommandState, { type: 'find' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  return {
    execute: () => {
      const targetOffset = ctx.cursor.findCharacter(input, state.find, state.count)
      if (targetOffset !== null) {
        ctx.setOffset(targetOffset)
        ctx.setLastFind(state.find, input)
      }
    },
  }
}

function fromG(
  state: Extract<CommandState, { type: 'g' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (input === 'g') {
    return {
      execute: () => {
        if (state.count === 1) {
          ctx.setOffset(ctx.cursor.startOfFirstLine().offset)
        } else {
          ctx.setOffset(ctx.cursor.goToLine(state.count).offset)
        }
      },
    }
  }
  if (input === 'j') {
    return { execute: () => ctx.setOffset(resolveMotion('gj', ctx.cursor, state.count).offset) }
  }
  if (input === 'k') {
    return { execute: () => ctx.setOffset(resolveMotion('gk', ctx.cursor, state.count).offset) }
  }
  return {}
}

function fromOperatorG(
  state: Extract<CommandState, { type: 'operatorG' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (input === 'g') {
    return { execute: () => executeOperatorGg(state.op, state.count, ctx) }
  }
  return {}
}

function fromReplace(
  state: Extract<CommandState, { type: 'replace' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  return { execute: () => executeReplace(input, state.count, ctx) }
}

function fromIndent(
  state: Extract<CommandState, { type: 'indent' }>,
  input: string,
  ctx: TransitionContext,
): TransitionResult {
  if (input === state.dir) {
    return { execute: () => executeIndent(state.dir, state.count, ctx) }
  }
  return {}
}

function executeRepeatFind(
  reverse: boolean,
  count: number,
  ctx: TransitionContext,
): void {
  const lastFind = ctx.getLastFind()
  if (!lastFind) return
  const type = reverse
    ? lastFind.type === 'f'
      ? 'F'
      : lastFind.type === 'F'
        ? 'f'
        : lastFind.type === 't'
          ? 'T'
          : 't'
    : lastFind.type
  const targetOffset = ctx.cursor.findCharacter(lastFind.char, type, count)
  if (targetOffset !== null) {
    ctx.setOffset(targetOffset)
  }
}
