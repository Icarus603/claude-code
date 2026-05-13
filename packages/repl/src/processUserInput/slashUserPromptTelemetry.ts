/**
 * Port of ant v2.1.136 qm5 (3753.js) — slash command branch of the
 * user_prompt OTel event. Extracted from processSlashCommand.tsx so that
 * file stays under its grandfather LOC budget.
 *
 * command_source classifies as 'mcp'|'builtin'|'custom' (matches ant W).
 * command_name redacted to source-bucket unless builtin or OTEL_LOG_TOOL_DETAILS.
 * Sensitive command args masked to `/<name> ***` (matches ant R formula).
 */

import { randomUUID } from 'crypto'

import { setPromptId } from '@claude-code/app-host/bootstrap/state.js'
import {
  logOTelEvent,
  redactIfDisabled,
  toolDetailsLoggingEnabled,
} from '@claude-code/local-observability/telemetry'

export function emitSlashUserPrompt(args: {
  inputString: string
  commandName: string
  cmdArgs: string
  isMcp: boolean
  isBuiltinCmd: boolean
  isSensitive: boolean
}): void {
  const promptId = randomUUID()
  setPromptId(promptId)
  const cmdSource = args.isMcp ? 'mcp' : args.isBuiltinCmd ? 'builtin' : 'custom'
  const safeArgs =
    args.isSensitive && args.cmdArgs.trim()
      ? `/${args.commandName} ***`
      : args.inputString
  void logOTelEvent('user_prompt', {
    prompt_length: String(safeArgs.length),
    prompt: redactIfDisabled(safeArgs),
    'prompt.id': promptId,
    command_name:
      cmdSource === 'builtin' || toolDetailsLoggingEnabled()
        ? args.commandName
        : cmdSource,
    command_source: cmdSource,
  })
}
