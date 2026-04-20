/**
 * installPluginBindings — wire every `@claude-code/config/plugin/_deps`
 * setter to the host's real implementation.
 *
 * Plugin subsystem was moved out of src/utils/plugins/ in Round 4. 53
 * external deps (bootstrap/state, tools/*, services/lsp, services/mcp,
 * commands.js, AppState, various utils) are funneled through setter
 * injection to keep the package src/-free.
 *
 * Must run during runtime bootstrap, BEFORE any code path touches the
 * plugin package. The require-time side effect at the bottom of this
 * file handles that as long as this module is imported early.
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
  setGetAppStateFn,
  setGetCharBudgetFn,
  setGetCwdFn,
  setGetHeadForDirFn,
  setGetInlinePluginsFn,
  setGetOriginalCwdFn,
  setGetSessionIdFn,
  setGetSettingsForSourceFn,
  setGetSettings_DEPRECATEDFn,
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
} from '@claude-code/config/plugin/_deps'

import {
  getInlinePlugins,
  getOriginalCwd,
  getSessionId,
} from '../bootstrap/state.js'
import { isBinaryInstalled } from '@claude-code/updater/binaryCheck.js'
import { registerCleanup } from '@claude-code/app-host/bootstrap/cleanupRegistry.js'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { logForDiagnosticsNoPII } from '@claude-code/local-observability/logging'
import {
  toError as _toError, // kept for clarity though _deps has own
} from '@claude-code/local-observability/errorHelpers.js'
import {
  execFileNoThrow,
  execFileNoThrowWithCwd,
} from 'src/utils/execFileNoThrow.js'
import { pathExists, writeFileSyncAndFlush_DEPRECATED } from '@claude-code/storage/file.js'
import { getFsImplementation, safeResolvePath } from '@claude-code/storage/fsOperations.js'
import { gitExe } from 'src/utils/git.js'
import { getHeadForDir } from 'src/utils/git/gitFilesystem.js'
import { logError } from '@claude-code/local-observability/logging'
import { clone, jsonParse, jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import { which } from '@claude-code/shell/which.js'
import {
  getSettingsForSource,
  getSettings_DEPRECATED,
} from '@claude-code/config/settings'
import { isSettingSourceEnabled } from '@claude-code/config/constants'
import {
  buildPluginTelemetryFields,
  classifyPluginCommandError,
} from 'src/utils/telemetry/pluginTelemetry.js'

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

  // --- session / cwd
  setGetSessionIdFn(() => getSessionId())
  setGetOriginalCwdFn(() => getOriginalCwd())
  setGetCwdFn(() => getCwd())
  setGetInlinePluginsFn(() =>
    getInlinePlugins() as Record<string, unknown> | undefined,
  )

  // --- settings
  setGetSettings_DEPRECATEDFn(() => getSettings_DEPRECATED() as any)
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
    readdirSync: p => getFsImplementation().readdirSync(p) as string[],
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
    readdir: async p => (await nodeFsp.readdir(p)) as string[],
    stat: async p => (await nodeFsp.stat(p)) as any,
    rm: async (p, o) => nodeFsp.rm(p, o),
    rename: async (o, n) => nodeFsp.rename(o, n),
  })
  setPathExistsFn(p => pathExists(p))
  setSafeResolvePathFn((base, rel) => safeResolvePath(base, rel) ?? null)
  setWriteFileSyncAndFlushFn((p, d) => writeFileSyncAndFlush_DEPRECATED(p, d))
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

  // --- app state
  setGetAppStateFn(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('src/state/AppState.js') as {
      getAppState: () => unknown
    }
    return mod.getAppState?.() ?? {}
  })

  // --- services/plugins/pluginOperations (cyclic with plugin utils)
  setPluginOperationsFn(
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require('src/services/plugins/pluginOperations.js'),
  )

  // --- misc helpers
  setRgPathFn(() => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('src/utils/ripgrep.js')
      return mod.rgPath?.() ?? null
    } catch {
      return null
    }
  })
  setSecureStorageReadFn(async key => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('src/utils/secureStorage/index.js')
      return mod.secureStorageRead ? await mod.secureStorageRead(key) : null
    } catch {
      return null
    }
  })
  setSecureStorageWriteFn(async (key, value) => {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const mod = require('src/utils/secureStorage/index.js')
      if (mod.secureStorageWrite) await mod.secureStorageWrite(key, value)
    } catch {
      // ignore
    }
  })
  setParseMarkdownFrontmatterFn(text => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('src/utils/frontmatterParser.js')
    return mod.parseMarkdownFrontmatter
      ? mod.parseMarkdownFrontmatter(text)
      : { frontmatter: {}, body: '' }
  })
  setWalkMarkdownFilesFn(async dir => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('src/utils/markdownConfigLoader.js')
    return mod.walkMarkdownFiles
      ? ((await mod.walkMarkdownFiles(dir)) as string[])
      : []
  })
  setLoadMarkdownConfigFn(path => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('src/utils/markdownConfigLoader.js')
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
      return require('src/services/mcp/types.js')
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
    const hintMod = require('src/utils/claudeCodeHints.js')
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
