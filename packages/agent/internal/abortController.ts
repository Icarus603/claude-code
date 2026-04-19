const DEFAULT_MAX_LISTENERS = 50

export function createAbortController(
  maxListeners: number = DEFAULT_MAX_LISTENERS,
): AbortController {
  const controller = new AbortController()
  // V7 §6.5 — avoid importing 'events'; load at runtime.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { setMaxListeners } = require('events') as typeof import('events')
  setMaxListeners(maxListeners, controller.signal)
  return controller
}
