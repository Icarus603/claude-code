import { isInBundledMode } from '@claude-code/config/bundledMode'
import { getCurrentInstallationType } from 'src/utils/doctorDiagnostic.js'
import { isEnvTruthy } from '@claude-code/config/env/utils'
import { useStartupNotification } from './useStartupNotification.js'

const NPM_DEPRECATION_MESSAGE =
  ''

export function useNpmDeprecationNotification(): void {
  useStartupNotification(async () => {
    if (
      isInBundledMode() ||
      isEnvTruthy(process.env.DISABLE_INSTALLATION_CHECKS)
    ) {
      return null
    }
    const installationType = await getCurrentInstallationType()
    if (installationType === 'development') return null
    return {
      timeoutMs: 15000,
      key: 'npm-deprecation-warning',
      text: NPM_DEPRECATION_MESSAGE,
      color: 'warning',
      priority: 'high',
    }
  })
}
