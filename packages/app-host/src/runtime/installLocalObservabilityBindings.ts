/**
 * installLocalObservabilityBindings — wires root src/* utilities into the
 * @claude-code/local-observability package at runtime.
 *
 * local-observability is a Wave-1 leaf package with no src/* imports.
 * Any piece of app state (session id, fs, cache paths, privacy flag,
 * cleanup registry, debug logger, sentry) that its moved modules need
 * is injected here via setter calls on @claude-code/local-observability/_deps.
 *
 * Called from src/runtime/bootstrap.ts on startup.
 */

import {
  setCachePathsFn,
  setCaptureExceptionFn,
  setFsImplementationFn,
  setGetAgentIdFn,
  setGetAgentNameFn,
  setGetClaudeConfigHomeDirFn,
  setGetOauthAccountInfoFn,
  setGetOrCreateUserIDFn,
  setGetParentSessionIdFn,
  setGetSessionIdFn,
  setGetTerminalTypeFn,
  setIsEssentialTrafficOnlyFn,
  setJsonParseFn,
  setJsonStringifyFn,
  setLastAPIRequestFn,
  setLastAPIRequestMessagesFn,
  setLogForDebuggingFn,
  setRegisterCleanupFn,
  setToTaggedIdFn,
} from '@claude-code/local-observability/_deps'
import { getOrCreateUserID } from '@claude-code/config'

import {
  setLastAPIRequest,
  setLastAPIRequestMessages,
  getSessionId,
} from '../bootstrap/state.js'
import { getOauthAccountInfo } from '@claude-code/provider/authAlias.js'
import { CACHE_PATHS } from '@claude-code/storage/cache-paths'
import { registerCleanup } from '@claude-code/app-host/bootstrap/cleanupRegistry.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { envDynamic } from '@claude-code/config/env/dynamic'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { getFsImplementation } from '@claude-code/storage/fsOperations.js'
import { isEssentialTrafficOnly } from '@claude-code/config/env/privacy-level'
import { captureException } from 'src/utils/sentry.js'
import { jsonParse, jsonStringify } from '@claude-code/local-observability/slowOperations.js'
import { toTaggedId } from 'src/utils/taggedId.js'
import {
  getAgentId,
  getAgentName,
  getParentSessionId,
} from '@claude-code/swarm/teammateState.js'

let installed = false

export function installLocalObservabilityBindings(): void {
  if (installed) return
  installed = true

  setFsImplementationFn(getFsImplementation() as any)
  setCachePathsFn({
    errors: () => CACHE_PATHS.errors(),
    mcpLogs: (serverName: string) => CACHE_PATHS.mcpLogs(serverName),
  })
  setGetSessionIdFn(() => getSessionId())
  setLastAPIRequestFn(params => setLastAPIRequest(params as any))
  setLastAPIRequestMessagesFn(messages => setLastAPIRequestMessages(messages as any))
  setIsEssentialTrafficOnlyFn(() => isEssentialTrafficOnly())
  setRegisterCleanupFn(fn => registerCleanup(fn))
  setLogForDebuggingFn((message, ...args) => logForDebugging(message, ...(args as any)))
  setCaptureExceptionFn(error => captureException(error))
  setJsonStringifyFn(value => jsonStringify(value))
  setJsonParseFn(text => jsonParse(text) as unknown)
  setGetOauthAccountInfoFn(() => getOauthAccountInfo())
  setGetOrCreateUserIDFn(() => getOrCreateUserID())
  setGetTerminalTypeFn(() => envDynamic.terminal)
  setToTaggedIdFn((kind, id) => toTaggedId(kind, id))
  setGetClaudeConfigHomeDirFn(() => getClaudeConfigHomeDir())
  setGetAgentIdFn(() => getAgentId())
  setGetAgentNameFn(() => getAgentName())
  setGetParentSessionIdFn(() => getParentSessionId())
}

installLocalObservabilityBindings()
