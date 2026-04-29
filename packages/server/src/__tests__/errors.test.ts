import { describe, expect, test } from 'bun:test'
import {
  CoordinationError,
  LifecycleError,
  ServerBaseError,
  SessionTransportError,
} from '../errors.js'

describe('ServerBaseError', () => {
  test('preserves the explicit code', () => {
    expect(new ServerBaseError('CUSTOM', 'm').code).toBe('CUSTOM')
  })
  test('is an Error instance', () => {
    expect(new ServerBaseError('X', 'm')).toBeInstanceOf(Error)
  })
  test('forwards cause', () => {
    const cause = new Error('underlying')
    expect(new ServerBaseError('X', 'm', { cause }).cause).toBe(cause)
  })
  test('default name is ServerBaseError', () => {
    expect(new ServerBaseError('X', 'm').name).toBe('ServerBaseError')
  })
})

describe('LifecycleError', () => {
  test('code is SERVER_LIFECYCLE_ERROR', () => {
    expect(new LifecycleError('m').code).toBe('SERVER_LIFECYCLE_ERROR')
  })
  test('name is ServerLifecycleError', () => {
    expect(new LifecycleError('m').name).toBe('ServerLifecycleError')
  })
  test('extends ServerBaseError', () => {
    expect(new LifecycleError('m')).toBeInstanceOf(ServerBaseError)
  })
})

describe('SessionTransportError', () => {
  test('code is SERVER_SESSION_TRANSPORT_ERROR', () => {
    expect(new SessionTransportError('m').code).toBe(
      'SERVER_SESSION_TRANSPORT_ERROR',
    )
  })
  test('name is ServerSessionTransportError', () => {
    expect(new SessionTransportError('m').name).toBe(
      'ServerSessionTransportError',
    )
  })
})

describe('CoordinationError', () => {
  test('code is SERVER_COORDINATION_ERROR', () => {
    expect(new CoordinationError('m').code).toBe('SERVER_COORDINATION_ERROR')
  })
  test('name is ServerCoordinationError', () => {
    expect(new CoordinationError('m').name).toBe('ServerCoordinationError')
  })
  test('forwards cause', () => {
    const cause = new Error('grpc disconnected')
    expect(new CoordinationError('m', { cause }).cause).toBe(cause)
  })
})

describe('server error code uniqueness', () => {
  test('all three subclasses have distinct codes', () => {
    const codes = new Set([
      new LifecycleError('m').code,
      new SessionTransportError('m').code,
      new CoordinationError('m').code,
    ])
    expect(codes.size).toBe(3)
  })
  test('all subclass codes start with SERVER_ prefix', () => {
    for (const code of [
      new LifecycleError('m').code,
      new SessionTransportError('m').code,
      new CoordinationError('m').code,
    ]) {
      expect(code).toMatch(/^SERVER_/)
    }
  })
})
