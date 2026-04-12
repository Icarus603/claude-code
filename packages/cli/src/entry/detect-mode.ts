/**
 * Early runtime mode detection extracted from src/main.tsx per V7 §10.1.
 *
 * Decides `isInteractive`, `clientType`, `previewFormat`, and session source
 * based on argv + environment. Each decision is pushed into the relevant
 * bootstrap state setter so downstream code observes a stable snapshot.
 */

import {
  setClientType,
  setIsInteractive,
  setQuestionPreviewFormat,
  setSessionSource,
} from '../../../../src/bootstrap/state.js'
import { stopCapturingEarlyInput } from '../../../../src/utils/earlyInput.js'
import { isEnvTruthy } from '../../../../src/utils/envUtils.js'
import { initializeEntrypoint } from '../../../../src/main/startup/settings.js'

/**
 * Resolve the client type string from process env + entrypoint hints.
 */
function resolveClientType(): string {
  if (isEnvTruthy(process.env.GITHUB_ACTIONS)) return 'github-action'
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-ts') return 'sdk-typescript'
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-py') return 'sdk-python'
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'sdk-cli') return 'sdk-cli'
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-vscode') return 'claude-vscode'
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'local-agent') return 'local-agent'
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'claude-desktop') return 'claude-desktop'

  // Check if session-ingress token is provided (indicates remote session)
  const hasSessionIngressToken =
    process.env.CLAUDE_CODE_SESSION_ACCESS_TOKEN ||
    process.env.CLAUDE_CODE_WEBSOCKET_AUTH_FILE_DESCRIPTOR
  if (process.env.CLAUDE_CODE_ENTRYPOINT === 'remote' || hasSessionIngressToken) {
    return 'remote'
  }

  return 'cli'
}

/**
 * Detect interactive/non-interactive mode from argv + TTY.
 * Mirrors the logic that lived at the top of `src/main.tsx` `main()`.
 */
export function detectRuntimeMode(): void {
  const cliArgs = process.argv.slice(2)
  const hasPrintFlag = cliArgs.includes('-p') || cliArgs.includes('--print')
  const hasInitOnlyFlag = cliArgs.includes('--init-only')
  const hasSdkUrl = cliArgs.some(arg => arg.startsWith('--sdk-url'))
  const isNonInteractive =
    hasPrintFlag || hasInitOnlyFlag || hasSdkUrl || !process.stdout.isTTY

  // Stop capturing early input for non-interactive modes
  if (isNonInteractive) {
    stopCapturingEarlyInput()
  }

  const isInteractive = !isNonInteractive
  setIsInteractive(isInteractive)

  // Initialize entrypoint based on mode - needs to be set before any event is logged
  initializeEntrypoint(isNonInteractive)

  const clientType = resolveClientType()
  setClientType(clientType)

  const previewFormat = process.env.CLAUDE_CODE_QUESTION_PREVIEW_FORMAT
  if (previewFormat === 'markdown' || previewFormat === 'html') {
    setQuestionPreviewFormat(previewFormat)
  } else if (
    !clientType.startsWith('sdk-') &&
    // Desktop and CCR pass previewFormat via toolConfig; when the feature is
    // gated off they pass undefined — don't override that with markdown.
    clientType !== 'claude-desktop' &&
    clientType !== 'local-agent' &&
    clientType !== 'remote'
  ) {
    setQuestionPreviewFormat('markdown')
  }

  // Tag sessions created via `claude remote-control` so the backend can identify them
  if (process.env.CLAUDE_CODE_ENVIRONMENT_KIND === 'bridge') {
    setSessionSource('remote-control')
  }
}
