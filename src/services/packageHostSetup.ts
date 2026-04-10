import { installHostBindings } from '@claude-code/app-host'
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

export type PackageHostBindingInstallers = {
  installProviderBindings?: () => void
  installToolRegistryBindings?: () => void
  installCommandRuntimeBindings?: () => void
  installMcpRuntimeBindings?: () => void
}

function installDefaultRuntimeBindings(): Required<PackageHostBindingInstallers> {
  return {
    installProviderBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@claude-code/provider/providerHostSetup')
    },
    installToolRegistryBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@claude-code/tool-registry/runtime')
    },
    installCommandRuntimeBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@claude-code/command-registry/runtime')
    },
    installMcpRuntimeBindings: () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      require('@claude-code/mcp-runtime/client')
    },
  }
}

export function installCorePackageHostBindings(): void {
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

export function installPackageHostBindings(
  installers: PackageHostBindingInstallers = {},
): void {
  const defaultInstallers = installDefaultRuntimeBindings()
  installHostBindings({
    installCorePackageBindings: () => installCorePackageHostBindings(),
    installProviderBindings:
      installers.installProviderBindings ??
      defaultInstallers.installProviderBindings,
    installToolRegistryBindings:
      installers.installToolRegistryBindings ??
      defaultInstallers.installToolRegistryBindings,
    installCommandRuntimeBindings:
      installers.installCommandRuntimeBindings ??
      defaultInstallers.installCommandRuntimeBindings,
    installMcpRuntimeBindings:
      installers.installMcpRuntimeBindings ??
      defaultInstallers.installMcpRuntimeBindings,
    installCliBindings: () => installCorePackageHostBindings(),
  })
}
