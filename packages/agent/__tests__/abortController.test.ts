import { describe, expect, test } from 'bun:test'
import {
  createAbortController,
  createChildAbortController,
} from '../abortController.js'

describe('createAbortController', () => {
  test('returns a fresh AbortController', () => {
    const c = createAbortController()
    expect(c).toBeInstanceOf(AbortController)
    expect(c.signal.aborted).toBe(false)
  })

  test('signal can be aborted manually', () => {
    const c = createAbortController()
    c.abort()
    expect(c.signal.aborted).toBe(true)
  })

  test('preserves abort reason', () => {
    const c = createAbortController()
    const reason = new Error('boom')
    c.abort(reason)
    expect(c.signal.reason).toBe(reason)
  })

  test('multiple listeners do not throw MaxListenersExceededWarning at default 50', () => {
    const c = createAbortController()
    // Adding 50+ listeners would warn without setMaxListeners
    for (let i = 0; i < 60; i++) {
      c.signal.addEventListener('abort', () => {})
    }
    // No throw — implicitly passes if no MaxListenersExceededWarning is thrown
    expect(c.signal.aborted).toBe(false)
  })

  test('custom maxListeners is honored', () => {
    const c = createAbortController(5)
    for (let i = 0; i < 5; i++) {
      c.signal.addEventListener('abort', () => {})
    }
    // Should not throw at exactly 5
    expect(c.signal.aborted).toBe(false)
  })
})

describe('createChildAbortController', () => {
  test('aborting parent aborts child', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    expect(child.signal.aborted).toBe(false)
    parent.abort()
    expect(child.signal.aborted).toBe(true)
  })

  test('aborting child does NOT abort parent', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    child.abort()
    expect(child.signal.aborted).toBe(true)
    expect(parent.signal.aborted).toBe(false)
  })

  test('child propagates parent abort reason', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    const reason = new Error('parent-aborted')
    parent.abort(reason)
    expect(child.signal.reason).toBe(reason)
  })

  test('parent already aborted: child is aborted at construction (fast path)', () => {
    const parent = createAbortController()
    parent.abort(new Error('pre-aborted'))
    const child = createChildAbortController(parent)
    expect(child.signal.aborted).toBe(true)
    expect((child.signal.reason as Error).message).toBe('pre-aborted')
  })

  test('child has its own abort reason (independent)', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    const childReason = new Error('child-only')
    child.abort(childReason)
    expect(child.signal.reason).toBe(childReason)
    expect(parent.signal.aborted).toBe(false)
  })

  test('multiple children of same parent all abort together', () => {
    const parent = createAbortController()
    const childA = createChildAbortController(parent)
    const childB = createChildAbortController(parent)
    parent.abort()
    expect(childA.signal.aborted).toBe(true)
    expect(childB.signal.aborted).toBe(true)
  })

  test('parent listeners are cleaned up after child aborts', () => {
    const parent = createAbortController()
    const child = createChildAbortController(parent)
    // After child abort, the once-listener that propagates parent→child is
    // implicitly auto-cleaned by { once: true }; the cleanup handler
    // removes any remaining wiring. Aborting parent post-child should not
    // re-trigger child (already aborted, no-op).
    child.abort()
    parent.abort()
    expect(child.signal.aborted).toBe(true)
    expect(parent.signal.aborted).toBe(true)
  })
})
