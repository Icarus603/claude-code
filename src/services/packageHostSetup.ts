import { installAgentHostBindings } from '@claude-code/agent'
import { installCliHostBindings } from '@claude-code/cli'
import { installConfigHostBindings } from '@claude-code/config'
import { installMemoryHostBindings } from '@claude-code/memory'
import { installPermissionHostBindings } from '@claude-code/permission'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { findCanonicalGitRoot } from '../utils/git.js'
import { getCwd } from '../utils/cwd.js'

let packageHostBindingsInstalled = false

export function installPackageHostBindings(): void {
  if (packageHostBindingsInstalled) {
    return
  }

  installConfigHostBindings({
    getConfigHomeDir: () => getClaudeConfigHomeDir(),
    getProjectRoot: () => findCanonicalGitRoot(getCwd()),
    logDebug: (message, metadata) => logForDebugging(message, metadata as any),
  })

  installPermissionHostBindings({
    now: () => Date.now(),
    logDebug: (message, metadata) => logForDebugging(message, metadata as any),
  })

  installMemoryHostBindings({
    now: () => Date.now(),
    logDebug: (message, metadata) => logForDebugging(message, metadata as any),
  })

  installAgentHostBindings({
    now: () => Date.now(),
    logDebug: (message, metadata) => logForDebugging(message, metadata as any),
  })

  installCliHostBindings({
    logDebug: (message, metadata) => logForDebugging(message, metadata as any),
  })

  packageHostBindingsInstalled = true
}

installPackageHostBindings()

