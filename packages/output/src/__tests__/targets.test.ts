import { describe, expect, test } from 'bun:test'
import { JsonOutputTarget } from '../targets/json.js'
import { SilentOutputTarget } from '../targets/silent.js'
import { TerminalOutputTarget } from '../targets/terminal.js'

describe('JsonOutputTarget', () => {
  test('emit() JSON-serializes the event into the writer', () => {
    const lines: string[] = []
    const target = new JsonOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'message', value: { text: 'hi' } })
    expect(lines).toEqual(['{"type":"message","value":{"text":"hi"}}'])
  })

  test('multiple emits append; one line per event', () => {
    const lines: string[] = []
    const target = new JsonOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'tool_progress', value: 1 })
    target.emit({ type: 'tool_progress', value: 2 })
    expect(lines).toHaveLength(2)
  })

  test('error event uses .error field, NOT .value', () => {
    // The OutputEvent union has separate shapes; JSON target round-trips
    // each shape verbatim. Document this — terminal target is the one
    // that pulls .error out for human display.
    const lines: string[] = []
    const target = new JsonOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'error', error: 'boom' })
    expect(lines[0]).toBe('{"type":"error","error":"boom"}')
  })

  test('arbitrary type strings (open union) work', () => {
    // OutputEvent's last variant is { type: string; ...rest } — extensible.
    const lines: string[] = []
    const target = new JsonOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'custom_event', extra: 'data' })
    expect(lines[0]).toBe('{"type":"custom_event","extra":"data"}')
  })

  test('default writer falls back to console.log when no fn provided', () => {
    // Smoke-test that the default-arg overload doesn't crash. We can't
    // intercept console.log easily without polluting the global, so just
    // verify the constructor succeeds and emit doesn't throw.
    const target = new JsonOutputTarget()
    // Override stdout to make this test's noise invisible.
    const origLog = console.log
    let captured: unknown = null
    console.log = (line: unknown) => {
      captured = line
    }
    try {
      target.emit({ type: 'message', value: 'x' })
      expect(captured).toBe('{"type":"message","value":"x"}')
    } finally {
      console.log = origLog
    }
  })

  test('does not implement flush() or close() (optional methods)', () => {
    const target = new JsonOutputTarget()
    expect((target as { flush?: unknown }).flush).toBeUndefined()
    expect((target as { close?: unknown }).close).toBeUndefined()
  })
})

describe('SilentOutputTarget', () => {
  test('emit() returns void / undefined', () => {
    const target = new SilentOutputTarget()
    const result = target.emit({ type: 'message', value: 'x' })
    expect(result).toBeUndefined()
  })

  test('emit() does not throw on any event type', () => {
    const target = new SilentOutputTarget()
    expect(() => target.emit({ type: 'message', value: 'a' })).not.toThrow()
    expect(() => target.emit({ type: 'error', error: 'boom' })).not.toThrow()
    expect(() => target.emit({ type: 'unknown_x' })).not.toThrow()
  })

  test('does not implement flush() or close()', () => {
    // Used as a no-op target in tests / CI / batch modes — implementing
    // optional methods would defeat the "do nothing" purpose.
    const target = new SilentOutputTarget()
    expect((target as { flush?: unknown }).flush).toBeUndefined()
    expect((target as { close?: unknown }).close).toBeUndefined()
  })
})

describe('TerminalOutputTarget', () => {
  test('error event → human-friendly "[error] {msg}"', () => {
    const lines: string[] = []
    const target = new TerminalOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'error', error: 'something failed' })
    expect(lines[0]).toBe('[error] something failed')
  })

  test('error event with Error object uses String(error)', () => {
    // String(new Error('msg')) === 'Error: msg'.
    const lines: string[] = []
    const target = new TerminalOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'error', error: new Error('boom') })
    expect(lines[0]).toBe('[error] Error: boom')
  })

  test('non-error event JSON-serialized like JsonOutputTarget', () => {
    // Same fallback path as JsonOutputTarget.emit for non-error events.
    const lines: string[] = []
    const target = new TerminalOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'message', value: 'hi' })
    expect(lines[0]).toBe('{"type":"message","value":"hi"}')
  })

  test('error event with null/undefined produces "[error] null"/"[error] undefined"', () => {
    // String(null) === 'null'; String(undefined) === 'undefined'. Document
    // the conversion contract so callers expect the literal text.
    const lines: string[] = []
    const target = new TerminalOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'error', error: null })
    target.emit({ type: 'error', error: undefined })
    expect(lines).toEqual(['[error] null', '[error] undefined'])
  })

  test('error event with object — uses String(obj) "[object Object]"', () => {
    // Calling String() on a plain object yields '[object Object]'. This
    // is intentional — terminal target is for human reads, not structured
    // routing. Use JsonOutputTarget for full payload preservation.
    const lines: string[] = []
    const target = new TerminalOutputTarget(line => {
      lines.push(line)
    })
    target.emit({ type: 'error', error: { code: 500 } })
    expect(lines[0]).toBe('[error] [object Object]')
  })
})

describe('OutputTarget contract conformance', () => {
  // All three targets implement the same interface — verify by exercising
  // the same shape against each.
  const targets = [
    new JsonOutputTarget(() => {}),
    new SilentOutputTarget(),
    new TerminalOutputTarget(() => {}),
  ]

  test('all targets accept the OutputEvent union', () => {
    for (const t of targets) {
      expect(() => t.emit({ type: 'message', value: 'x' })).not.toThrow()
      expect(() => t.emit({ type: 'tool_progress', value: 1 })).not.toThrow()
      expect(() => t.emit({ type: 'error', error: 'e' })).not.toThrow()
      expect(() => t.emit({ type: 'permission', value: {} })).not.toThrow()
    }
  })

  test('emit returns void or void-resolving Promise (sync targets in this set)', () => {
    // None of the in-tree targets are async. Future async targets would
    // need their own tests — this anchors that the current ones are sync.
    for (const t of targets) {
      const r = t.emit({ type: 'message', value: 'x' })
      expect(r).toBeUndefined()
    }
  })
})
