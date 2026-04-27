/**
 * V7 §10.3 facade — beta session tracing stubs now in
 * `@claude-code/local-observability/telemetry`.
 */

export type { LLMRequestNewContext } from './index.js'
export {
  addBetaInteractionAttributes,
  addBetaLLMRequestAttributes,
  addBetaLLMResponseAttributes,
  addBetaToolInputAttributes,
  addBetaToolResultAttributes,
  clearBetaTracingState,
  isBetaTracingEnabled,
  truncateContent,
} from './index.js'
