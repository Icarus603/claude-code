/**
 * V7 §8.12 — telemetry/events: OTel structured event logging + privacy
 * redaction.
 *
 * Port of ant v2.1.136 k5() (2642.js) and zn1()/YT_() (2642.js head).
 * Pre-fix this was a stub — 10+ call sites across ccb (tool_decision,
 * tool_result, user_prompt, api_request, api_error, hook_execution_*,
 * mcp_server_connection) wrote into the void, so the OTEL event stream
 * was completely empty even when a user wired up an OTLP exporter.
 *
 * Event shape (matches ant k5):
 *   body:       `claude_code.${eventName}`
 *   timestamp:  ISO now (also observedTimestamp)
 *   attributes: {
 *     ...getTelemetryAttributes(),   // user.id / session.id / org.id / etc.
 *     'event.name': eventName,
 *     'event.timestamp': ISO,
 *     'event.sequence': monotonic counter,
 *     'prompt.id'?: current promptId,
 *     'workspace.host_paths'?: split CLAUDE_CODE_WORKSPACE_HOST_PATHS,
 *     ...callerMetadata,             // undefined keys dropped
 *   }
 *
 * `redactIfDisabled` mirrors ant YT_(H): returns `<REDACTED>` unless
 * OTEL_LOG_USER_PROMPTS is truthy. Call this on any free-form user
 * content (user_prompt body, system_prompt body) before passing as
 * metadata.
 */

import {
  getEventLogger,
  getPromptId,
} from '@claude-code/app-host/bootstrap/state.js'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { logForDebugging } from '../debug.js'
import { getTelemetryAttributes } from './attributes.js'

// Port of ant `zn1()` — gate prompt content on OTEL_LOG_USER_PROMPTS.
function userPromptLoggingEnabled(): boolean {
  return isEnvTruthy(process.env.OTEL_LOG_USER_PROMPTS)
}

// Port of ant `YT_(H)`. Free-form user content stays hidden unless the
// operator opts in; the rest of the event still flies (so dashboards see
// the user_prompt count + length, just not the body).
export function redactIfDisabled(content: string): string {
  return userPromptLoggingEnabled() ? content : '<REDACTED>'
}

// Monotonic sequence + one-shot drop-warning (matches ant An1 + ZF9).
let eventSequence = 0
let droppedWarningEmitted = false

export async function logOTelEvent(
  eventName: string,
  metadata: { [key: string]: string | undefined } = {},
): Promise<void> {
  const logger = getEventLogger()
  if (!logger) {
    // Mirror ant ZF9: warn ONCE per process so the user knows the OTEL
    // exporter isn't initialized. Subsequent drops are silent (otherwise
    // every tool call would spam the debug log).
    if (!droppedWarningEmitted) {
      droppedWarningEmitted = true
      logForDebugging(
        `[3P telemetry] Event dropped (no event logger initialized): ${eventName}`,
        { level: 'warn' },
      )
    }
    return
  }

  const now = new Date()
  const nowIso = now.toISOString()
  // getTelemetryAttributes() reaches into config + provider hosts; those
  // throw if the host bindings aren't wired (bun:test, pre-init paths).
  // Treat the attribute bag as best-effort — the event still flies with
  // just event.* metadata if the host isn't ready.
  let baseAttributes: Record<string, unknown> = {}
  try {
    baseAttributes = getTelemetryAttributes() as Record<string, unknown>
  } catch {
    // host bindings missing — keep going with empty base
  }
  const attributes: Record<string, unknown> = {
    ...baseAttributes,
    'event.name': eventName,
    'event.timestamp': nowIso,
    'event.sequence': eventSequence++,
  }

  // Per-turn prompt correlation (ant rsH/uyH). Also defensive: getPromptId
  // reads STATE which may not be initialized in early-startup paths.
  try {
    const promptId = getPromptId()
    if (promptId) attributes['prompt.id'] = promptId
  } catch {
    // STATE not initialized — fine, event flies without prompt.id
  }

  // Multi-workspace setups can ship the pipe-separated host-path list.
  // Ant splits on '|' and ships as a string array (OTLP supports it).
  const hostPaths = process.env.CLAUDE_CODE_WORKSPACE_HOST_PATHS
  if (hostPaths) attributes['workspace.host_paths'] = hostPaths.split('|')

  for (const [key, value] of Object.entries(metadata)) {
    if (value !== undefined) attributes[key] = value
  }

  logger.emit({
    timestamp: now,
    observedTimestamp: now,
    body: `claude_code.${eventName}`,
    attributes,
  })
}

// Test-only escape hatch: bun:test imports of this module persist for
// the lifetime of the runner, so the sequence/warning state leaks across
// test files. Callers in __tests__ can reset between suites.
export function __resetOTelEventStateForTest(): void {
  eventSequence = 0
  droppedWarningEmitted = false
}
