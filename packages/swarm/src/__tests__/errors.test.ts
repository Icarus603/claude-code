import { describe, expect, test } from 'bun:test'
import {
  MailboxError,
  SpawnError,
  SwarmBaseError,
  WorktreeError,
} from '../errors.js'

describe('SwarmBaseError', () => {
  test('preserves the explicit code passed to the constructor', () => {
    const err = new SwarmBaseError('CUSTOM_CODE', 'msg')
    expect(err.code).toBe('CUSTOM_CODE')
  })

  test('preserves the message', () => {
    const err = new SwarmBaseError('X', 'something happened')
    expect(err.message).toBe('something happened')
  })

  test('is an instance of Error', () => {
    expect(new SwarmBaseError('X', 'm')).toBeInstanceOf(Error)
  })

  test('forwards ErrorOptions.cause', () => {
    const cause = new Error('underlying')
    const err = new SwarmBaseError('X', 'wrapper', { cause })
    expect(err.cause).toBe(cause)
  })

  test('default name is "SwarmBaseError"', () => {
    expect(new SwarmBaseError('X', 'm').name).toBe('SwarmBaseError')
  })
})

describe('SpawnError', () => {
  test('code is hard-coded to SWARM_SPAWN_ERROR', () => {
    expect(new SpawnError('msg').code).toBe('SWARM_SPAWN_ERROR')
  })
  test('name is "SwarmSpawnError" (note: not "SpawnError")', () => {
    expect(new SpawnError('msg').name).toBe('SwarmSpawnError')
  })
  test('extends SwarmBaseError', () => {
    expect(new SpawnError('msg')).toBeInstanceOf(SwarmBaseError)
  })
  test('forwards cause through the chain', () => {
    const cause = new Error('underlying')
    expect(new SpawnError('m', { cause }).cause).toBe(cause)
  })
})

describe('MailboxError', () => {
  test('code is SWARM_MAILBOX_ERROR', () => {
    expect(new MailboxError('msg').code).toBe('SWARM_MAILBOX_ERROR')
  })
  test('name is "SwarmMailboxError"', () => {
    expect(new MailboxError('msg').name).toBe('SwarmMailboxError')
  })
  test('extends SwarmBaseError', () => {
    expect(new MailboxError('msg')).toBeInstanceOf(SwarmBaseError)
  })
})

describe('WorktreeError', () => {
  test('code is SWARM_WORKTREE_ERROR', () => {
    expect(new WorktreeError('msg').code).toBe('SWARM_WORKTREE_ERROR')
  })
  test('name is "SwarmWorktreeError"', () => {
    expect(new WorktreeError('msg').name).toBe('SwarmWorktreeError')
  })
  test('extends SwarmBaseError', () => {
    expect(new WorktreeError('msg')).toBeInstanceOf(SwarmBaseError)
  })
})

describe('error code uniqueness contract', () => {
  // Why: code is the wire-protocol-level identifier (it surfaces to
  // host telemetry, log scraping, alert rules). If two error subclasses
  // ever share a code, that's a contract bug.
  test('all four classes have distinct error codes', () => {
    const codes = new Set([
      new SwarmBaseError('SWARM_BASE', 'm').code,
      new SpawnError('m').code,
      new MailboxError('m').code,
      new WorktreeError('m').code,
    ])
    expect(codes.size).toBe(4)
  })

  test('all subclass codes start with SWARM_ prefix', () => {
    const codes = [
      new SpawnError('m').code,
      new MailboxError('m').code,
      new WorktreeError('m').code,
    ]
    for (const code of codes) {
      expect(code).toMatch(/^SWARM_/)
    }
  })
})
