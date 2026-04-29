/**
 * Tests for createSyntheticUserCaveatMessage, createModelSwitchBreadcrumbs,
 * createProgressMessage, createToolResultStopMessage — pure message
 * constructors (or constructor + structural transform).
 *
 * These constructors run on hot paths (slash commands, model switches,
 * tool execution interrupts). Wrong UUID generation = duplicate IDs that
 * crash the React reconciler. Wrong tag wrapping = caveat leaks into
 * model context as plain text the model "responds" to.
 */
import { describe, expect, test } from 'bun:test'
import {
  createModelSwitchBreadcrumbs,
  createProgressMessage,
  createSyntheticUserCaveatMessage,
  createToolResultStopMessage,
  formatCommandInputTags,
} from '../messages.js'

describe('createSyntheticUserCaveatMessage', () => {
  test('returns a user message with caveat content wrapped in tag', () => {
    const m = createSyntheticUserCaveatMessage()
    expect(m.type).toBe('user')
    const content = m.message.content
    expect(typeof content).toBe('string')
    expect(content).toContain('local-command-caveat')
    expect(content).toContain('DO NOT respond')
  })

  test('isMeta=true (so the caveat is hidden from transcript display)', () => {
    const m = createSyntheticUserCaveatMessage()
    expect(m.isMeta).toBe(true)
  })

  test('each call yields a fresh UUID (no dup React keys)', () => {
    const a = createSyntheticUserCaveatMessage()
    const b = createSyntheticUserCaveatMessage()
    expect(a.uuid).not.toBe(b.uuid)
  })

  test('content is wrapped in tags (not plain text)', () => {
    const m = createSyntheticUserCaveatMessage()
    const content = m.message.content as string
    expect(content.startsWith('<')).toBe(true)
    expect(content.endsWith('>')).toBe(true)
  })
})

describe('createModelSwitchBreadcrumbs — slash-command-style breadcrumb', () => {
  test('returns 3 messages (caveat + command + stdout)', () => {
    const r = createModelSwitchBreadcrumbs('opus', 'Claude Opus 4.7')
    expect(r).toHaveLength(3)
  })

  test('first message is the caveat (isMeta=true)', () => {
    const [first] = createModelSwitchBreadcrumbs('opus', 'Claude Opus 4.7')
    expect(first?.isMeta).toBe(true)
  })

  test('second message contains the model command', () => {
    const [, second] = createModelSwitchBreadcrumbs('opus', 'Claude Opus 4.7')
    expect(second?.message.content).toContain('/model')
    expect(second?.message.content).toContain('opus')
  })

  test('third message contains the resolvedDisplay (in local-command-stdout tag)', () => {
    const [, , third] = createModelSwitchBreadcrumbs('opus', 'Claude Opus 4.7')
    expect(third?.message.content).toContain('Claude Opus 4.7')
    expect(third?.message.content).toContain('local-command-stdout')
  })

  test('all 3 messages are user-type', () => {
    const r = createModelSwitchBreadcrumbs('opus', 'Display')
    for (const m of r) {
      expect(m.type).toBe('user')
    }
  })

  test('all 3 messages have unique UUIDs', () => {
    const r = createModelSwitchBreadcrumbs('opus', 'Display')
    const uuids = r.map(m => m.uuid)
    expect(new Set(uuids).size).toBe(3)
  })

  test('escapes nothing — modelArg is interpolated as-is into the command tag', () => {
    // Documented: no XSS-like sanitization; caller is trusted (CLI/SDK).
    const r = createModelSwitchBreadcrumbs(
      'opus<script>',
      'evil"display',
    )
    const content = r[1]?.message.content as string
    expect(content).toContain('opus<script>') // inserted verbatim
  })
})

describe('createProgressMessage', () => {
  test('returns a progress message with given toolUseID and data', () => {
    const m = createProgressMessage({
      toolUseID: 'tu_1',
      parentToolUseID: 'tu_parent',
      data: { type: 'bash', stdout: 'hello' } as never,
    })
    expect(m.type).toBe('progress')
    expect(m.toolUseID).toBe('tu_1')
    expect(m.parentToolUseID).toBe('tu_parent')
    expect(m.data).toEqual({ type: 'bash', stdout: 'hello' })
  })

  test('uuid + timestamp are auto-generated', () => {
    const m = createProgressMessage({
      toolUseID: 'tu_1',
      parentToolUseID: 'tu_parent',
      data: {} as never,
    })
    expect(m.uuid).toBeDefined()
    expect(typeof m.uuid).toBe('string')
    expect(m.timestamp).toBeDefined()
    expect(typeof m.timestamp).toBe('string')
  })

  test('timestamp is ISO format', () => {
    const m = createProgressMessage({
      toolUseID: 'tu_1',
      parentToolUseID: 'tu_p',
      data: {} as never,
    })
    expect(m.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
  })

  test('each call gets a fresh UUID', () => {
    const a = createProgressMessage({
      toolUseID: 'tu',
      parentToolUseID: 'p',
      data: {} as never,
    })
    const b = createProgressMessage({
      toolUseID: 'tu',
      parentToolUseID: 'p',
      data: {} as never,
    })
    expect(a.uuid).not.toBe(b.uuid)
  })

  test('data field is the data argument verbatim (not cloned)', () => {
    // Documented: caller-owned data is held by reference.
    const data = { type: 'bash' as const, foo: 'bar' } as never
    const m = createProgressMessage({
      toolUseID: 'tu',
      parentToolUseID: 'p',
      data,
    })
    expect(m.data).toBe(data)
  })
})

describe('createToolResultStopMessage', () => {
  test('returns a tool_result block with is_error=true', () => {
    const r = createToolResultStopMessage('tu_xyz')
    expect(r.type).toBe('tool_result')
    expect(r.is_error).toBe(true)
  })

  test('echoes back the toolUseID', () => {
    const r = createToolResultStopMessage('tu_xyz')
    expect(r.tool_use_id).toBe('tu_xyz')
  })

  test('content is the standard CANCEL_MESSAGE string', () => {
    const r = createToolResultStopMessage('tu_xyz')
    expect(typeof r.content).toBe('string')
    expect((r.content as string).length).toBeGreaterThan(0)
  })

  test('different IDs produce different tool_use_id but same content', () => {
    const a = createToolResultStopMessage('a')
    const b = createToolResultStopMessage('b')
    expect(a.tool_use_id).toBe('a')
    expect(b.tool_use_id).toBe('b')
    expect(a.content).toBe(b.content)
  })
})

describe('formatCommandInputTags (already tested elsewhere; re-verify shape)', () => {
  test('contains all 3 tags: name, message, args', () => {
    const r = formatCommandInputTags('model', 'opus')
    expect(r).toContain('<command-name>/model</command-name>')
    expect(r).toContain('<command-message>model</command-message>')
    expect(r).toContain('<command-args>opus</command-args>')
  })
})
