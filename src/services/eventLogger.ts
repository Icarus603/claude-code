import {
  logEvent as logLocalEvent,
  logEventAsync as logLocalEventAsync,
  shutdownLocalObservability,
} from '@claude-code/local-observability'

type EventMetadata = Record<string, unknown>

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  return metadata
}

export function attachAnalyticsSink(_newSink: unknown): void {}

export function logEvent(eventName: string, metadata: EventMetadata): void {
  logLocalEvent(eventName, metadata)
}

export async function logEventAsync(
  eventName: string,
  metadata: EventMetadata,
): Promise<void> {
  await logLocalEventAsync(eventName, metadata)
}

export function logEventTo1P(
  eventName: string,
  metadata: EventMetadata,
): void {
  logLocalEvent(eventName, metadata)
}

export async function shutdownEventLoggers(): Promise<void> {
  await shutdownLocalObservability()
}

export function _resetForTesting(): void {}
