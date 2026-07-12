import { describe, expect, test } from 'bun:test'
import {
  isReservedDesktopPaneMcpServer,
  isReservedMcpServerName,
} from '../reservedNames.js'

describe('reserved MCP names', () => {
  test('reserves Claude Preview and Claude Browser spellings', () => {
    expect(isReservedDesktopPaneMcpServer('Claude Preview')).toBe(true)
    expect(isReservedDesktopPaneMcpServer('claude-browser')).toBe(true)
    expect(isReservedDesktopPaneMcpServer('claude_browser')).toBe(true)
  })

  test('keeps the existing Claude in Chrome reservation', () => {
    expect(isReservedMcpServerName('claude-in-chrome')).toBe(true)
    expect(isReservedMcpServerName('my-browser')).toBe(false)
  })
})
