/**
 * installPluginBindings — wire every `@claude-code/config/plugin/_deps`
 * setter to the host's real implementation. Host-binding adapter file.
 *
 * Plugin subsystem was moved out of src/utils/plugins/ in Round 4. 53
 * external deps (bootstrap/state, tools/*, services/lsp, services/mcp,
 * commands.js, AppState, various utils) are funneled through setter
 * injection to keep the package src/-free.
 *
 * Must run during runtime bootstrap, BEFORE any code path touches the
 * plugin package. The require-time side effect at the bottom of this
 * file handles that as long as this module is imported early.
 *
 * Every `try { require(...) } catch {}` block in this file is a
 * by-design require-fallback for an optional/feature-gated subsystem
 * (computer-use, voice, swarm, etc.); the catch returns the no-op
 * default so the wire still installs cleanly when the module is absent.
 */

import {
  setBuildPluginTelemetryFieldsFn,
  setCheckBinaryExistsFn,
  setClassifyPluginCommandErrorFn,
  setCloneFn,
  setExecFileNoThrowFn,
  setExecFileNoThrowWithCwdFn,
  setFileEditConstantsFn,
  setFileReadPromptFn,
  setFileWritePromptFn,
  setFsImplementationFn,
  setGetCharBudgetFn,
  setGetCwdFn,
  setGetHeadForDirFn,
  setGetInlinePluginsFn,
  setGetOriginalCwdFn,
  setGetSessionIdFn,
  setGetSettingsForSourceFn,
  setGetSettingsFn,
  setGitExeFn,
  setIsSettingSourceEnabledFn,
  setJsonParseFn,
  setJsonStringifyFn,
  setLoadAgentsDirFn,
  setLogErrorFn,
  setLogForDebuggingFn,
  setLogForDiagnosticsNoPIIFn,
  setLoadMarkdownConfigFn,
  setPathExistsFn,
  setPluginOperationsFn,
  setRegisterCleanupFn,
  setSafeResolvePathFn,
  setSanitizePathFn,
  setSkillToolPromptFn,
  setWhichFn,
  setWriteFileSyncAndFlushFn,
  setAgentColorManagerFn,
  setRgPathFn,
  setSecureStorageReadFn,
  setSecureStorageWriteFn,
  setExpandMcpEnvFn,
  setGetLspManagerFn,
  setGetMcpTypesFn,
  setParseMarkdownFrontmatterFn,
  setWalkMarkdownFilesFn,
  setGetRegisteredHooksFn,
  setRegisterHookCallbacksFn,
  setClearRegisteredPluginHooksFn,
  setGetSecureStorageFn,
  // -- Wave A teardown: 20 silent-no-op slots whose paired getters had
  //    real readers but no host wire. Each silently returned the safe
  //    default — exact same bug class as the ralph-loop hook regression.
  setRipGrepFn,
  setUnzipFileFn,
  setParseZipModesFn,
  setIsFsInaccessibleFn,
  setFindCanonicalGitRootFn,
  setGetSystemDirectoriesFn,
  setGetAdditionalDirectoriesForClaudeMdFn,
  setGetUseCoworkPluginsFn,
  setResetSentSkillNamesFn,
  setUninstallPluginOpFn,
  setUpdatePluginOpFn,
  setClearAgentDefinitionsCacheFn,
  setClearAllOutputStylesCacheFn,
  setClearCommandsCacheFn,
  setClearPromptCacheFn,
  setParseEffortValueFn,
  setParseYamlFn,
  setParseUserSpecifiedModelFn,
  setParseAndValidateManifestFromBytesFn,
  setGetAgentDefinitionsWithOverridesFn,
  // -- Wave A2: remaining 13 unwired slots with real readers
  setIsBuiltinPluginIdFn,
  setGetBuiltinPluginDefinitionFn,
  setExtractDescriptionFromMarkdownFn,
  setExpandTildeFn,
  setExpandEnvVarsInStringFn,
  setExecuteShellCommandsInPromptFn,
  setParseFrontmatterFn,
  setParseAgentToolsFromFrontmatterFn,
  setParseSlashCommandToolsFromFrontmatterFn,
  setParseShellFrontmatterFn,
  setParseBooleanFrontmatterFn,
  setParsePositiveIntFromFrontmatterFn,
  setParseArgumentNamesFn,
  setSubstituteArgumentsFn,
  setPluralFn,
  setHasShownHintThisSessionFn,
  setSetPendingHintFn,
  setReinitializeLspServerManagerFn,
  setWaitForScrollIdleFn,
  setWithDiagnosticsTimingFn,
  setWriteFileSyncFn,
  setWriteToStdoutFn,
  setGracefulShutdownFn,
} from '@claude-code/config/plugin/_deps'

import {
  clearRegisteredPluginHooks,
  getInlinePlugins,
  getOriginalCwd,
  getRegisteredHooks,
  getSessionId,
  registerHookCallbacks,
} from '../bootstrap/state.js'
import { isBinaryInstalled } from '@claude-code/updater/binaryCheck.js'
import { registerCleanup } from '../bootstrap/cleanupRegistry.js'
import { getCwd } from '../bootstrap/cwd.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logForDiagnosticsNoPII } from '@claude-code/local-observability/logging'
import {
  toError as _toError, // kept for clarity though _deps has own
} from '@claude-code/local-observability/errorHelpers.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
} from '@claude-code/shell/execFileNoThrow.js'
import { pathExists, writeFileSyncAndFlush } from '@claude-code/storage/file.js'
import { getFsImplementation, safeResolvePath } from '@claude-code/storage/fsOperations.js'
import { gitExe } from '@claude-code/storage/git.js'
import { getHeadForDir } from '@claude-code/config/gitFilesystem.js'
import { logError } from '@claude-code/local-observability/logging'
import { clone, jsonParse, jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import { which } from '@claude-code/shell/which.js'
import {
  getSettingsForSource,
  getSettings,
} from '@claude-code/config/settings'
import { isSettingSourceEnabled } from '@claude-code/config/constants'
import {
  buildPluginTelemetryFields,
  classifyPluginCommandError,
} from '@claude-code/tool-registry/telemetry/pluginTelemetry.js'

let installed = false

export function installPluginBindings(): void {
  if (installed) return
  installed = true

  // --- logging
  setLogForDebuggingFn((message, ...args) =>
    logForDebugging(message, ...(args as any)),
  )
  setLogErrorFn(error => logError(error))
  setLogForDiagnosticsNoPIIFn((level, event, data) =>
    logForDiagnosticsNoPII(level, event, data),
  )

  // --- registered hooks (THE root cause of plugin Stop hooks not firing
  // post-V7: loadPluginHooks() writes to _deps.ts placeholders, agent/hooks.ts
  // reads from app-host STATE. Without these three wires the halves diverge
  // and every plugin hook silently lands in a no-op slot.)
  setGetRegisteredHooksFn(() => getRegisteredHooks() as never)
  setRegisterHookCallbacksFn(hooks => registerHookCallbacks(hooks as never))
  setClearRegisteredPluginHooksFn(() => clearRegisteredPluginHooks())

  // --- secureStorage (sister wire of registered hooks: same V7 setter slot
  // pattern, also never connected. loadPluginOptions reads `storage.read()`
  // and crashes on null when the placeholder default fires — surfaces as
  // "null is not an object (evaluating storage.read())" inside every hook
  // command spawn.)
  setGetSecureStorageFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/storage/secureStorage.js')
    return mod.getSecureStorage?.() ?? null
  })

  // --- Wave A teardown: 20 silent-no-op slots whose paired getters had
  //     real readers but no host wire. Each was identical in shape to the
  //     ralph-loop bug (slot declared, default no-op, reader silently
  //     gets the no-op). Every wire below maps the slot to its canonical
  //     V7 implementation. Where a require() is used instead of a static
  //     import, it's to avoid load-order issues when the impl module
  //     also touches host state during its own init.
  setRipGrepFn(async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ripGrep } = require('@claude-code/tool-registry/ripgrep.js')
    return ripGrep(...args)
  })
  setUnzipFileFn((zipPath, destDir) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { unzipFile } = require('@claude-code/config/dxt/zip.js')
    return unzipFile(zipPath, destDir)
  })
  setParseZipModesFn((data: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseZipModes } = require('@claude-code/config/dxt/zip.js')
    return parseZipModes(data)
  })
  setIsFsInaccessibleFn((err: unknown): boolean => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isFsInaccessible } = require('@claude-code/local-observability/errorHelpers.js')
    return isFsInaccessible(err)
  })
  setFindCanonicalGitRootFn((p: string): string => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { findCanonicalGitRoot } = require('@claude-code/storage/git.js')
    return findCanonicalGitRoot(p)
  })
  setGetSystemDirectoriesFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getSystemDirectories } = require('@claude-code/agent/misc/systemDirectories.js')
    return getSystemDirectories()
  })
  setGetAdditionalDirectoriesForClaudeMdFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../bootstrap/state.js')
    return mod.getAdditionalDirectoriesForClaudeMd?.() ?? []
  })
  setGetUseCoworkPluginsFn((): boolean => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('../bootstrap/state.js')
    return mod.getUseCoworkPlugins?.() ?? false
  })
  setResetSentSkillNamesFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { resetSentSkillNames } = require('@claude-code/agent/attachments.js')
    resetSentSkillNames()
  })
  setUninstallPluginOpFn(async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { uninstallPluginOp } = require('@claude-code/config/plugin/pluginOperations.js')
    return uninstallPluginOp(...args)
  })
  setUpdatePluginOpFn(async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { updatePluginOp } = require('@claude-code/config/plugin/pluginOperations.js')
    return updatePluginOp(...args)
  })
  setClearAgentDefinitionsCacheFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clearAgentDefinitionsCache } = require('@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js')
    clearAgentDefinitionsCache()
  })
  setClearAllOutputStylesCacheFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clearAllOutputStylesCache } = require('@claude-code/config/outputStyles.js')
    clearAllOutputStylesCache()
  })
  setClearCommandsCacheFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clearCommandsCache } = require('@claude-code/command-runtime/api.js')
    clearCommandsCache()
  })
  setClearPromptCacheFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { clearPromptCache } = require('@claude-code/tool-registry/tools/SkillTool/prompt.js')
    clearPromptCache()
  })
  setParseEffortValueFn((v: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseEffortValue } = require('@claude-code/agent/effort.js')
    return parseEffortValue(v)
  })
  setParseYamlFn((input: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseYaml } = require('@claude-code/agent/yaml.js')
    return parseYaml(input)
  })
  setParseUserSpecifiedModelFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseUserSpecifiedModel } = require('@claude-code/provider/model.js')
    return parseUserSpecifiedModel(...args)
  })
  setParseAndValidateManifestFromBytesFn(async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseAndValidateManifestFromBytes } = require('@claude-code/config/dxt/helpers.js')
    return parseAndValidateManifestFromBytes(...args)
  })
  setGetAgentDefinitionsWithOverridesFn(async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getAgentDefinitionsWithOverrides } = require('@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js')
    return getAgentDefinitionsWithOverrides(...args)
  })

  // --- Wave A2: 13 remaining wires
  setIsBuiltinPluginIdFn((id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { isBuiltinPluginId } = require('@claude-code/config/plugin/builtin')
    return isBuiltinPluginId(id)
  })
  setGetBuiltinPluginDefinitionFn((id: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { getBuiltinPluginDefinition } = require('@claude-code/config/plugin/builtin')
    return getBuiltinPluginDefinition(id)
  })
  setExtractDescriptionFromMarkdownFn((text: string, def: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { extractDescriptionFromMarkdown } = require('@claude-code/tool-registry/markdownConfigLoader.js')
    return extractDescriptionFromMarkdown(text, def)
  })
  setExpandTildeFn((p: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { expandTilde } = require('@claude-code/permission/pathValidation.js')
    return expandTilde(p)
  })
  setExpandEnvVarsInStringFn((s: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { expandEnvVarsInString } = require('@claude-code/mcp-runtime/envExpansion.js')
    return expandEnvVarsInString(s)
  })
  setExecuteShellCommandsInPromptFn(async (prompt: string, ...rest: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { executeShellCommandsInPrompt } = require('@claude-code/command-runtime/promptShellExecution.js')
    return executeShellCommandsInPrompt(prompt, ...rest)
  })
  setParseFrontmatterFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseFrontmatter } = require('@claude-code/agent/frontmatterParser.js')
    return parseFrontmatter(...args)
  })
  setParseAgentToolsFromFrontmatterFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseAgentToolsFromFrontmatter } = require('@claude-code/tool-registry/markdownConfigLoader.js')
    return parseAgentToolsFromFrontmatter(...args)
  })
  setParseSlashCommandToolsFromFrontmatterFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseSlashCommandToolsFromFrontmatter } = require('@claude-code/tool-registry/markdownConfigLoader.js')
    return parseSlashCommandToolsFromFrontmatter(...args)
  })
  setParseShellFrontmatterFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseShellFrontmatter } = require('@claude-code/agent/frontmatterParser.js')
    return parseShellFrontmatter(...args)
  })
  setParseBooleanFrontmatterFn((v: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseBooleanFrontmatter } = require('@claude-code/agent/frontmatterParser.js')
    return parseBooleanFrontmatter(v)
  })
  setParsePositiveIntFromFrontmatterFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parsePositiveIntFromFrontmatter } = require('@claude-code/agent/frontmatterParser.js')
    return parsePositiveIntFromFrontmatter(...args)
  })
  setParseArgumentNamesFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { parseArgumentNames } = require('@claude-code/command-runtime/argumentSubstitution.js')
    return parseArgumentNames(...args)
  })
  setSubstituteArgumentsFn((...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { substituteArguments } = require('@claude-code/command-runtime/argumentSubstitution.js')
    return substituteArguments(...args)
  })
  setPluralFn((n: number, singular: string, plural?: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/output/utils/stringUtils.js')
    return mod.plural(n, singular, plural)
  })
  setHasShownHintThisSessionFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { hasShownHintThisSession } = require('@claude-code/tool-registry/claudeCodeHints.js')
    return hasShownHintThisSession()
  })
  setSetPendingHintFn((hint: unknown) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setPendingHint } = require('@claude-code/tool-registry/claudeCodeHints.js')
    setPendingHint(hint)
  })
  setReinitializeLspServerManagerFn(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { reinitializeLspServerManager } = require('@claude-code/ide/lsp/manager.js')
    return reinitializeLspServerManager()
  })
  setWaitForScrollIdleFn(async () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { waitForScrollIdle } = require('../bootstrap/state.js')
    return waitForScrollIdle?.()
  })
  setWithDiagnosticsTimingFn(async <T>(event: string, fn: () => Promise<T>): Promise<T> => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { withDiagnosticsTiming } = require('@claude-code/local-observability/logging')
    return withDiagnosticsTiming(event, fn) as Promise<T>
  })
  setWriteFileSyncFn((path: string, data: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeFileSync } = require('@claude-code/local-observability/slowOperations.js')
    writeFileSync(path, data)
  })
  setWriteToStdoutFn((data: string) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { writeToStdout } = require('@claude-code/shell/process.js')
    writeToStdout(data)
  })
  setGracefulShutdownFn(async (code?: number) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { gracefulShutdown } = require('../bootstrap/gracefulShutdown.js')
    return gracefulShutdown(code)
  })

  // --- session / cwd
  setGetSessionIdFn(() => getSessionId())
  setGetOriginalCwdFn(() => getOriginalCwd())
  setGetCwdFn(() => getCwd())
  setGetInlinePluginsFn(() =>
    getInlinePlugins() as Record<string, unknown> | undefined,
  )

  // --- settings
  setGetSettingsFn(() => getSettings() as any)
  setGetSettingsForSourceFn(source => getSettingsForSource(source as any) as any)
  setIsSettingSourceEnabledFn(source => isSettingSourceEnabled(source as any))

  // --- fs / path (both sync + async methods)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFs = require('node:fs') as typeof import('node:fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const nodeFsp = require('node:fs/promises') as typeof import('node:fs/promises')
  setFsImplementationFn({
    existsSync: p => getFsImplementation().existsSync(p),
    mkdirSync: (p, o) => getFsImplementation().mkdirSync(p, o),
    writeFileSync: (p, d) => getFsImplementation().writeFileSync(p, d),
    readFileSync: (p, e) => getFsImplementation().readFileSync(p, e) as string,
    readdirSync: p =>
      nodeFs.readdirSync(p, { withFileTypes: true }) as Array<{
        name: string
        isFile(): boolean
        isDirectory(): boolean
      }>,
    statSync: p => getFsImplementation().statSync(p) as any,
    rmSync: (p, o) => getFsImplementation().rmSync(p, o as any),
    rmdirSync: p => nodeFs.rmdirSync(p),
    renameSync: (o, n) => getFsImplementation().renameSync(o, n),
    appendFileSync: (p, d) => getFsImplementation().appendFileSync(p, d),
    cwd: () => getFsImplementation().cwd(),
    realpathSync: p => getFsImplementation().realpathSync(p) as string,
    readFile: async (p, opts) =>
      (await nodeFsp.readFile(p, opts?.encoding ?? 'utf-8')) as string,
    readFileBytes: async p => new Uint8Array(await nodeFsp.readFile(p)),
    writeFile: async (p, d) => nodeFsp.writeFile(p, d),
    mkdir: async (p, o) => {
      await nodeFsp.mkdir(p, { recursive: true, ...(o ?? {}) })
    },
    readdir: async p =>
      (await nodeFsp.readdir(p, { withFileTypes: true })) as Array<{
        name: string
        isFile(): boolean
        isDirectory(): boolean
      }>,
    stat: async p => (await nodeFsp.stat(p)) as any,
    rm: async (p, o) => nodeFsp.rm(p, o),
    rename: async (o, n) => nodeFsp.rename(o, n),
  })
  setPathExistsFn(p => pathExists(p))
  setSafeResolvePathFn((base, rel) => safeResolvePath(base, rel) ?? null)
  setWriteFileSyncAndFlushFn((p, d) => writeFileSyncAndFlush(p, d))
  setSanitizePathFn(p => p) // no-op; plugin files have own sanitizePath
  setRegisterCleanupFn(fn => registerCleanup(fn))

  // --- git
  setGitExeFn(() => gitExe() as any)
  setGetHeadForDirFn(dir => getHeadForDir(dir))

  // --- subprocess
  setExecFileNoThrowFn((cmd, args, options) =>
    execFileNoThrow(cmd, args, options) as any,
  )
  setExecFileNoThrowWithCwdFn((cmd, args, cwd, options) =>
    execFileNoThrowWithCwd(cmd, args, cwd, options) as any,
  )
  setWhichFn(cmd => which(cmd))
  setCheckBinaryExistsFn(cmd => isBinaryInstalled(cmd))

  // --- slow ops
  setJsonStringifyFn(v => jsonStringify(v))
  setJsonParseFn(t => jsonParse(t) as unknown)
  setCloneFn(v => clone(v))

  // --- telemetry
  setBuildPluginTelemetryFieldsFn((...args) =>
    buildPluginTelemetryFields(...(args as any)),
  )
  setClassifyPluginCommandErrorFn(error =>
    classifyPluginCommandError(error) as any,
  )

  // --- lazy-resolved integrations (Ant-internal or heavy modules)
  // These are `() => require(...).X` so they don't cause module eagerness.
  setLoadAgentsDirFn(async (...args: unknown[]) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/tool-registry/tools/AgentTool/loadAgentsDir.js')
    return mod.loadAgentsDir(...(args as any)) as Promise<unknown[]>
  })
  setAgentColorManagerFn(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/tool-registry/tools/AgentTool/agentColorManager.js'),
  )
  setFileEditConstantsFn(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/tool-registry/tools/FileEditTool/constants.js'),
  )
  setFileReadPromptFn(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/tool-registry/tools/FileReadTool/prompt.js'),
  )
  setFileWritePromptFn(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/tool-registry/tools/FileWriteTool/prompt.js'),
  )
  setSkillToolPromptFn(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/tool-registry/tools/SkillTool/prompt.js'),
  )
  setGetCharBudgetFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/tool-registry/tools/SkillTool/prompt.js')
    return mod.getCharBudget?.() ?? 10000
  })

  // --- services/plugins/pluginOperations (cyclic with plugin utils)
  setPluginOperationsFn(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('@claude-code/config/plugin/pluginOperations.js'),
  )

  // --- misc helpers
  setRgPathFn(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@claude-code/tool-registry/ripgrep.js')
      return mod.rgPath?.() ?? null
    } catch {
      return null
    }
  })
  setSecureStorageReadFn(async key => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@claude-code/storage/secureStorage.js')
      return mod.secureStorageRead ? await mod.secureStorageRead(key) : null
    } catch {
      return null
    }
  })
  setSecureStorageWriteFn(async (key, value) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('@claude-code/storage/secureStorage.js')
      if (mod.secureStorageWrite) await mod.secureStorageWrite(key, value)
    } catch {
      // ignore
    }
  })
  setParseMarkdownFrontmatterFn(text => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/agent/frontmatterParser.js')
    return mod.parseMarkdownFrontmatter
      ? mod.parseMarkdownFrontmatter(text)
      : { frontmatter: {}, body: '' }
  })
  setWalkMarkdownFilesFn(async dir => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/tool-registry/markdownConfigLoader.js')
    return mod.walkMarkdownFiles
      ? ((await mod.walkMarkdownFiles(dir)) as string[])
      : []
  })
  setLoadMarkdownConfigFn(path => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/tool-registry/markdownConfigLoader.js')
    return mod.loadMarkdownConfig ? mod.loadMarkdownConfig(path) : null
  })
  setGetLspManagerFn(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('@claude-code/ide/lsp/manager.js')
    } catch {
      return undefined
    }
  })
  setGetMcpTypesFn(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require('@claude-code/mcp-runtime/types.js')
    } catch {
      return undefined
    }
  })
  setExpandMcpEnvFn(env => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('src/services/mcp/envExpansion.js')
      return mod.expandMcpEnv ? mod.expandMcpEnv(env) : env
    } catch {
      return env
    }
  })

  // --- builtin plugins (setter-based since originals are const arrays)
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('@claude-code/config/plugin/builtin')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const {
      setGetBuiltinPluginsFn: _sgb,
      setIsBuiltinPluginIdFn: _sid,
      setGetBuiltinPluginDefinitionFn: _sgd,
    } = require('@claude-code/config/plugin/_deps')
    if (mod.getBuiltinPlugins) _sgb(() => mod.getBuiltinPlugins())
    if (mod.isBuiltinPluginId) _sid(mod.isBuiltinPluginId)
    if (mod.getBuiltinPluginDefinition) _sgd(mod.getBuiltinPluginDefinition)
  } catch (e) {
    // Builtin plugins not available — fall back to empty structure.
  }

  // --- argumentSubstitution + hints providers
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const argMod = require('src/utils/argumentSubstitution.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setApplyArgumentSubstitutionsFn: _sas } = require(
      '@claude-code/config/plugin/_deps',
    )
    if (argMod.applyArgumentSubstitutions) _sas(argMod.applyArgumentSubstitutions)
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const hintMod = require('@claude-code/tool-registry/claudeCodeHints.js')
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { setGetHintsProviderFn: _gh } = require(
      '@claude-code/config/plugin/_deps',
    )
    if (hintMod.getHintsProvider) _gh(hintMod.getHintsProvider)
  } catch {
    // ignore
  }
}

installPluginBindings()
