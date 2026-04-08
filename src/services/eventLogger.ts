type EventMetadata = Record<string, unknown>

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function stripProtoFields<V>(
  metadata: Record<string, V>,
): Record<string, V> {
  return metadata
}

export function attachAnalyticsSink(_newSink: unknown): void {}

export function logEvent(_eventName: string, _metadata: EventMetadata): void {}

export async function logEventAsync(
  _eventName: string,
  _metadata: EventMetadata,
): Promise<void> {}

export function logEventTo1P(
  _eventName: string,
  _metadata: EventMetadata,
): void {}

export async function shutdownEventLoggers(): Promise<void> {}

export function _resetForTesting(): void {}
