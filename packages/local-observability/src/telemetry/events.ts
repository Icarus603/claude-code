/**
 * V7 §8.12 — telemetry/events: stub implementations for OTel event logging
 * and privacy redaction.
 *
 * Moved from src/utils/telemetry/events.ts. External build eliminates the
 * real implementations; these stubs keep call sites safe.
 */

export function redactIfDisabled(content: string): string {
  return content
}

export async function logOTelEvent(
  _eventName: string,
  _metadata: { [key: string]: string | undefined } = {},
): Promise<void> {}
