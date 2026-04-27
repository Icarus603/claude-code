/**
 * Leaf module for the `slowLogging` tagged template — lifted out of
 * slowOperations.ts to break the slowOperations → debug → fsOperations →
 * slowOperations 3-file cycle (V7 §11.2).
 *
 * The split: this module owns the timing primitives (`AntSlowLogger`,
 * `slowLogging` tag, threshold). The actual log sinks (`logForDebugging`
 * + `addSlowOperation`) are injected via `_setSlowOpReporter` so we
 * don't have to import them. fsOperations + slowOperations both import
 * `slowLogging` from here; debug.ts wires the reporter at module init.
 *
 * Reporter is a no-op until set, which is correct — slowLogging is itself
 * a no-op in non-ant builds (`feature('SLOW_OPERATION_LOGGING')` is off
 * outside ant), so the gap between module load and reporter wiring is
 * irrelevant: nothing fires in fork builds anyway.
 */

import { feature } from 'bun:bundle'

const SLOW_OPERATION_THRESHOLD_MS = (() => {
  const envValue = process.env.CLAUDE_CODE_SLOW_OPERATION_THRESHOLD_MS
  if (envValue !== undefined) {
    const parsed = Number(envValue)
    if (!Number.isNaN(parsed) && parsed >= 0) {
      return parsed
    }
  }
  if (process.env.NODE_ENV === 'development') {
    return 20
  }
  if (process.env.USER_TYPE === 'ant') {
    return 300
  }
  return Infinity
})()

export { SLOW_OPERATION_THRESHOLD_MS }

let isLogging = false

type SlowOpReporter = (description: string, durationMs: number) => void
type DebugLogger = (message: string) => void
let reportSlowOp: SlowOpReporter = () => {}
let logForDebuggingInjected: DebugLogger = () => {}

export function _setSlowOpReporter(
  reporter: SlowOpReporter,
  debugLogger: DebugLogger,
): void {
  reportSlowOp = reporter
  logForDebuggingInjected = debugLogger
}

export function callerFrame(stack: string | undefined): string {
  if (!stack) return ''
  for (const line of stack.split('\n')) {
    if (line.includes('slowOperations') || line.includes('slowLoggingTag'))
      continue
    const m = line.match(/([^/\\]+?):(\d+):\d+\)?$/)
    if (m) return ` @ ${m[1]}:${m[2]}`
  }
  return ''
}

function buildDescription(args: IArguments): string {
  const strings = args[0] as TemplateStringsArray
  let result = ''
  for (let i = 0; i < strings.length; i++) {
    result += strings[i]
    if (i + 1 < args.length) {
      const v = args[i + 1]
      if (Array.isArray(v)) {
        result += `Array[${(v as unknown[]).length}]`
      } else if (v !== null && typeof v === 'object') {
        result += `Object{${Object.keys(v as Record<string, unknown>).length} keys}`
      } else if (typeof v === 'string') {
        result += v.length > 80 ? `${v.slice(0, 80)}…` : v
      } else {
        result += String(v)
      }
    }
  }
  return result
}

const NOOP_LOGGER: Disposable = { [Symbol.dispose]() {} }

class AntSlowLogger {
  startTime: number
  args: IArguments
  err: Error

  constructor(args: IArguments) {
    this.startTime = performance.now()
    this.args = args
    this.err = new Error()
  }

  [Symbol.dispose](): void {
    const duration = performance.now() - this.startTime
    if (duration > SLOW_OPERATION_THRESHOLD_MS && !isLogging) {
      isLogging = true
      try {
        const description =
          buildDescription(this.args) + callerFrame(this.err.stack)
        logForDebuggingInjected(
          `[SLOW OPERATION DETECTED] ${description} (${duration.toFixed(1)}ms)`,
        )
        reportSlowOp(description, duration)
      } finally {
        isLogging = false
      }
    }
  }
}

function slowLoggingAnt(
  _strings: TemplateStringsArray,
  ..._values: unknown[]
): AntSlowLogger {
  // eslint-disable-next-line prefer-rest-params
  // biome-ignore lint/complexity/noArguments: tagged-template arguments access
  return new AntSlowLogger(arguments)
}

function slowLoggingExternal(): Disposable {
  return NOOP_LOGGER
}

export const slowLogging: (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Disposable = feature('SLOW_OPERATION_LOGGING')
  ? slowLoggingAnt
  : slowLoggingExternal
