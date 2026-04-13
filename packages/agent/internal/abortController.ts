import { setMaxListeners } from 'events'

const DEFAULT_MAX_LISTENERS = 50

export function createAbortController(
  maxListeners: number = DEFAULT_MAX_LISTENERS,
): AbortController {
  const controller = new AbortController()
  setMaxListeners(maxListeners, controller.signal)
  return controller
}
