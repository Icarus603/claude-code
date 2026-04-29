import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { cliError, cliOk } from '../exit.js'

// process.exit must NOT actually exit during tests. Stub it to throw a
// sentinel that the test catches, so we can still assert the exit code
// without crashing the bun:test process.
class ExitSignal extends Error {
  constructor(public readonly code: number) {
    super(`__test_process_exit_${code}__`)
  }
}

const realExit = process.exit
let exitCode: number | null = null

beforeEach(() => {
  exitCode = null
  ;(process as { exit: typeof process.exit }).exit = ((code?: number) => {
    exitCode = code ?? 0
    throw new ExitSignal(exitCode)
  }) as typeof process.exit
})

afterEach(() => {
  ;(process as { exit: typeof process.exit }).exit = realExit
})

describe('cliError', () => {
  test('exits with code 1 when called with a message', () => {
    const stderrSpy = mock((..._args: unknown[]) => {})
    const realErrorFn = console.error
    console.error = stderrSpy as typeof console.error
    try {
      expect(() => cliError('something failed')).toThrow(ExitSignal)
    } finally {
      console.error = realErrorFn
    }
    expect(exitCode).toBe(1)
    expect(stderrSpy).toHaveBeenCalledWith('something failed')
  })

  test('exits with code 1 when called with no message (no console.error)', () => {
    const stderrSpy = mock((..._args: unknown[]) => {})
    const realErrorFn = console.error
    console.error = stderrSpy as typeof console.error
    try {
      expect(() => cliError()).toThrow(ExitSignal)
    } finally {
      console.error = realErrorFn
    }
    expect(exitCode).toBe(1)
    expect(stderrSpy).not.toHaveBeenCalled()
  })

  test('exits with code 1 when called with empty string (no message printed)', () => {
    // Empty string is falsy, so the `if (msg)` guard skips console.error.
    // Documents this contract — passing '' is equivalent to passing nothing.
    const stderrSpy = mock((..._args: unknown[]) => {})
    const realErrorFn = console.error
    console.error = stderrSpy as typeof console.error
    try {
      expect(() => cliError('')).toThrow(ExitSignal)
    } finally {
      console.error = realErrorFn
    }
    expect(exitCode).toBe(1)
    expect(stderrSpy).not.toHaveBeenCalled()
  })
})

describe('cliOk', () => {
  test('exits with code 0 when called with a message + appends newline', () => {
    const writes: string[] = []
    const realWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write
    try {
      expect(() => cliOk('all good')).toThrow(ExitSignal)
    } finally {
      process.stdout.write = realWrite
    }
    expect(exitCode).toBe(0)
    expect(writes).toContain('all good\n')
  })

  test('exits with code 0 when called with no message (no stdout write)', () => {
    const writes: string[] = []
    const realWrite = process.stdout.write
    process.stdout.write = ((chunk: string | Uint8Array) => {
      writes.push(typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString())
      return true
    }) as typeof process.stdout.write
    try {
      expect(() => cliOk()).toThrow(ExitSignal)
    } finally {
      process.stdout.write = realWrite
    }
    expect(exitCode).toBe(0)
    expect(writes).toHaveLength(0)
  })
})

describe('cliError vs cliOk — distinct exit codes', () => {
  test('cliError uses 1, cliOk uses 0', () => {
    const realErrorFn = console.error
    console.error = (() => {}) as typeof console.error
    const realWrite = process.stdout.write
    process.stdout.write = (() => true) as typeof process.stdout.write
    try {
      try {
        cliError('e')
      } catch (e) {
        expect(e).toBeInstanceOf(ExitSignal)
      }
      const errCode = exitCode
      try {
        cliOk('ok')
      } catch (e) {
        expect(e).toBeInstanceOf(ExitSignal)
      }
      const okCode = exitCode
      expect(errCode).toBe(1)
      expect(okCode).toBe(0)
    } finally {
      console.error = realErrorFn
      process.stdout.write = realWrite
    }
  })
})
