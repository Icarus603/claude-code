/**
 * PowerShell stderr classifier — port of ant v2.1.136 `Qo5` table
 * (3999.js Yl7 module). Classifies failed pwsh / powershell.exe stderr
 * output into a small finite enum so the telemetry call
 * (`tengu_powershell_tool_command_failed`) can record an `error_class`
 * and the model can choose a recovery path.
 *
 * The 12 categories are taken VERBATIM from ant `Qo5`:
 *
 *   ant Qo5 = [
 *     ["ps5_chain_op",         /token '(&&|\|\||\?\?)' is not a valid|InvalidEndOfLine/i],
 *     ["parser_error",         /ParserError:|ParseException|TerminatorExpectedAtEndOfString/],
 *     ["not_recognized",       /is not recognized as (a name of a cmdlet|the name of a cmdlet|an? internal)/i],
 *     ["command_not_found",    /CommandNotFoundException/],
 *     ["native_command_error", /NativeCommandError|RemoteException/],
 *     ["path_not_found",       /ItemNotFoundException|PathNotFound,Microsoft\.PowerShell/],
 *     ["access_denied",        /UnauthorizedAccessException|PermissionDenied,Microsoft\.PowerShell/],
 *     ["parameter_binding",    /ParameterBindingException|ParameterArgumentValidationError/],
 *     ["object_not_found",     /ObjectNotFound: \(|DriveNotFoundException/],
 *     ["execution_policy",     /running scripts is disabled on this system|PSSecurityException/i],
 *     ["native_npm",           /^npm (ERR!|error)/m],
 *     ["native_dotnet",        /: error [A-Z]{2,}\d{4}:|^Build FAILED\./m]
 *   ]
 *
 * Order matters: earlier patterns win when multiple match. Some PS5
 * `&&`/`||` errors also include `CommandNotFoundException` strings,
 * but `ps5_chain_op` is the more useful root-cause label, so it goes
 * first. ant relies on the same ordering.
 *
 * Flag-correctness matters too — patterns like `/^npm (ERR!|error)/m`
 * use `/m` (multiline) so `^` matches per-line, not just at buffer
 * start. ccb's previous impl used `/i` (case-insensitive) which would
 * match e.g. `Wrapping XMSBUILD output to npm ERR!` — false-positive.
 */
import { logEvent } from '@claude-code/local-observability'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '@claude-code/local-observability'
import { readEnv } from '@claude-code/config/env'

export type PowerShellErrorClass =
  | 'ps5_chain_op'
  | 'parser_error'
  | 'not_recognized'
  | 'command_not_found'
  | 'native_command_error'
  | 'path_not_found'
  | 'access_denied'
  | 'parameter_binding'
  | 'object_not_found'
  | 'execution_policy'
  | 'native_npm'
  | 'native_dotnet'
  | 'other'

type Rule = { kind: PowerShellErrorClass; re: RegExp }

// Patterns are byte-for-byte from ant Qo5 (3999.js) — including the
// per-rule flag set. Do NOT add `/i` to rules that ant declared without
// it: PS error identifiers are case-sensitive (e.g.
// `CommandNotFoundException` vs `commandnotfoundexception`). Do NOT
// drop `/m` from `native_npm` / `native_dotnet` — `^` is per-line.
const RULES: Rule[] = [
  {
    kind: 'ps5_chain_op',
    re: /token '(&&|\|\||\?\?)' is not a valid|InvalidEndOfLine/i,
  },
  {
    kind: 'parser_error',
    re: /ParserError:|ParseException|TerminatorExpectedAtEndOfString/,
  },
  {
    kind: 'not_recognized',
    re: /is not recognized as (a name of a cmdlet|the name of a cmdlet|an? internal)/i,
  },
  { kind: 'command_not_found', re: /CommandNotFoundException/ },
  { kind: 'native_command_error', re: /NativeCommandError|RemoteException/ },
  {
    kind: 'path_not_found',
    re: /ItemNotFoundException|PathNotFound,Microsoft\.PowerShell/,
  },
  {
    kind: 'access_denied',
    re: /UnauthorizedAccessException|PermissionDenied,Microsoft\.PowerShell/,
  },
  {
    kind: 'parameter_binding',
    re: /ParameterBindingException|ParameterArgumentValidationError/,
  },
  { kind: 'object_not_found', re: /ObjectNotFound: \(|DriveNotFoundException/ },
  {
    kind: 'execution_policy',
    re: /running scripts is disabled on this system|PSSecurityException/i,
  },
  { kind: 'native_npm', re: /^npm (ERR!|error)/m },
  { kind: 'native_dotnet', re: /: error [A-Z]{2,}\d{4}:|^Build FAILED\./m },
]

export function classifyPowerShellError(stderr: string): PowerShellErrorClass {
  if (!stderr) return 'other'
  for (const { kind, re } of RULES) {
    if (re.test(stderr)) return kind
  }
  return 'other'
}

/**
 * Pwsh parse subprocess timeout — port of ant `co5` (3999.js).
 * Reads `CLAUDE_CODE_PWSH_PARSE_TIMEOUT_MS` env, falls back to 5000ms.
 * Used by callers that spawn pwsh just to parse a script AST (not
 * execute), so timeout discipline is independent of the run path.
 */
export function getPwshParseTimeoutMs(): number {
  const v = readEnv('CLAUDE_CODE_PWSH_PARSE_TIMEOUT_MS')
  if (!v) return 5000
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 5000
}

/**
 * Emit `tengu_powershell_tool_command_failed` with a classified
 * payload. `command_type` is the caller-supplied semantic label
 * (`'inline'` / `'script-file'` / `'profile'`); `powershell_edition`
 * is `'pwsh'` for cross-platform PowerShell 7+ or `'powershell.exe'`
 * for Windows PowerShell 5.x.
 */
export function logPowerShellToolFailure(payload: {
  command_type: string
  exit_code: number
  stdout_length: number
  stderr: string
  powershell_edition: 'pwsh' | 'powershell.exe'
}): void {
  logEvent('tengu_powershell_tool_command_failed', {
    command_type:
      payload.command_type as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    exit_code: payload.exit_code,
    stdout_length: payload.stdout_length,
    error_class: classifyPowerShellError(
      payload.stderr,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    powershell_edition:
      payload.powershell_edition as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
