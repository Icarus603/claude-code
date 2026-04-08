import { Cursor } from '../../../../../src/utils/Cursor.js'
import { firstGrapheme, lastGrapheme } from '../../../../../src/utils/intl.js'
import { countCharInString } from '../../../../../src/utils/stringUtils.js'
import {
  isInclusiveMotion,
  isLinewiseMotion,
  resolveMotion,
} from './motions.js'
import { findTextObject } from './textObjects.js'
import type {
  FindType,
  Operator,
  RecordedChange,
  TextObjScope,
} from './types.js'

export type OperatorContext = {
  cursor: Cursor
  text: string
  setText: (text: string) => void
  setOffset: (offset: number) => void
  enterInsert: (offset: number) => void
  getRegister: () => string
  setRegister: (content: string, linewise: boolean) => void
  getLastFind: () => { type: FindType; char: string } | null
  setLastFind: (type: FindType, char: string) => void
  recordChange: (change: RecordedChange) => void
}

export function executeOperatorMotion(
  op: Operator,
  motion: string,
  count: number,
  ctx: OperatorContext,
): void {
  const target = resolveMotion(motion, ctx.cursor, count)
  if (target.equals(ctx.cursor)) return

  const range = getOperatorRange(ctx.cursor, target, motion, op, count)
  applyOperator(op, range.from, range.to, ctx, range.linewise)
  ctx.recordChange({ type: 'operator', op, motion, count })
}

export function executeOperatorFind(
  op: Operator,
  findType: FindType,
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  const targetOffset = ctx.cursor.findCharacter(char, findType, count)
  if (targetOffset === null) return

  const target = new Cursor(ctx.cursor.measuredText, targetOffset)
  const range = getOperatorRangeForFind(ctx.cursor, target, findType)

  applyOperator(op, range.from, range.to, ctx)
  ctx.setLastFind(findType, char)
  ctx.recordChange({ type: 'operatorFind', op, find: findType, char, count })
}

export function executeOperatorTextObj(
  op: Operator,
  scope: TextObjScope,
  objType: string,
  count: number,
  ctx: OperatorContext,
): void {
  const range = findTextObject(
    ctx.text,
    ctx.cursor.offset,
    objType,
    scope === 'inner',
  )
  if (!range) return

  applyOperator(op, range.start, range.end, ctx)
  ctx.recordChange({ type: 'operatorTextObj', op, objType, scope, count })
}

export function executeLineOp(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const text = ctx.text
  const lines = text.split('\n')
  const currentLine = countCharInString(text.slice(0, ctx.cursor.offset), '\n')
  const linesToAffect = Math.min(count, lines.length - currentLine)
  const lineStart = ctx.cursor.startOfLogicalLine().offset
  let lineEnd = lineStart
  for (let i = 0; i < linesToAffect; i++) {
    const nextNewline = text.indexOf('\n', lineEnd)
    lineEnd = nextNewline === -1 ? text.length : nextNewline + 1
  }

  let content = text.slice(lineStart, lineEnd)
  if (!content.endsWith('\n')) {
    content = content + '\n'
  }
  ctx.setRegister(content, true)

  if (op === 'yank') {
    ctx.setOffset(lineStart)
  } else if (op === 'delete') {
    let deleteStart = lineStart
    const deleteEnd = lineEnd

    if (
      deleteEnd === text.length &&
      deleteStart > 0 &&
      text[deleteStart - 1] === '\n'
    ) {
      deleteStart -= 1
    }

    const newText = text.slice(0, deleteStart) + text.slice(deleteEnd)
    ctx.setText(newText || '')
    const maxOff = Math.max(
      0,
      newText.length - (lastGrapheme(newText).length || 1),
    )
    ctx.setOffset(Math.min(deleteStart, maxOff))
  } else if (op === 'change') {
    if (lines.length === 1) {
      ctx.setText('')
      ctx.enterInsert(0)
    } else {
      const beforeLines = lines.slice(0, currentLine)
      const afterLines = lines.slice(currentLine + linesToAffect)
      const newText = [...beforeLines, '', ...afterLines].join('\n')
      ctx.setText(newText)
      ctx.enterInsert(lineStart)
    }
  }

  ctx.recordChange({ type: 'operator', op, motion: op[0]!, count })
}

export function executeX(count: number, ctx: OperatorContext): void {
  const from = ctx.cursor.offset

  if (from >= ctx.text.length) return

  let endCursor = ctx.cursor
  for (let i = 0; i < count && !endCursor.isAtEnd(); i++) {
    endCursor = endCursor.right()
  }
  const to = endCursor.offset

  const deleted = ctx.text.slice(from, to)
  const newText = ctx.text.slice(0, from) + ctx.text.slice(to)

  ctx.setRegister(deleted, false)
  ctx.setText(newText)
  const maxOff = Math.max(
    0,
    newText.length - (lastGrapheme(newText).length || 1),
  )
  ctx.setOffset(Math.min(from, maxOff))
  ctx.recordChange({ type: 'x', count })
}

export function executeReplace(
  char: string,
  count: number,
  ctx: OperatorContext,
): void {
  let offset = ctx.cursor.offset
  let newText = ctx.text

  for (let i = 0; i < count && offset < newText.length; i++) {
    const graphemeLen = firstGrapheme(newText.slice(offset)).length || 1
    newText =
      newText.slice(0, offset) + char + newText.slice(offset + graphemeLen)
    offset += char.length
  }

  ctx.setText(newText)
  ctx.setOffset(Math.max(0, offset - char.length))
  ctx.recordChange({ type: 'replace', char, count })
}

export function executeToggleCase(count: number, ctx: OperatorContext): void {
  const startOffset = ctx.cursor.offset

  if (startOffset >= ctx.text.length) return

  let newText = ctx.text
  let offset = startOffset
  let toggled = 0

  while (offset < newText.length && toggled < count) {
    const grapheme = firstGrapheme(newText.slice(offset))
    const graphemeLen = grapheme.length

    const toggledGrapheme =
      grapheme === grapheme.toUpperCase()
        ? grapheme.toLowerCase()
        : grapheme.toUpperCase()

    newText =
      newText.slice(0, offset) +
      toggledGrapheme +
      newText.slice(offset + graphemeLen)
    offset += toggledGrapheme.length
    toggled++
  }

  ctx.setText(newText)
  ctx.setOffset(offset)
  ctx.recordChange({ type: 'toggleCase', count })
}

export function executeJoin(count: number, ctx: OperatorContext): void {
  const text = ctx.text
  const lines = text.split('\n')
  const currentLine = countCharInString(text.slice(0, ctx.cursor.offset), '\n')
  if (currentLine >= lines.length - 1) return

  const endLine = Math.min(currentLine + count, lines.length - 1)
  const joined = lines.slice(currentLine, endLine + 1).join(' ')
  const newLines = [
    ...lines.slice(0, currentLine),
    joined,
    ...lines.slice(endLine + 1),
  ]
  ctx.setText(newLines.join('\n'))
  ctx.setOffset(ctx.cursor.startOfLogicalLine().offset)
  ctx.recordChange({ type: 'join', count })
}

export function executeOpenLine(
  direction: 'above' | 'below',
  ctx: OperatorContext,
): void {
  const cursor = ctx.cursor
  const lineStart = cursor.startOfLogicalLine().offset
  const insertOffset =
    direction === 'above' ? lineStart : cursor.endOfLogicalLine().offset
  const insertText = direction === 'above' ? '\n' : '\n'
  const newText =
    ctx.text.slice(0, insertOffset) + insertText + ctx.text.slice(insertOffset)
  const offset = direction === 'above' ? insertOffset : insertOffset + 1
  ctx.setText(newText)
  ctx.enterInsert(offset)
  ctx.recordChange({ type: 'openLine', direction })
}

export function executeIndent(
  dir: '>' | '<',
  count: number,
  ctx: OperatorContext,
): void {
  const lineStart = ctx.cursor.startOfLogicalLine().offset
  const lineEnd = ctx.cursor.endOfLogicalLine().offset
  const line = ctx.text.slice(lineStart, lineEnd)
  const updated =
    dir === '>'
      ? `${'  '.repeat(count)}${line}`
      : line.replace(new RegExp(`^( {1,${count * 2}}|\t{1,${count}})`), '')
  ctx.setText(ctx.text.slice(0, lineStart) + updated + ctx.text.slice(lineEnd))
  ctx.setOffset(lineStart)
  ctx.recordChange({ type: 'indent', dir, count })
}

export function executePaste(
  after: boolean,
  count: number,
  ctx: OperatorContext,
): void {
  const content = ctx.getRegister()
  if (!content) return
  const insertOffset = after
    ? ctx.cursor.isAtEnd()
      ? ctx.cursor.offset
      : ctx.cursor.right().offset
    : ctx.cursor.offset
  const inserted = content.repeat(count)
  ctx.setText(
    ctx.text.slice(0, insertOffset) + inserted + ctx.text.slice(insertOffset),
  )
  ctx.setOffset(insertOffset + inserted.length - 1)
}

export function executeOperatorG(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  if (count === 1) {
    applyOperator(op, ctx.cursor.offset, ctx.text.length, ctx, true)
  } else {
    const target = ctx.cursor.goToLine(count)
    applyOperator(op, ctx.cursor.offset, target.offset, ctx, true)
  }
}

export function executeOperatorGg(
  op: Operator,
  count: number,
  ctx: OperatorContext,
): void {
  const target = count === 1 ? ctx.cursor.startOfFirstLine() : ctx.cursor.goToLine(count)
  applyOperator(op, target.offset, ctx.cursor.offset, ctx, true)
}

function getOperatorRange(
  cursor: Cursor,
  target: Cursor,
  motion: string,
  op: Operator,
  count: number,
): { from: number; to: number; linewise: boolean } {
  const forward = target.offset >= cursor.offset
  let from = forward ? cursor.offset : target.offset
  let to = forward ? target.offset : cursor.offset
  let linewise = false

  if (isLinewiseMotion(motion)) {
    from = forward ? cursor.startOfLogicalLine().offset : target.startOfLogicalLine().offset
    to = forward ? target.endOfLogicalLine().offset : cursor.endOfLogicalLine().offset
    linewise = true
  } else if (forward && (isInclusiveMotion(motion) || op === 'change')) {
    to = Math.min(cursor.text.length, target.right().offset)
  }

  if (op === 'change' && motion === 'w' && count === 1) {
    while (to > from && /\s/.test(cursor.text[to - 1]!)) {
      to -= 1
    }
  }

  return { from, to, linewise }
}

function getOperatorRangeForFind(
  cursor: Cursor,
  target: Cursor,
  findType: FindType,
): { from: number; to: number } {
  const forward = target.offset >= cursor.offset
  const from = forward ? cursor.offset : target.offset
  const to = forward ? target.right().offset : cursor.offset
  return findType === 't' || findType === 'T'
    ? { from, to: target.offset }
    : { from, to }
}

function applyOperator(
  op: Operator,
  from: number,
  to: number,
  ctx: OperatorContext,
  linewise = false,
): void {
  const start = Math.min(from, to)
  const end = Math.max(from, to)
  const deleted = ctx.text.slice(start, end)
  ctx.setRegister(deleted, linewise)

  if (op === 'yank') {
    ctx.setOffset(start)
    return
  }

  const newText = ctx.text.slice(0, start) + ctx.text.slice(end)
  ctx.setText(newText)

  if (op === 'change') {
    ctx.enterInsert(start)
    return
  }

  const maxOff = Math.max(0, newText.length - (lastGrapheme(newText).length || 1))
  ctx.setOffset(Math.min(start, maxOff))
}
