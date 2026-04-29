import { describe, expect, test } from 'bun:test'
import {
  AuthError,
  CaptureError,
  StreamError,
  VoiceBaseError,
} from '../errors.js'

describe('VoiceBaseError', () => {
  test('preserves the explicit code', () => {
    expect(new VoiceBaseError('CUSTOM', 'm').code).toBe('CUSTOM')
  })
  test('is an Error instance', () => {
    expect(new VoiceBaseError('X', 'm')).toBeInstanceOf(Error)
  })
  test('forwards cause', () => {
    const cause = new Error('underlying')
    expect(new VoiceBaseError('X', 'm', { cause }).cause).toBe(cause)
  })
  test('default name is VoiceBaseError', () => {
    expect(new VoiceBaseError('X', 'm').name).toBe('VoiceBaseError')
  })
})

describe('CaptureError', () => {
  test('code is VOICE_CAPTURE_ERROR', () => {
    expect(new CaptureError('m').code).toBe('VOICE_CAPTURE_ERROR')
  })
  test('name is VoiceCaptureError', () => {
    expect(new CaptureError('m').name).toBe('VoiceCaptureError')
  })
  test('extends VoiceBaseError', () => {
    expect(new CaptureError('m')).toBeInstanceOf(VoiceBaseError)
  })
})

describe('AuthError', () => {
  test('code is VOICE_AUTH_ERROR', () => {
    expect(new AuthError('m').code).toBe('VOICE_AUTH_ERROR')
  })
  test('name is VoiceAuthError', () => {
    expect(new AuthError('m').name).toBe('VoiceAuthError')
  })
})

describe('StreamError', () => {
  test('code is VOICE_STREAM_ERROR', () => {
    expect(new StreamError('m').code).toBe('VOICE_STREAM_ERROR')
  })
  test('name is VoiceStreamError', () => {
    expect(new StreamError('m').name).toBe('VoiceStreamError')
  })
  test('forwards cause', () => {
    const cause = new Error('ws closed')
    expect(new StreamError('m', { cause }).cause).toBe(cause)
  })
})

describe('voice error code uniqueness', () => {
  test('all three subclasses have distinct codes', () => {
    const codes = new Set([
      new CaptureError('m').code,
      new AuthError('m').code,
      new StreamError('m').code,
    ])
    expect(codes.size).toBe(3)
  })
  test('all subclass codes start with VOICE_ prefix', () => {
    for (const code of [
      new CaptureError('m').code,
      new AuthError('m').code,
      new StreamError('m').code,
    ]) {
      expect(code).toMatch(/^VOICE_/)
    }
  })
})
