import { test, expect } from 'bun:test'
import { isDeferredTool } from '../../ToolSearchTool/prompt.js'
import { AskUserQuestionTool } from '../AskUserQuestionTool.js'

test('AskUserQuestion is NOT deferred — must be callable first-turn without ToolSearch', () => {
  expect(AskUserQuestionTool.shouldDefer).toBeUndefined()
  expect(isDeferredTool(AskUserQuestionTool as never)).toBe(false)
})
