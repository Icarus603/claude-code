export type Operator = 'delete' | 'change' | 'yank'

export type FindType = 'f' | 'F' | 't' | 'T'

export type TextObjScope = 'inner' | 'around'

export type VimState =
  | { mode: 'INSERT'; insertedText: string }
  | { mode: 'NORMAL'; command: CommandState }

export type CommandState =
  | { type: 'idle' }
  | { type: 'count'; digits: string }
  | { type: 'operator'; op: Operator; count: number }
  | { type: 'operatorCount'; op: Operator; count: number; digits: string }
  | { type: 'operatorFind'; op: Operator; count: number; find: FindType }
  | {
      type: 'operatorTextObj'
      op: Operator
      count: number
      scope: TextObjScope
    }
  | { type: 'find'; find: FindType; count: number }
  | { type: 'g'; count: number }
  | { type: 'operatorG'; op: Operator; count: number }
  | { type: 'replace'; count: number }
  | { type: 'indent'; dir: '>' | '<'; count: number }

export type PersistentState = {
  lastChange: RecordedChange | null
  lastFind: { type: FindType; char: string } | null
  register: string
  registerIsLinewise: boolean
}

export type RecordedChange =
  | { type: 'insert'; text: string }
  | {
      type: 'operator'
      op: Operator
      motion: string
      count: number
    }
  | {
      type: 'operatorTextObj'
      op: Operator
      objType: string
      scope: TextObjScope
      count: number
    }
  | {
      type: 'operatorFind'
      op: Operator
      find: FindType
      char: string
      count: number
    }
  | { type: 'replace'; char: string; count: number }
  | { type: 'x'; count: number }
  | { type: 'toggleCase'; count: number }
  | { type: 'indent'; dir: '>' | '<'; count: number }
  | { type: 'openLine'; direction: 'above' | 'below' }
  | { type: 'join'; count: number }

export const OPERATORS = {
  d: 'delete',
  c: 'change',
  y: 'yank',
} as const satisfies Record<string, Operator>

export function isOperatorKey(key: string): key is keyof typeof OPERATORS {
  return key in OPERATORS
}

export const SIMPLE_MOTIONS = new Set([
  'h',
  'l',
  'j',
  'k',
  'w',
  'b',
  'e',
  'W',
  'B',
  'E',
  '0',
  '^',
  '$',
])

export const FIND_KEYS = new Set(['f', 'F', 't', 'T'])

export const TEXT_OBJ_SCOPES = {
  i: 'inner',
  a: 'around',
} as const satisfies Record<string, TextObjScope>

export function isTextObjScopeKey(
  key: string,
): key is keyof typeof TEXT_OBJ_SCOPES {
  return key in TEXT_OBJ_SCOPES
}

export const TEXT_OBJ_TYPES = new Set([
  'w',
  'W',
  '"',
  "'",
  '`',
  '(',
  ')',
  'b',
  '[',
  ']',
  '{',
  '}',
  'B',
  '<',
  '>',
])

export const MAX_VIM_COUNT = 10000

export function createInitialVimState(): VimState {
  return { mode: 'INSERT', insertedText: '' }
}

export function createInitialPersistentState(): PersistentState {
  return {
    lastChange: null,
    lastFind: null,
    register: '',
    registerIsLinewise: false,
  }
}
