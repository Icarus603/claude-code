import { describe, expect, test } from 'bun:test'
import {
  ContextSyncError,
  EnvironmentSelectionError,
  ExecutionError,
  TeleportBaseError,
} from '../errors.js'

describe('TeleportBaseError', () => {
  test('preserves the explicit code', () => {
    expect(new TeleportBaseError('CUSTOM', 'm').code).toBe('CUSTOM')
  })
  test('is an Error instance', () => {
    expect(new TeleportBaseError('X', 'm')).toBeInstanceOf(Error)
  })
  test('forwards cause', () => {
    const cause = new Error('underlying')
    expect(new TeleportBaseError('X', 'm', { cause }).cause).toBe(cause)
  })
  test('default name is TeleportBaseError', () => {
    expect(new TeleportBaseError('X', 'm').name).toBe('TeleportBaseError')
  })
})

describe('EnvironmentSelectionError', () => {
  test('code is TELEPORT_ENVIRONMENT_SELECTION_ERROR', () => {
    expect(new EnvironmentSelectionError('m').code).toBe(
      'TELEPORT_ENVIRONMENT_SELECTION_ERROR',
    )
  })
  test('name is TeleportEnvironmentSelectionError', () => {
    expect(new EnvironmentSelectionError('m').name).toBe(
      'TeleportEnvironmentSelectionError',
    )
  })
  test('extends TeleportBaseError', () => {
    expect(new EnvironmentSelectionError('m')).toBeInstanceOf(
      TeleportBaseError,
    )
  })
})

describe('ContextSyncError', () => {
  test('code is TELEPORT_CONTEXT_SYNC_ERROR', () => {
    expect(new ContextSyncError('m').code).toBe('TELEPORT_CONTEXT_SYNC_ERROR')
  })
  test('name is TeleportContextSyncError', () => {
    expect(new ContextSyncError('m').name).toBe('TeleportContextSyncError')
  })
})

describe('ExecutionError', () => {
  test('code is TELEPORT_EXECUTION_ERROR', () => {
    expect(new ExecutionError('m').code).toBe('TELEPORT_EXECUTION_ERROR')
  })
  test('name is TeleportExecutionError', () => {
    expect(new ExecutionError('m').name).toBe('TeleportExecutionError')
  })
  test('forwards cause', () => {
    const cause = new Error('ssh failed')
    expect(new ExecutionError('m', { cause }).cause).toBe(cause)
  })
})

describe('teleport error code uniqueness', () => {
  test('all three subclasses have distinct codes', () => {
    const codes = new Set([
      new EnvironmentSelectionError('m').code,
      new ContextSyncError('m').code,
      new ExecutionError('m').code,
    ])
    expect(codes.size).toBe(3)
  })
  test('all subclass codes start with TELEPORT_ prefix', () => {
    for (const code of [
      new EnvironmentSelectionError('m').code,
      new ContextSyncError('m').code,
      new ExecutionError('m').code,
    ]) {
      expect(code).toMatch(/^TELEPORT_/)
    }
  })
})
