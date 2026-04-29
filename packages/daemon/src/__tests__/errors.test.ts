import { describe, expect, test } from 'bun:test'
import {
  DaemonBaseError,
  LifecycleError,
  SupervisionError,
  WorkerRegistryError,
} from '../errors.js'

describe('DaemonBaseError', () => {
  test('preserves the explicit code', () => {
    expect(new DaemonBaseError('CUSTOM', 'm').code).toBe('CUSTOM')
  })
  test('is an Error instance', () => {
    expect(new DaemonBaseError('X', 'm')).toBeInstanceOf(Error)
  })
  test('forwards cause', () => {
    const cause = new Error('underlying')
    expect(new DaemonBaseError('X', 'm', { cause }).cause).toBe(cause)
  })
  test('default name is DaemonBaseError', () => {
    expect(new DaemonBaseError('X', 'm').name).toBe('DaemonBaseError')
  })
})

describe('LifecycleError', () => {
  test('code is DAEMON_LIFECYCLE_ERROR', () => {
    expect(new LifecycleError('m').code).toBe('DAEMON_LIFECYCLE_ERROR')
  })
  test('name is DaemonLifecycleError', () => {
    expect(new LifecycleError('m').name).toBe('DaemonLifecycleError')
  })
  test('extends DaemonBaseError', () => {
    expect(new LifecycleError('m')).toBeInstanceOf(DaemonBaseError)
  })
})

describe('WorkerRegistryError', () => {
  test('code is DAEMON_WORKER_REGISTRY_ERROR', () => {
    expect(new WorkerRegistryError('m').code).toBe(
      'DAEMON_WORKER_REGISTRY_ERROR',
    )
  })
  test('name is DaemonWorkerRegistryError', () => {
    expect(new WorkerRegistryError('m').name).toBe('DaemonWorkerRegistryError')
  })
})

describe('SupervisionError', () => {
  test('code is DAEMON_SUPERVISION_ERROR', () => {
    expect(new SupervisionError('m').code).toBe('DAEMON_SUPERVISION_ERROR')
  })
  test('name is DaemonSupervisionError', () => {
    expect(new SupervisionError('m').name).toBe('DaemonSupervisionError')
  })
  test('forwards cause', () => {
    const cause = new Error('worker died')
    expect(new SupervisionError('m', { cause }).cause).toBe(cause)
  })
})

describe('daemon error code uniqueness', () => {
  test('all three subclasses have distinct codes', () => {
    const codes = new Set([
      new LifecycleError('m').code,
      new WorkerRegistryError('m').code,
      new SupervisionError('m').code,
    ])
    expect(codes.size).toBe(3)
  })
  test('all subclass codes start with DAEMON_ prefix', () => {
    for (const code of [
      new LifecycleError('m').code,
      new WorkerRegistryError('m').code,
      new SupervisionError('m').code,
    ]) {
      expect(code).toMatch(/^DAEMON_/)
    }
  })
})
