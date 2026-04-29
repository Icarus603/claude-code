import { describe, expect, test } from 'bun:test'
import {
  AbortError,
  ClaudeError,
  classifyAxiosError,
  ConfigParseError,
  errorMessage,
  getErrnoCode,
  getErrnoPath,
  hasExactErrorMessage,
  isAbortError,
  isENOENT,
  isFsInaccessible,
  MalformedCommandError,
  ShellError,
  shortErrorStack,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  TeleportOperationError,
  toError,
} from '../errorHelpers.js'

describe('typed error classes', () => {
  test('ClaudeError sets name from constructor.name', () => {
    const e = new ClaudeError('boom')
    expect(e.name).toBe('ClaudeError')
    expect(e.message).toBe('boom')
    expect(e).toBeInstanceOf(Error)
  })
  test('MalformedCommandError is an Error subclass', () => {
    const e = new MalformedCommandError('bad cmd')
    expect(e).toBeInstanceOf(Error)
    expect(e.message).toBe('bad cmd')
  })
  test('AbortError sets name', () => {
    const e = new AbortError('cancelled')
    expect(e.name).toBe('AbortError')
  })
  test('AbortError works without message', () => {
    const e = new AbortError()
    expect(e.name).toBe('AbortError')
  })
  test('ConfigParseError carries file path + default config', () => {
    const e = new ConfigParseError('parse failed', '/tmp/cfg.json', { x: 1 })
    expect(e.filePath).toBe('/tmp/cfg.json')
    expect(e.defaultConfig).toEqual({ x: 1 })
    expect(e.name).toBe('ConfigParseError')
  })
  test('ShellError carries stdout/stderr/code/interrupted', () => {
    const e = new ShellError('out', 'err', 42, true)
    expect(e.stdout).toBe('out')
    expect(e.stderr).toBe('err')
    expect(e.code).toBe(42)
    expect(e.interrupted).toBe(true)
    expect(e.message).toBe('Shell command failed')
  })
  test('TeleportOperationError carries formattedMessage', () => {
    const e = new TeleportOperationError('msg', 'pretty msg')
    expect(e.formattedMessage).toBe('pretty msg')
  })
  test('TelemetrySafeError defaults telemetryMessage to message', () => {
    const e = new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS('m')
    expect(e.telemetryMessage).toBe('m')
  })
  test('TelemetrySafeError can override telemetryMessage', () => {
    const e = new TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS(
      'sensitive: /Users/foo/bar.ts',
      'sensitive: <redacted>',
    )
    expect(e.telemetryMessage).toBe('sensitive: <redacted>')
    expect(e.message).toBe('sensitive: /Users/foo/bar.ts')
  })
})

describe('isAbortError', () => {
  test('our AbortError class', () => {
    expect(isAbortError(new AbortError())).toBe(true)
  })
  test('Error with name="AbortError" (DOMException-shaped)', () => {
    const e = new Error('cancelled')
    e.name = 'AbortError'
    expect(isAbortError(e)).toBe(true)
  })
  test('regular Error returns false', () => {
    expect(isAbortError(new Error('boom'))).toBe(false)
  })
  test('non-Error values return false', () => {
    expect(isAbortError('cancelled')).toBe(false)
    expect(isAbortError(null)).toBe(false)
    expect(isAbortError(undefined)).toBe(false)
    expect(isAbortError({ name: 'AbortError' })).toBe(false)
  })
})

describe('hasExactErrorMessage', () => {
  test('matches exact message', () => {
    expect(hasExactErrorMessage(new Error('boom'), 'boom')).toBe(true)
  })
  test('substring match returns false (must be exact)', () => {
    expect(hasExactErrorMessage(new Error('boom went off'), 'boom')).toBe(false)
  })
  test('non-Error returns false', () => {
    expect(hasExactErrorMessage('boom', 'boom')).toBe(false)
  })
})

describe('toError', () => {
  test('passes through Error unchanged', () => {
    const e = new Error('boom')
    expect(toError(e)).toBe(e)
  })
  test('wraps strings', () => {
    expect(toError('boom').message).toBe('boom')
  })
  test('wraps non-Error objects via String coercion', () => {
    expect(toError({ x: 1 }).message).toBe('[object Object]')
  })
  test('wraps null/undefined', () => {
    expect(toError(null).message).toBe('null')
    expect(toError(undefined).message).toBe('undefined')
  })
})

describe('errorMessage', () => {
  test('reads .message from Error', () => {
    expect(errorMessage(new Error('boom'))).toBe('boom')
  })
  test('coerces non-Error to string', () => {
    expect(errorMessage('boom')).toBe('boom')
    expect(errorMessage(42)).toBe('42')
  })
})

describe('errno helpers', () => {
  test('getErrnoCode reads code property', () => {
    const e = Object.assign(new Error('x'), { code: 'ENOENT' })
    expect(getErrnoCode(e)).toBe('ENOENT')
  })
  test('getErrnoCode returns undefined for plain Error', () => {
    expect(getErrnoCode(new Error('x'))).toBeUndefined()
  })
  test('getErrnoCode handles null/undefined', () => {
    expect(getErrnoCode(null)).toBeUndefined()
    expect(getErrnoCode(undefined)).toBeUndefined()
  })
  test('getErrnoCode rejects non-string code', () => {
    const e = Object.assign(new Error('x'), { code: 42 })
    expect(getErrnoCode(e)).toBeUndefined()
  })

  test('isENOENT shortcut', () => {
    const e = Object.assign(new Error('x'), { code: 'ENOENT' })
    expect(isENOENT(e)).toBe(true)
    expect(isENOENT(new Error('plain'))).toBe(false)
  })

  test('getErrnoPath reads path property', () => {
    const e = Object.assign(new Error('x'), { path: '/tmp/missing' })
    expect(getErrnoPath(e)).toBe('/tmp/missing')
  })
  test('getErrnoPath returns undefined when absent', () => {
    expect(getErrnoPath(new Error('x'))).toBeUndefined()
  })

  test('isFsInaccessible matches fs-related codes', () => {
    for (const code of ['ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ELOOP']) {
      expect(isFsInaccessible(Object.assign(new Error('x'), { code }))).toBe(true)
    }
  })
  test('isFsInaccessible rejects unrelated errors', () => {
    expect(isFsInaccessible(new Error('plain'))).toBe(false)
    expect(
      isFsInaccessible(Object.assign(new Error('x'), { code: 'EBUSY' })),
    ).toBe(false)
  })
})

describe('shortErrorStack', () => {
  test('returns input as string for non-Error', () => {
    expect(shortErrorStack('boom')).toBe('boom')
    expect(shortErrorStack(null)).toBe('null')
  })
  test('returns message when no stack', () => {
    const e = new Error('boom')
    e.stack = undefined as unknown as string
    expect(shortErrorStack(e)).toBe('boom')
  })
  test('truncates long stacks to maxFrames', () => {
    const e = new Error('boom')
    e.stack = [
      'Error: boom',
      ...Array.from({ length: 20 }, (_, i) => `    at frame${i} (file.ts:${i})`),
    ].join('\n')
    const result = shortErrorStack(e, 3)
    const lines = result.split('\n')
    expect(lines).toHaveLength(4) // header + 3 frames
    expect(lines[0]).toBe('Error: boom')
    expect(lines[1]).toContain('frame0')
    expect(lines[3]).toContain('frame2')
  })
  test('keeps full stack when under limit', () => {
    const e = new Error('boom')
    e.stack = 'Error: boom\n    at frame0 (file.ts:0)'
    expect(shortErrorStack(e, 5)).toBe(e.stack)
  })
})

describe('classifyAxiosError', () => {
  test('non-axios errors classified as "other"', () => {
    expect(classifyAxiosError(new Error('boom')).kind).toBe('other')
    expect(classifyAxiosError('string').kind).toBe('other')
  })
  test('401/403 classified as "auth"', () => {
    const e401 = { isAxiosError: true, response: { status: 401 }, message: '' }
    const e403 = { isAxiosError: true, response: { status: 403 }, message: '' }
    expect(classifyAxiosError(e401).kind).toBe('auth')
    expect(classifyAxiosError(e403).kind).toBe('auth')
    expect(classifyAxiosError(e401).status).toBe(401)
  })
  test('ECONNABORTED classified as "timeout"', () => {
    const e = { isAxiosError: true, code: 'ECONNABORTED', message: '' }
    expect(classifyAxiosError(e).kind).toBe('timeout')
  })
  test('ECONNREFUSED/ENOTFOUND classified as "network"', () => {
    expect(
      classifyAxiosError({
        isAxiosError: true,
        code: 'ECONNREFUSED',
        message: '',
      }).kind,
    ).toBe('network')
    expect(
      classifyAxiosError({
        isAxiosError: true,
        code: 'ENOTFOUND',
        message: '',
      }).kind,
    ).toBe('network')
  })
  test('500 classified as "http" (with status preserved)', () => {
    const e = {
      isAxiosError: true,
      response: { status: 500 },
      message: 'server error',
    }
    const r = classifyAxiosError(e)
    expect(r.kind).toBe('http')
    expect(r.status).toBe(500)
  })
})
