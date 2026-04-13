import { logEvent, logEventAsync, shutdownLocalObservability } from './index.js'
import type { EventMetadata } from './contracts.js'

export type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS = never
export type AnalyticsMetadata_I_VERIFIED_THIS_IS_PII_TAGGED = never

export function stripProtoFields<V>(metadata: Record<string, V>): Record<string, V> {
  return metadata
}

export function attachAnalyticsSink(_newSink: unknown): void {}

export function logEventTo1P(eventName: string, metadata: EventMetadata): void {
  logEvent(eventName, metadata)
}

export async function shutdownEventLoggers(): Promise<void> {
  await shutdownLocalObservability()
}

export function _resetForTesting(): void {}
