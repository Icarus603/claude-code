/**
 *
 *
 * Phase 2: bashProvider + powershellProvider + ShellSnapshot
 */

export type {
  ShellType,
  ShellProvider,
  ShellConfig,
  ExecOptions,
  ExecResult,
  ShellCommand,
} from './types.js'
export {
  SHELL_TYPES,
  DEFAULT_HOOK_SHELL,
} from './types.js'

export type { ShellExecContext, SnapshotContext } from './context.js'

export { quote, tryParseShellCommand, tryQuoteShellArgs, hasMalformedTokens, hasShellQuoteSingleQuoteBug, type ParseEntry, type ShellParseResult, type ShellQuoteResult } from './bash/shellQuote.js'
export { quoteShellCommand, shouldAddStdinRedirect, rewriteWindowsNullRedirect, hasStdinRedirect } from './bash/shellQuoting.js'
export { rearrangePipeCommand } from './bash/bashPipeCommand.js'
export { formatShellPrefixCommand } from './bash/shellPrefix.js'

export { parseCommand, parseCommandRaw, ensureInitialized, extractCommandArguments, PARSE_ABORTED, type Node, type ParsedCommandData } from './bash/parser.js'
export { SHELL_KEYWORDS } from './bash/bashParser.js'

export {
  splitCommand_DEPRECATED,
  splitCommandWithOperators,
  filterControlOperators,
  isHelpCommand,
  isUnsafeCompoundCommand_DEPRECATED,
  extractOutputRedirections,
  getCommandSubcommandPrefix,
  clearCommandPrefixCaches,
} from './bash/commands.js'

export { getCommandPrefixStatic, getCompoundCommandPrefixesStatic } from './bash/prefix.js'

// ─── bash heredoc ──────────────────────────────────────────────────
export { extractHeredocs, restoreHeredocs, containsHeredoc, type HeredocInfo, type HeredocExtractionResult } from './bash/heredoc.js'

export { getCommandSpec, loadFigSpec, type CommandSpec, type Argument, type Option } from './bash/registry.js'

export {
  analyzeCommand,
  extractQuoteContext,
  extractCompoundStructure,
  extractDangerousPatterns,
  hasActualOperatorNodes,
  type QuoteContext,
  type CompoundStructure,
  type DangerousPatterns,
  type TreeSitterAnalysis,
} from './bash/treeSitterAnalysis.js'

export type { ShellProvider as ShellProviderType } from './providers/shellProvider.js'
export { SHELL_TYPES as SHELL_PROVIDER_TYPES, DEFAULT_HOOK_SHELL as DEFAULT_HOOK_SHELL_PROVIDER } from './providers/shellProvider.js'

export { createBashShellProvider } from './providers/bashProvider.js'
export { createPowerShellProvider, buildPowerShellArgs } from './providers/powershellProvider.js'

export { createAndSaveSnapshot, createRipgrepShellIntegration, createFindGrepShellIntegration } from './bash/ShellSnapshot.js'

export { findPowerShell, getCachedPowerShellPath, getPowerShellEdition, resetPowerShellCache, type PowerShellEdition } from './providers/powershellDetection.js'

export {
  GIT_READ_ONLY_COMMANDS,
  GH_READ_ONLY_COMMANDS,
  DOCKER_READ_ONLY_COMMANDS,
  RIPGREP_READ_ONLY_COMMANDS,
  PYRIGHT_READ_ONLY_COMMANDS,
  EXTERNAL_READONLY_COMMANDS,
  containsVulnerableUncPath,
  validateFlags,
  validateFlagArgument,
  FLAG_PATTERN,
  type FlagArgType,
  type ExternalCommandConfig,
} from './providers/readOnlyCommandValidation.js'

export { getMaxOutputLength, BASH_MAX_OUTPUT_UPPER_LIMIT, BASH_MAX_OUTPUT_DEFAULT } from './providers/outputLimits.js'
export { resolveDefaultShell, setGetSettingsFn } from './providers/resolveDefaultShell.js'
export { isPowerShellToolEnabled, SHELL_TOOL_NAMES } from './providers/shellToolUtils.js'

export {
  setGetPlatformFn,
  setPosixPathToWindowsPathFn,
  setWhichFn,
  setWindowsPathToPosixPathFn,
} from './_deps.js'

export { buildPrefix, DEPTH_RULES } from './prefix/specPrefix.js'

export {
  registerUpstreamProxyEnvFn,
  subprocessEnv,
} from './subprocessEnv.js'

export type { TaskOutputPort } from './taskOutputPort.js'

export type { ShellCommandWithOutput } from './shellCommand.js'
export {
  wrapSpawn,
  createAbortedCommand,
  createFailedCommand,
  MAX_TASK_OUTPUT_BYTES,
  MAX_TASK_OUTPUT_BYTES_DISPLAY,
} from './shellCommand.js'

export {
  findSuitableShell,
  createProviderResolver,
  createShellConfigFactory,
  createPsProviderFactory,
} from './shellDiscovery.js'

export {
  exec,
  setCwd,
  setCreateTaskOutputFn,
  setGetSandboxTmpDirNameFn,
} from './exec.js'
