import { BASH_TOOL_NAME } from '@claude-code/tool-registry/tools/BashTool/toolName.js'
import { POWERSHELL_TOOL_NAME } from '@claude-code/tool-registry/tools/PowerShellTool/toolName.js'
import { isEnvDefinedFalsy, isEnvTruthy } from '@claude-code/config/env/utils'
import { getPlatform } from '@claude-code/config/platform'

export const SHELL_TOOL_NAMES: string[] = [BASH_TOOL_NAME, POWERSHELL_TOOL_NAME]

/**
 * Runtime gate for PowerShellTool. Windows-only (the permission engine uses
 * Win32-specific path normalizations). Enabled by default on Windows (opt-out
 * via CLAUDE_CODE_USE_POWERSHELL_TOOL=0); ccb is the first-party build and
 * treats PowerShell as a first-class shell alongside Bash.
 *
 * Used by tools.ts (tool-list visibility), processBashCommand (! routing),
 * and promptShellExecution (skill frontmatter routing) so the gate is
 * consistent across all paths that invoke PowerShellTool.call().
 */
export function isPowerShellToolEnabled(): boolean {
  if (getPlatform() !== 'windows') return false
  return !isEnvDefinedFalsy(process.env.CLAUDE_CODE_USE_POWERSHELL_TOOL)
}
