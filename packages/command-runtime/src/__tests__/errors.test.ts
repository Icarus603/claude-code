import { describe, expect, test } from 'bun:test'
import {
  CommandExecutionError,
  CommandNotFoundError,
  CommandResolutionError,
  CommandRuntimeBaseError,
  HostBindingsError,
} from '../errors.js'

describe('CommandRuntimeBaseError', () => {
  test('stores code and message', () => {
    const e = new CommandRuntimeBaseError('CR_TEST', 'whoops')
    expect(e.code).toBe('CR_TEST')
    expect(e.message).toBe('whoops')
    expect(e.name).toBe('CommandRuntimeBaseError')
  })
  test('is an instanceof Error (so .stack works, instanceof checks pass)', () => {
    const e = new CommandRuntimeBaseError('CR_X', 'x')
    expect(e).toBeInstanceOf(Error)
  })
  test('preserves options.cause', () => {
    const cause = new Error('underlying')
    const e = new CommandRuntimeBaseError('CR_X', 'wrap', { cause })
    expect(e.cause).toBe(cause)
  })
})

describe('CommandNotFoundError', () => {
  test('has stable error code', () => {
    const e = new CommandNotFoundError('cmd missing')
    expect(e.code).toBe('COMMAND_RUNTIME_NOT_FOUND')
    expect(e.name).toBe('CommandRuntimeNotFoundError')
  })
  test('extends CommandRuntimeBaseError', () => {
    const e = new CommandNotFoundError('x')
    expect(e).toBeInstanceOf(CommandRuntimeBaseError)
  })
})

describe('CommandResolutionError', () => {
  test('has stable error code', () => {
    const e = new CommandResolutionError('cant resolve')
    expect(e.code).toBe('COMMAND_RUNTIME_RESOLUTION_ERROR')
    expect(e.name).toBe('CommandRuntimeResolutionError')
  })
})

describe('CommandExecutionError', () => {
  test('has stable error code', () => {
    const e = new CommandExecutionError('exec failed')
    expect(e.code).toBe('COMMAND_RUNTIME_EXECUTION_ERROR')
    expect(e.name).toBe('CommandRuntimeExecutionError')
  })
})

describe('HostBindingsError', () => {
  test('has stable error code', () => {
    const e = new HostBindingsError('hosts not wired')
    expect(e.code).toBe('COMMAND_RUNTIME_HOST_BINDINGS_ERROR')
    expect(e.name).toBe('CommandRuntimeHostBindingsError')
  })
})

describe('error code namespace', () => {
  test('all subclass codes are unique and prefixed COMMAND_RUNTIME_', () => {
    const codes = [
      new CommandNotFoundError('x').code,
      new CommandResolutionError('x').code,
      new CommandExecutionError('x').code,
      new HostBindingsError('x').code,
    ]
    expect(new Set(codes).size).toBe(codes.length)
    for (const c of codes) {
      expect(c.startsWith('COMMAND_RUNTIME_')).toBe(true)
    }
  })
})
