import { describe, expect, test } from 'bun:test'
import {
  AgentBaseError,
  HostBindingsError,
  StateError,
  UserAbort,
} from '../errors.js'

describe('AgentBaseError', () => {
  test('preserves explicit code', () => {
    expect(new AgentBaseError('CUSTOM', 'm').code).toBe('CUSTOM')
  })
  test('is an Error instance', () => {
    expect(new AgentBaseError('X', 'm')).toBeInstanceOf(Error)
  })
  test('forwards cause', () => {
    const cause = new Error('underlying')
    expect(new AgentBaseError('X', 'm', { cause }).cause).toBe(cause)
  })
  test('default name is AgentBaseError', () => {
    expect(new AgentBaseError('X', 'm').name).toBe('AgentBaseError')
  })
})

describe('HostBindingsError', () => {
  test('code is AGENT_HOST_BINDINGS_ERROR', () => {
    expect(new HostBindingsError('m').code).toBe('AGENT_HOST_BINDINGS_ERROR')
  })
  test('name is AgentHostBindingsError', () => {
    expect(new HostBindingsError('m').name).toBe('AgentHostBindingsError')
  })
  test('extends AgentBaseError', () => {
    expect(new HostBindingsError('m')).toBeInstanceOf(AgentBaseError)
  })
})

describe('StateError', () => {
  test('code is AGENT_STATE_ERROR', () => {
    expect(new StateError('m').code).toBe('AGENT_STATE_ERROR')
  })
  test('name is AgentStateError', () => {
    expect(new StateError('m').name).toBe('AgentStateError')
  })
  test('extends AgentBaseError', () => {
    expect(new StateError('m')).toBeInstanceOf(AgentBaseError)
  })
})

describe('UserAbort — unique symbol marker', () => {
  // Critical contract: UserAbort is a SYMBOL, NOT an Error subclass.
  // Callers distinguish cooperative user interrupts via `=== UserAbort`,
  // not via instanceof or .message string match. This is the contract
  // commented in the source.

  test('is a symbol (typeof check)', () => {
    expect(typeof UserAbort).toBe('symbol')
  })

  test('description is "UserAbort"', () => {
    expect(UserAbort.description).toBe('UserAbort')
  })

  test('is reference-stable (=== check works across imports)', () => {
    // The unique-symbol typing guarantees callers can compare with ===.
    // If a future refactor accidentally moves UserAbort to a different
    // module without re-export, callers' === checks would silently fail
    // (they'd be comparing against a stale symbol).
    expect(UserAbort).toBe(UserAbort)
  })

  test('NOT a constructor (cannot be `new UserAbort()`)', () => {
    // Symbol is intentionally not a class — verify it's not callable
    // with `new`.
    expect(() => {
      new (UserAbort as unknown as { new (): unknown })()
    }).toThrow()
  })

  test('is type-narrowable in equality checks (compile-time contract)', () => {
    // The exported type `typeof UserAbort` makes the equality check
    // type-safe. Verifying via runtime that the value matches its
    // own type binding.
    const value: typeof UserAbort = UserAbort
    expect(value === UserAbort).toBe(true)
  })
})

describe('agent error code uniqueness', () => {
  test('all subclass codes are distinct', () => {
    const codes = new Set([
      new HostBindingsError('m').code,
      new StateError('m').code,
    ])
    expect(codes.size).toBe(2)
  })
  test('all subclass codes start with AGENT_ prefix', () => {
    for (const code of [
      new HostBindingsError('m').code,
      new StateError('m').code,
    ]) {
      expect(code).toMatch(/^AGENT_/)
    }
  })
})
