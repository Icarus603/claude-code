/**
 * installOutputBindings — wires host-side implementations into the
 * `@claude-code/output/_deps` setters.
 *
 * output is a Wave-2 platform-foundation package. Anything cross-boundary
 * (session id, original cwd, cleanup registry, debug logger, error logger,
 * intl formatters, fs impl, path sanitizer, claude config home dir) is
 * injected here so the package itself imports nothing from src/.
 *
 * Called from src/runtime/bootstrap.ts on startup.
 */

import {
  setFsImplementationFn,
  setGetClaudeConfigHomeDirFn,
  setGetOriginalCwdFn,
  setGetRelativeTimeFormatFn,
  setGetSessionIdFn,
  setGetTimeZoneFn,
  setJsonStringifyFn,
  setLogErrorFn,
  setLogForDebuggingFn,
  setRegisterCleanupFn,
  setSanitizePathFn,
} from '@claude-code/output/_deps'

import { getOriginalCwd, getSessionId } from '../bootstrap/state.js'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import { getRelativeTimeFormat, getTimeZone } from 'src/utils/intl.js'
import { logError } from 'src/utils/log.js'
import { logForDebugging } from 'src/utils/debug.js'
import { registerCleanup } from '@claude-code/app-host/bootstrap/cleanupRegistry.js'
import { sanitizePath } from 'src/utils/path.js'
import { jsonStringify } from '@claude-code/local-observability/slowOperations.js'

let installed = false

export function installOutputBindings(): void {
  if (installed) return
  installed = true

  setGetSessionIdFn(() => getSessionId())
  setGetOriginalCwdFn(() => getOriginalCwd())
  setRegisterCleanupFn(fn => registerCleanup(fn))
  setLogForDebuggingFn((message, ...args) =>
    logForDebugging(message, ...(args as any)),
  )
  setLogErrorFn(error => logError(error))
  setGetRelativeTimeFormatFn((style, numeric) =>
    getRelativeTimeFormat(style, numeric),
  )
  setGetTimeZoneFn(() => getTimeZone())
  setJsonStringifyFn(value => jsonStringify(value))
  setSanitizePathFn(path => sanitizePath(path))
  setFsImplementationFn({
    existsSync: p => getFsImplementation().existsSync(p),
    mkdirSync: (p, o) => getFsImplementation().mkdirSync(p, o),
    writeFileSync: (p, d) => getFsImplementation().writeFileSync(p, d),
    readFileSync: (p, e) => getFsImplementation().readFileSync(p, e) as string,
    appendFileSync: (p, d) => getFsImplementation().appendFileSync(p, d),
  })
  setGetClaudeConfigHomeDirFn(() => getClaudeConfigHomeDir())
}

installOutputBindings()
