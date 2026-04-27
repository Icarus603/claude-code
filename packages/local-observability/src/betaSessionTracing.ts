// Canonical owner is @claude-code/local-observability/telemetry.
export type { LLMRequestNewContext } from './telemetry/index.js'
export {
  addBetaInteractionAttributes,
  addBetaLLMRequestAttributes,
  addBetaLLMResponseAttributes,
  addBetaToolInputAttributes,
  addBetaToolResultAttributes,
  clearBetaTracingState,
  isBetaTracingEnabled,
  truncateContent,
} from './telemetry/index.js'
