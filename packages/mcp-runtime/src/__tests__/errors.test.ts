import { describe, expect, test } from 'bun:test'
import {
  AuthRequiredError,
  ElicitationError,
  HostBindingsError,
  McpBaseError,
  ProtocolError,
  TransportError,
} from '../errors.js'

describe('McpBaseError', () => {
  test('stores code + message + name', () => {
    const e = new McpBaseError('MCP_TEST', 'whoops')
    expect(e.code).toBe('MCP_TEST')
    expect(e.message).toBe('whoops')
    expect(e.name).toBe('McpBaseError')
  })
  test('preserves options.cause', () => {
    const cause = new Error('underlying')
    const e = new McpBaseError('MCP_X', 'wrap', { cause })
    expect(e.cause).toBe(cause)
  })
})

describe('subclasses have stable error codes', () => {
  test('TransportError', () => {
    const e = new TransportError('boom')
    expect(e.code).toBe('MCP_TRANSPORT_ERROR')
    expect(e.name).toBe('McpTransportError')
    expect(e).toBeInstanceOf(McpBaseError)
  })
  test('ProtocolError', () => {
    const e = new ProtocolError('boom')
    expect(e.code).toBe('MCP_PROTOCOL_ERROR')
    expect(e.name).toBe('McpProtocolError')
  })
  test('AuthRequiredError', () => {
    const e = new AuthRequiredError('please auth')
    expect(e.code).toBe('MCP_AUTH_REQUIRED_ERROR')
    expect(e.name).toBe('McpAuthRequiredError')
  })
  test('ElicitationError', () => {
    const e = new ElicitationError('user said no')
    expect(e.code).toBe('MCP_ELICITATION_ERROR')
    expect(e.name).toBe('McpElicitationError')
  })
  test('HostBindingsError extends ProtocolError', () => {
    const e = new HostBindingsError('not bound')
    expect(e.code).toBe('MCP_PROTOCOL_ERROR')
    expect(e.name).toBe('McpHostBindingsError')
    expect(e).toBeInstanceOf(ProtocolError)
    expect(e).toBeInstanceOf(McpBaseError)
  })
})

describe('error-code namespace invariants', () => {
  test('all subclass codes prefixed MCP_', () => {
    const codes = [
      new TransportError('x').code,
      new ProtocolError('x').code,
      new AuthRequiredError('x').code,
      new ElicitationError('x').code,
      new HostBindingsError('x').code,
    ]
    for (const c of codes) {
      expect(c.startsWith('MCP_')).toBe(true)
    }
  })
})
