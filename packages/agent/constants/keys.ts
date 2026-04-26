import { isEnvTruthy } from '@claude-code/config/env/utils'
import { readEnv } from '@claude-code/config/env/utils'

// Lazy read so ENABLE_GROWTHBOOK_DEV from globalSettings.env (applied after
// module load) is picked up. USER_TYPE is a build-time define so it's safe.
export function getGrowthBookClientKey(): string {
  // Adapter-first: custom GrowthBook server
  const adapterKey = readEnv('CLAUDE_GB_ADAPTER_KEY')
  if (adapterKey) return adapterKey

  return readEnv('USER_TYPE') === 'ant'
    ? isEnvTruthy(readEnv('ENABLE_GROWTHBOOK_DEV'))
      ? 'sdk-yZQvlplybuXjYh6L'
      : 'sdk-xRVcrliHIlrg4og4'
    : 'sdk-zAZezfDKGoZuXXKe'
}
