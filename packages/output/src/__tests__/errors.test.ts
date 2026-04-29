import { describe, expect, test } from 'bun:test'
import {
  OutputBaseError,
  RenderError,
  TargetUnavailableError,
  WriteError,
} from '../errors.js'

describe('OutputBaseError — base class', () => {
  test('extends Error', () => {
    expect(new OutputBaseError('CODE', 'msg')).toBeInstanceOf(Error)
  })

  test('exposes .code field', () => {
    const e = new OutputBaseError('CUSTOM_CODE', 'msg')
    expect(e.code).toBe('CUSTOM_CODE')
  })

  test('exposes .message field', () => {
    const e = new OutputBaseError('CODE', 'something happened')
    expect(e.message).toBe('something happened')
  })

  test('has name "OutputBaseError"', () => {
    const e = new OutputBaseError('CODE', 'msg')
    expect(e.name).toBe('OutputBaseError')
  })

  test('preserves cause via ErrorOptions (Node 16.9+ pattern)', () => {
    const inner = new Error('inner')
    const e = new OutputBaseError('CODE', 'outer', { cause: inner })
    expect(e.cause).toBe(inner)
  })

  test('.code is readonly (TypeScript-enforced; runtime check)', () => {
    // The `readonly` modifier is compile-time only — assigning at runtime
    // succeeds (it's just a regular property). This test documents the
    // limitation and the expected initial value.
    const e = new OutputBaseError('FIXED', 'msg')
    expect(e.code).toBe('FIXED')
  })
})

describe('WriteError — fixed code', () => {
  test('hardcodes code = OUTPUT_WRITE_ERROR', () => {
    expect(new WriteError('failed').code).toBe('OUTPUT_WRITE_ERROR')
  })

  test('name = OutputWriteError (distinct from base)', () => {
    expect(new WriteError('failed').name).toBe('OutputWriteError')
  })

  test('extends OutputBaseError', () => {
    expect(new WriteError('failed')).toBeInstanceOf(OutputBaseError)
  })

  test('extends Error transitively', () => {
    expect(new WriteError('failed')).toBeInstanceOf(Error)
  })

  test('preserves message', () => {
    expect(new WriteError('disk full').message).toBe('disk full')
  })

  test('preserves cause via options', () => {
    const inner = new Error('EIO')
    expect(new WriteError('disk', { cause: inner }).cause).toBe(inner)
  })
})

describe('RenderError — fixed code', () => {
  test('hardcodes code = OUTPUT_RENDER_ERROR', () => {
    expect(new RenderError('boom').code).toBe('OUTPUT_RENDER_ERROR')
  })

  test('name = OutputRenderError', () => {
    expect(new RenderError('boom').name).toBe('OutputRenderError')
  })

  test('extends OutputBaseError', () => {
    expect(new RenderError('boom')).toBeInstanceOf(OutputBaseError)
  })

  test('preserves message + cause', () => {
    const inner = new Error('react bailout')
    const e = new RenderError('render failed', { cause: inner })
    expect(e.message).toBe('render failed')
    expect(e.cause).toBe(inner)
  })
})

describe('TargetUnavailableError — fixed code', () => {
  test('hardcodes code = OUTPUT_TARGET_UNAVAILABLE', () => {
    expect(new TargetUnavailableError('no tty').code).toBe(
      'OUTPUT_TARGET_UNAVAILABLE',
    )
  })

  test('name = OutputTargetUnavailableError', () => {
    expect(new TargetUnavailableError('no tty').name).toBe(
      'OutputTargetUnavailableError',
    )
  })

  test('extends OutputBaseError', () => {
    expect(new TargetUnavailableError('no tty')).toBeInstanceOf(OutputBaseError)
  })
})

describe('error-class hierarchy contract', () => {
  // The taxonomy is consumed by callers that route errors based on either
  // (a) the .code field for analytics/log dimensions, or (b) instanceof
  // checks for try/catch routing. Both must work.

  test('all 3 codes are distinct (collision would mis-attribute)', () => {
    const codes = new Set([
      new WriteError('').code,
      new RenderError('').code,
      new TargetUnavailableError('').code,
    ])
    expect(codes.size).toBe(3)
  })

  test('all subclass-instances pass instanceof OutputBaseError', () => {
    expect(new WriteError('')).toBeInstanceOf(OutputBaseError)
    expect(new RenderError('')).toBeInstanceOf(OutputBaseError)
    expect(new TargetUnavailableError('')).toBeInstanceOf(OutputBaseError)
  })

  test('WriteError is NOT instanceof RenderError (sibling-discrimination)', () => {
    // catch-block discriminators rely on each subclass NOT extending
    // sibling subclasses. This locks the flat hierarchy.
    expect(new WriteError('')).not.toBeInstanceOf(RenderError)
    expect(new RenderError('')).not.toBeInstanceOf(WriteError)
    expect(new TargetUnavailableError('')).not.toBeInstanceOf(WriteError)
  })

  test('error names form a unique set (analytics dimension stability)', () => {
    const names = new Set([
      new OutputBaseError('', '').name,
      new WriteError('').name,
      new RenderError('').name,
      new TargetUnavailableError('').name,
    ])
    expect(names.size).toBe(4)
  })
})
