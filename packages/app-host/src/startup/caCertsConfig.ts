/**
 * Config/settings-backed NODE_EXTRA_CA_CERTS population for `caCerts.ts`.
 *
 * Split from `caCerts.ts` because `config.ts` → `file.ts` →
 * `permissions/filesystem.ts` → `commands.ts` transitively pulls in ~5300
 * modules (REPL, React, every slash command). `proxy.ts`/`mtls.ts` (and
 * therefore anything using HTTPS through our proxy agent — WebSocketTransport,
 * CCRClient, telemetry) must NOT depend on that graph, or the Agent SDK
 * bundle (`connectRemoteControl` path) bloats from ~0.4 MB to ~10.8 MB.
 *
 * `getCACertificates()` only reads `process.env.NODE_EXTRA_CA_CERTS`. This
 * module is the one place allowed to import `config.ts` to *populate* that
 * env var at CLI startup. Only `init.ts` imports this file.
 */

import { getGlobalConfig } from '@claude-code/config'
import { readEnv, setEnv } from '@claude-code/config/env/utils'
import { getSettingsForSource } from '@claude-code/config/settings'
import { logForDebugging } from '@claude-code/local-observability/debug.js'

export function applyExtraCACertsFromConfig(): void {
  if (readEnv('NODE_EXTRA_CA_CERTS')) {
    return
  }
  const configPath = getExtraCertsPathFromConfig()
  if (configPath) {
    setEnv('NODE_EXTRA_CA_CERTS', configPath)
    logForDebugging(
      `CA certs: Applied NODE_EXTRA_CA_CERTS from config to process.env: ${configPath}`,
    )
  }
}

function getExtraCertsPathFromConfig(): string | undefined {
  try {
    const globalConfig = getGlobalConfig()
    const globalEnv = globalConfig?.env
    const settings = getSettingsForSource('userSettings')
    const settingsEnv = settings?.env

    logForDebugging(
      `CA certs: Config fallback - globalEnv keys: ${globalEnv ? Object.keys(globalEnv).join(',') : 'none'}, settingsEnv keys: ${settingsEnv ? Object.keys(settingsEnv).join(',') : 'none'}`,
    )

    const path =
      settingsEnv?.NODE_EXTRA_CA_CERTS || globalEnv?.NODE_EXTRA_CA_CERTS
    if (path) {
      logForDebugging(
        `CA certs: Found NODE_EXTRA_CA_CERTS in config/settings: ${path}`,
      )
    }
    return path
  } catch (error) {
    logForDebugging(`CA certs: Config fallback failed: ${error}`, {
      level: 'error',
    })
    return undefined
  }
}
