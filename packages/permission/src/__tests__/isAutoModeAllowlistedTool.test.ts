/**
 * Tests for isAutoModeAllowlistedTool — security-critical fast path
 * for the auto-mode classifier. Allowlisted tools bypass classifier
 * checks entirely (no LLM round-trip per call).
 *
 * Wrong allowlist = either:
 *   - Adds an unsafe tool: classifier never sees it, real security
 *     decisions skipped (e.g., adding Bash here would let any command
 *     run unmonitored in auto mode)
 *   - Drops a safe tool: classifier hit on every call, drives up
 *     latency + token spend
 *
 * The set is closed by design — a future tool added without explicit
 * intent should NOT appear here. Tests lock the membership so a
 * "simplify" refactor can't quietly broaden it.
 */
import { describe, expect, test } from 'bun:test'
import { isAutoModeAllowlistedTool } from '../classifierDecision.js'

describe('isAutoModeAllowlistedTool — known safe tools (allowlist)', () => {
  test.each([
    'Read', // FILE_READ_TOOL_NAME
    'Grep', // GREP_TOOL_NAME
    'Glob', // GLOB_TOOL_NAME
    'LSP', // LSP_TOOL_NAME
    'ToolSearch', // TOOL_SEARCH_TOOL_NAME
    'ListMcpResourcesTool', // LIST_MCP_RESOURCES_TOOL_NAME (note: full name)
    'ReadMcpResourceTool', // hardcoded string in classifierDecision
    'TodoWrite',
    'TaskCreate',
    'TaskGet',
    'TaskUpdate',
    'TaskList',
    'TaskStop',
    'TaskOutput',
    'AskUserQuestion',
    'EnterPlanMode',
    'ExitPlanMode',
    'TeamCreate',
    'TeamDelete',
    'SendMessage',
    'Sleep',
    'classify_result', // YOLO_CLASSIFIER_TOOL_NAME
  ])('"%s" → true (in allowlist)', toolName => {
    expect(isAutoModeAllowlistedTool(toolName)).toBe(true)
  })
})

describe('isAutoModeAllowlistedTool — write/edit tools NOT in allowlist', () => {
  test.each(['Bash', 'Edit', 'Write', 'NotebookEdit'])(
    '"%s" → false (must go through classifier)',
    toolName => {
      expect(isAutoModeAllowlistedTool(toolName)).toBe(false)
    },
  )
})

describe('isAutoModeAllowlistedTool — unknown / made-up names', () => {
  test('empty string → false', () => {
    expect(isAutoModeAllowlistedTool('')).toBe(false)
  })

  test('undefined-ish strings → false', () => {
    expect(isAutoModeAllowlistedTool('undefined')).toBe(false)
    expect(isAutoModeAllowlistedTool('null')).toBe(false)
  })

  test('case-sensitive: lowercase variants do NOT match', () => {
    // Tool names are exact strings; lowercase doesn't match.
    expect(isAutoModeAllowlistedTool('grep')).toBe(false)
    expect(isAutoModeAllowlistedTool('todowrite')).toBe(false)
  })

  test('hypothetical future tool name → false', () => {
    expect(isAutoModeAllowlistedTool('SomeFutureTool')).toBe(false)
  })

  test('MCP tool with mcp__ prefix → false (not allowlisted)', () => {
    // MCP tools are user-controlled, must go through classifier.
    expect(isAutoModeAllowlistedTool('mcp__github__list_issues')).toBe(false)
    expect(isAutoModeAllowlistedTool('mcp__filesystem__write_file')).toBe(false)
  })
})

describe('isAutoModeAllowlistedTool — boundary cases', () => {
  test('exact substring of allowlisted tool does NOT match', () => {
    // 'Read' is allowlisted; 'ReadX' should not be.
    expect(isAutoModeAllowlistedTool('ReadX')).toBe(false)
    expect(isAutoModeAllowlistedTool('XRead')).toBe(false)
  })

  test('whitespace around name does NOT trim-match', () => {
    expect(isAutoModeAllowlistedTool(' Read ')).toBe(false)
    expect(isAutoModeAllowlistedTool('\tRead')).toBe(false)
  })

  test('repeated calls return same result (pure function)', () => {
    expect(isAutoModeAllowlistedTool('Read')).toBe(true)
    expect(isAutoModeAllowlistedTool('Read')).toBe(true)
    expect(isAutoModeAllowlistedTool('Bash')).toBe(false)
    expect(isAutoModeAllowlistedTool('Bash')).toBe(false)
  })
})
