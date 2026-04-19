/**
 * installConfigEnvBindings — wires host-side implementations into
 * `@claude-code/config/env/_deps` setters so the migrated env modules
 * (paths.ts, dynamic.ts, validation.ts, privacy.ts, git-settings.ts)
 * have working cross-boundary dependencies.
 *
 * Called from src/runtime/bootstrap.ts on startup.
 */

import {
  setExecFileNoThrowFn,
  setEnvFsImplementationFn,
  setFileSuffixForOauthConfigFn,
  setFindExecutableFn,
  setGetAncestorCommandsAsyncFn,
  setIsRunningWithBunFn,
  setWhichFn,
} from '@claude-code/config/env/_deps'

import { fileSuffixForOauthConfig } from 'src/constants/oauth.js'
import { isRunningWithBun } from 'src/utils/bundledMode.js'
import { execFileNoThrow } from 'src/utils/execFileNoThrow.js'
import { findExecutable } from '@claude-code/shell/findExecutable.js'
import { getFsImplementation } from 'src/utils/fsOperations.js'
import { getAncestorCommandsAsync } from 'src/utils/genericProcessUtils.js'
import { which } from 'src/utils/which.js'

let installed = false

export function installConfigEnvBindings(): void {
  if (installed) return
  installed = true

  setEnvFsImplementationFn({
    existsSync: p => getFsImplementation().existsSync(p),
    readFileSync: (p, opts) =>
      getFsImplementation().readFileSync(p, opts) as string,
  })
  setFileSuffixForOauthConfigFn(() => fileSuffixForOauthConfig())
  setIsRunningWithBunFn(() => isRunningWithBun())
  setWhichFn(command => which(command))
  setFindExecutableFn((name, paths) => findExecutable(name, paths))
  setExecFileNoThrowFn((cmd, args) =>
    execFileNoThrow(cmd, args) as Promise<{
      code: number
      stdout?: string
      stderr?: string
    }>,
  )
  setGetAncestorCommandsAsyncFn((pid, maxDepth) =>
    getAncestorCommandsAsync(pid, maxDepth),
  )
}

installConfigEnvBindings()
