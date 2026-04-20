// Canonical owner is @claude-code/local-observability/errorHelpers.js. This
// re-export exists only for src/* callers that have not been migrated yet;
// packages/* must import from the canonical path (V7 §11.2).
export {
  AbortError,
  ClaudeError,
  ConfigParseError,
  MalformedCommandError,
  ShellError,
  TeleportOperationError,
  TelemetrySafeError_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  classifyAxiosError,
  errorMessage,
  getErrnoCode,
  getErrnoPath,
  hasExactErrorMessage,
  isAbortError,
  isENOENT,
  isFsInaccessible,
  shortErrorStack,
  toError,
} from '@claude-code/local-observability/errorHelpers.js'
export type { AxiosErrorKind } from '@claude-code/local-observability/errorHelpers.js'
