/**
 *
 */
import { describe, expect, test } from 'bun:test'

import {
  quote,
  tryParseShellCommand,
  tryQuoteShellArgs,
  hasMalformedTokens,
  hasShellQuoteSingleQuoteBug,
  quoteShellCommand,
  shouldAddStdinRedirect,
  hasStdinRedirect,
  rearrangePipeCommand,
  formatShellPrefixCommand,

  parseCommand,
  ensureInitialized,
  extractCommandArguments,
  parseCommandRaw,
  PARSE_ABORTED,

  splitCommand_DEPRECATED,
  splitCommandWithOperators,
  filterControlOperators,
  isHelpCommand,
  isUnsafeCompoundCommand_DEPRECATED,
  extractOutputRedirections,
  clearCommandPrefixCaches,

  getCommandPrefixStatic,
  getCompoundCommandPrefixesStatic,

  // bash heredoc
  extractHeredocs,
  restoreHeredocs,
  containsHeredoc,

  getCommandSpec,
  loadFigSpec,

  analyzeCommand,
  extractQuoteContext,
  extractCompoundStructure,
  extractDangerousPatterns,
  hasActualOperatorNodes,

  SHELL_TYPES,
  DEFAULT_HOOK_SHELL,
  getMaxOutputLength,
  resolveDefaultShell,
  isPowerShellToolEnabled,
  SHELL_TOOL_NAMES,
  GIT_READ_ONLY_COMMANDS,
  validateFlags,
  FLAG_PATTERN,
  buildPrefix,
  DEPTH_RULES,

  setGetPlatformFn,
  setWhichFn,
  setWindowsPathToPosixPathFn,

  createBashShellProvider,
  createPowerShellProvider,
  buildPowerShellArgs,

  createAndSaveSnapshot,
  createRipgrepShellIntegration,
  createFindGrepShellIntegration,

  subprocessEnv,
  registerUpstreamProxyEnvFn,

  // Phase 3: ShellCommand
  wrapSpawn,
  createAbortedCommand,
  createFailedCommand,

  findSuitableShell,
  createProviderResolver,
  createShellConfigFactory,
  createPsProviderFactory,

  exec,
  setCwd,
  setCreateTaskOutputFn,
  setGetSandboxTmpDirNameFn,
} from '../index.js'

import type {
  ShellType,
  ShellProvider,
  ShellConfig,
  ExecOptions,
  ExecResult,
  ShellCommand,
  ShellExecContext,
  SnapshotContext,
  CommandSpec,
  Argument,
  Option,
  ParseEntry,
  ShellParseResult,
  ShellQuoteResult,
  PowerShellEdition,
  FlagArgType,
  ExternalCommandConfig,
} from '../index.js'

describe('@claude-code/shell import verification', () => {

  test('shellQuote: quote and parse functions exist', () => {
    expect(typeof quote).toBe('function')
    expect(typeof tryParseShellCommand).toBe('function')
    expect(typeof tryQuoteShellArgs).toBe('function')
    expect(typeof hasMalformedTokens).toBe('function')
    expect(typeof hasShellQuoteSingleQuoteBug).toBe('function')
  })

  test('shellQuoting: quoteShellCommand works', () => {
    expect(typeof quoteShellCommand).toBe('function')
    expect(typeof shouldAddStdinRedirect).toBe('function')
    expect(typeof hasStdinRedirect).toBe('function')
  })

  test('bashPipeCommand: rearrangePipeCommand exists', () => {
    expect(typeof rearrangePipeCommand).toBe('function')
  })

  test('shellPrefix: formatShellPrefixCommand exists', () => {
    expect(typeof formatShellPrefixCommand).toBe('function')
  })


  test('parser: parseCommand and ensureInitialized exist', () => {
    expect(typeof parseCommand).toBe('function')
    expect(typeof ensureInitialized).toBe('function')
    expect(typeof extractCommandArguments).toBe('function')
    expect(typeof parseCommandRaw).toBe('function')
    expect(typeof PARSE_ABORTED).toBe('symbol')
  })


  test('commands: splitCommand_DEPRECATED and helpers exist', () => {
    expect(typeof splitCommand_DEPRECATED).toBe('function')
    expect(typeof splitCommandWithOperators).toBe('function')
    expect(typeof filterControlOperators).toBe('function')
    expect(typeof isHelpCommand).toBe('function')
    expect(typeof isUnsafeCompoundCommand_DEPRECATED).toBe('function')
    expect(typeof extractOutputRedirections).toBe('function')
    expect(typeof clearCommandPrefixCaches).toBe('function')
  })


  test('prefix: getCommandPrefixStatic and getCompoundCommandPrefixesStatic exist', () => {
    expect(typeof getCommandPrefixStatic).toBe('function')
    expect(typeof getCompoundCommandPrefixesStatic).toBe('function')
  })

  // ─── bash heredoc ──────────────────────────────────────────────────

  test('heredoc: extractHeredocs and helpers exist', () => {
    expect(typeof extractHeredocs).toBe('function')
    expect(typeof restoreHeredocs).toBe('function')
    expect(typeof containsHeredoc).toBe('function')
  })


  test('registry: getCommandSpec and loadFigSpec exist', () => {
    expect(typeof getCommandSpec).toBe('function')
    expect(typeof loadFigSpec).toBe('function')
  })


  test('treeSitterAnalysis: analyzeCommand and helpers exist', () => {
    expect(typeof analyzeCommand).toBe('function')
    expect(typeof extractQuoteContext).toBe('function')
    expect(typeof extractCompoundStructure).toBe('function')
    expect(typeof extractDangerousPatterns).toBe('function')
    expect(typeof hasActualOperatorNodes).toBe('function')
  })


  test('types: SHELL_TYPES and DEFAULT_HOOK_SHELL exported', () => {
    expect(SHELL_TYPES).toContain('bash')
    expect(SHELL_TYPES).toContain('powershell')
    expect(DEFAULT_HOOK_SHELL).toBe('bash')
  })

  test('outputLimits: getMaxOutputLength exists', () => {
    expect(typeof getMaxOutputLength).toBe('function')
  })

  test('resolveDefaultShell: exists', () => {
    expect(typeof resolveDefaultShell).toBe('function')
  })

  test('shellToolUtils: isPowerShellToolEnabled and SHELL_TOOL_NAMES exported', () => {
    expect(typeof isPowerShellToolEnabled).toBe('function')
    expect(Array.isArray(SHELL_TOOL_NAMES)).toBe(true)
  })

  test('readOnlyCommandValidation: GIT_READ_ONLY_COMMANDS, validateFlags, FLAG_PATTERN exported', () => {
    expect(typeof GIT_READ_ONLY_COMMANDS).toBe('object')
    expect(typeof validateFlags).toBe('function')
    expect(FLAG_PATTERN).toBeInstanceOf(RegExp)
  })

  test('specPrefix: buildPrefix and DEPTH_RULES exported', () => {
    expect(typeof buildPrefix).toBe('function')
    expect(typeof DEPTH_RULES).toBe('object')
  })


  test('_deps: setGetPlatformFn and setWhichFn exist', () => {
    expect(typeof setGetPlatformFn).toBe('function')
    expect(typeof setWhichFn).toBe('function')
    expect(typeof setWindowsPathToPosixPathFn).toBe('function')
  })


  test('bashProvider: createBashShellProvider is a function', () => {
    expect(typeof createBashShellProvider).toBe('function')
  })

  test('powershellProvider: createPowerShellProvider and buildPowerShellArgs exist', () => {
    expect(typeof createPowerShellProvider).toBe('function')
    expect(typeof buildPowerShellArgs).toBe('function')
    expect(buildPowerShellArgs('echo hello')).toEqual(['-NoProfile', '-NonInteractive', '-Command', 'echo hello'])
  })

  test('ShellSnapshot: createAndSaveSnapshot, createRipgrepShellIntegration, createFindGrepShellIntegration exist', () => {
    expect(typeof createAndSaveSnapshot).toBe('function')
    expect(typeof createRipgrepShellIntegration).toBe('function')
    expect(typeof createFindGrepShellIntegration).toBe('function')
  })


  test('quote: can quote a simple argument', () => {
    const result = quote(['echo', 'hello world'])
    expect(typeof result).toBe('string')
  })

  test('tryParseShellCommand: can parse a simple command', () => {
    const result = tryParseShellCommand('echo hello')
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.tokens.length).toBeGreaterThan(0)
    }
  })

  test('tryQuoteShellArgs: can quote args', () => {
    const result = tryQuoteShellArgs(['echo', 'hello world'])
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.quoted).toContain('echo')
    }
  })

  test('quoteShellCommand: can quote a command', () => {
    const result = quoteShellCommand('echo "hello world"')
    expect(typeof result).toBe('string')
  })

  test('splitCommand_DEPRECATED: splits simple command', () => {
    const parts = splitCommand_DEPRECATED('echo hello world')
    expect(parts.length).toBeGreaterThan(0)
  })

  test('splitCommandWithOperators: splits with operators', () => {
    const parts = splitCommandWithOperators('echo hello && echo world')
    expect(parts.length).toBeGreaterThan(0)
  })

  test('isHelpCommand: detects --help', () => {
    expect(isHelpCommand('git --help')).toBe(true)
    expect(isHelpCommand('git status')).toBe(false)
  })

  test('containsHeredoc: detects non-heredoc', () => {
    expect(containsHeredoc('echo hello')).toBe(false)
  })

  test('shouldAddStdinRedirect: detects redirect', () => {
    const result = shouldAddStdinRedirect('echo hello')
    expect(typeof result).toBe('boolean')
  })

  test('getMaxOutputLength: returns a number', () => {
    const limit = getMaxOutputLength()
    expect(typeof limit).toBe('number')
    expect(limit).toBeGreaterThan(0)
  })

  test('validateFlags: is a function with correct signature', () => {
    expect(typeof validateFlags).toBe('function')
    expect(validateFlags.length).toBeGreaterThanOrEqual(3) // (tokens, startIndex, config, options?)
  })

  test('getCommandSpec: returns null for unknown command', async () => {
    const spec = await getCommandSpec('nonexistent_command_xyz')
    expect(spec).toBeNull()
  })

  test('buildPrefix: builds prefix for simple command', async () => {
    const result = await buildPrefix('echo', ['hello'], null)
    expect(typeof result).toBe('string')
  })


  test('subprocessEnv: returns env object', () => {
    const env = subprocessEnv()
    expect(typeof env).toBe('object')
    expect(env).toHaveProperty('PATH')
  })

  test('registerUpstreamProxyEnvFn: is a function', () => {
    expect(typeof registerUpstreamProxyEnvFn).toBe('function')
  })

  // ─── Phase 3: ShellCommand ─────────────────────────────────────────

  test('wrapSpawn: is a function', () => {
    expect(typeof wrapSpawn).toBe('function')
  })

  test('createAbortedCommand: returns killed command', () => {
    const cmd = createAbortedCommand()
    expect(cmd.status).toBe('killed')
    expect(typeof cmd.cleanup).toBe('function')
  })

  test('createFailedCommand: returns completed command with error', () => {
    const cmd = createFailedCommand('test error')
    expect(cmd.status).toBe('completed')
  })


  test('findSuitableShell: is a function', () => {
    expect(typeof findSuitableShell).toBe('function')
  })

  test('createProviderResolver: is a function', () => {
    expect(typeof createProviderResolver).toBe('function')
  })


  test('exec: is a function', () => {
    expect(typeof exec).toBe('function')
  })

  test('setCwd: is a function', () => {
    expect(typeof setCwd).toBe('function')
  })

  test('exec injection setters: exist', () => {
    expect(typeof setCreateTaskOutputFn).toBe('function')
    expect(typeof setGetSandboxTmpDirNameFn).toBe('function')
  })
})
