import { describe, expect, test } from 'bun:test'
import {
  LocalObservabilityBaseError,
  LoggerError,
  MetricsError,
  TracerError,
} from '../errors.js'

describe('LocalObservabilityBaseError', () => {
  test('stores code + message + name', () => {
    const e = new LocalObservabilityBaseError('LO_TEST', 'whoops')
    expect(e.code).toBe('LO_TEST')
    expect(e.message).toBe('whoops')
    expect(e.name).toBe('LocalObservabilityBaseError')
  })
  test('preserves options.cause', () => {
    const cause = new Error('underlying')
    const e = new LocalObservabilityBaseError('LO_X', 'wrap', { cause })
    expect(e.cause).toBe(cause)
  })
})

describe('subclasses have stable error codes', () => {
  test('LoggerError', () => {
    const e = new LoggerError('logger broke')
    expect(e.code).toBe('LOCAL_OBSERVABILITY_LOGGER_ERROR')
    expect(e.name).toBe('LocalObservabilityLoggerError')
    expect(e).toBeInstanceOf(LocalObservabilityBaseError)
  })
  test('TracerError', () => {
    const e = new TracerError('tracer broke')
    expect(e.code).toBe('LOCAL_OBSERVABILITY_TRACER_ERROR')
    expect(e.name).toBe('LocalObservabilityTracerError')
  })
  test('MetricsError', () => {
    const e = new MetricsError('metrics broke')
    expect(e.code).toBe('LOCAL_OBSERVABILITY_METRICS_ERROR')
    expect(e.name).toBe('LocalObservabilityMetricsError')
  })
})

describe('error-code namespace invariants', () => {
  test('all subclass codes prefixed LOCAL_OBSERVABILITY_', () => {
    const codes = [
      new LoggerError('x').code,
      new TracerError('x').code,
      new MetricsError('x').code,
    ]
    for (const c of codes) {
      expect(c.startsWith('LOCAL_OBSERVABILITY_')).toBe(true)
    }
  })
  test('subclass codes are unique (regression check — two subclasses must not collide)', () => {
    const codes = [
      new LoggerError('x').code,
      new TracerError('x').code,
      new MetricsError('x').code,
    ]
    expect(new Set(codes).size).toBe(codes.length)
  })
})
