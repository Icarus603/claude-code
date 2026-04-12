import {
  installPackageHostBindings as installPackageHostBindingsFromAppHost,
  type PackageHostBindingInstallers,
} from '@claude-code/app-host/packageHostSetup'
import { logForDebugging } from '../utils/debug.js'
import { getClaudeConfigHomeDir } from '../utils/envUtils.js'
import { findCanonicalGitRoot } from '../utils/git.js'
import { getCwd } from '../utils/cwd.js'

export function installPackageHostBindings(
  installers: PackageHostBindingInstallers = {},
): void {
  installPackageHostBindingsFromAppHost(
    {
      getConfigHomeDir: () => getClaudeConfigHomeDir(),
      getProjectRoot: () => findCanonicalGitRoot(getCwd()),
      logDebug: (message, metadata) => logForDebugging(message, metadata as any),
      now: () => Date.now(),
      // V7 §8.6 — bridge MCP validation errors into config without a
      // direct config → mcp-runtime dependency. Lazy-imported so the MCP
      // module tree doesn't load at config-init time.
      getMcpErrorsByScope: (scope: string) => {
        try {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          const { getMcpConfigsByScope } = require('../services/mcp/config.js') as typeof import('../services/mcp/config.js')
          return getMcpConfigsByScope(scope as any).errors
        } catch {
          return []
        }
      },
    },
    {
      installProviderBindings:
        installers.installProviderBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installProviderBindings.js')
        }),
      installToolRegistryBindings:
        installers.installToolRegistryBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installToolRegistryBindings.js')
        }),
      installCommandRuntimeBindings:
        installers.installCommandRuntimeBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installCommandRuntimeBindings.js')
        }),
      installMcpRuntimeBindings:
        installers.installMcpRuntimeBindings ??
        (() => {
          // eslint-disable-next-line @typescript-eslint/no-require-imports
          require('../runtime/installMcpRuntimeBindings.js')
        }),
    },
  )
}
