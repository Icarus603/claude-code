// Canonical owner is @claude-code/local-observability/telemetry.
export type { LLMRequestNewContext } from '@claude-code/local-observability/telemetry'
export {
  addBetaInteractionAttributes,
  addBetaLLMRequestAttributes,
  addBetaLLMResponseAttributes,
  addBetaToolInputAttributes,
  addBetaToolResultAttributes,
  clearBetaTracingState,
  isBetaTracingEnabled,
  truncateContent,
} from '@claude-code/local-observability/telemetry'
