/**
 * Port of ant v2.1.136 eR (2585.js) — redacts `agent:custom:<name>` to
 * `agent:custom` for telemetry cardinality. Used wherever a querySource
 * flows into an OTel event field. Extracted from logging.ts so the
 * apply-everywhere helper stays under 800 LOC.
 */

export function redactQuerySourceForTelemetry(
  querySource: string | undefined,
): string | undefined {
  return querySource?.startsWith('agent:custom:')
    ? 'agent:custom'
    : querySource
}
