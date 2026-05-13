/**
 * Port of ant v2.1.136 ig6 (1997.js): save API key to macOS Keychain
 * (or fall back to global config on non-darwin).
 *
 * Split out of authAlias.ts so the keychain-write semantics stay
 * encapsulated and don't bloat the auth aggregator. The previous inlined
 * version had three bugs vs ant:
 *
 *   1. NO timeout — `execa('security', ...)` could hang for the default
 *      timeout when the keychain was locked. Ant uses 5000ms.
 *
 *   2. NO exit-code check. `reject: false` meant execa would NOT throw
 *      on non-zero exit — the surrounding try/catch never fired, so a
 *      failed `security` call would silently set `savedToKeychain = true`,
 *      skip the config fallback, and produce "/login successful" with
 *      no usable credentials. P0 for locked keychains in SSH sessions.
 *
 *   3. Soft fallback to config on failure (logged
 *      `tengu_api_key_saved_to_config`). Ant throws with a `claude doctor`
 *      hint so the user has a concrete next step.
 */

import { execa } from 'execa'
import {
  type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  logEvent,
} from '@claude-code/local-observability'
import { saveGlobalConfig } from '@claude-code/config'
import { clearLegacyApiKeyPrefetch } from '@claude-code/storage/secureStorage/keychainPrefetch.js'
import {
  getMacOsKeychainStorageServiceName,
  getUsername,
} from '@claude-code/storage/secureStorage/macOsKeychainHelpers.js'
import {
  maybeRemoveApiKeyFromMacOSKeychainThrows,
  normalizeApiKeyForConfig,
} from '../authPortable.js'
import { logError } from '@claude-code/local-observability/log.js'

function isValidApiKey(apiKey: string): boolean {
  // Only allow alphanumeric characters, dashes, and underscores
  return /^[a-zA-Z0-9-_]+$/.test(apiKey)
}

async function maybeRemoveApiKeyFromMacOSKeychain(): Promise<void> {
  try {
    await maybeRemoveApiKeyFromMacOSKeychainThrows()
  } catch (e) {
    logError(e)
  }
}

export async function saveApiKey(
  apiKey: string,
  options?: {
    /**
     * The memoize cache attached to authAlias.getApiKeyFromConfigOrMacOSKeychain.
     * Passed in to avoid a circular import — clearing it here ensures the next
     * read sees the freshly-stored key.
     */
    onSaved?: () => void
  },
): Promise<void> {
  if (!isValidApiKey(apiKey)) {
    throw new Error(
      'Invalid API key format. API key must contain only alphanumeric characters, dashes, and underscores.',
    )
  }

  // Store as primary API key
  await maybeRemoveApiKeyFromMacOSKeychain()
  let savedToKeychain = false
  if (process.platform === 'darwin') {
    // Port of ant ig6 (1997.js): timeout 5000, throw on non-zero exit with
    // stderr summary + `claude doctor` hint. Pre-fix lacked the exitCode
    // check so /login silently fell back to saved_to_config on locked
    // keychains. -i + -X keeps hex value out of argv (process monitors
    // only see "security -i", not the password). TODO: SecureStorage.
    const service = getMacOsKeychainStorageServiceName()
    const user = getUsername()
    const hex = Buffer.from(apiKey, 'utf-8').toString('hex')
    const cmd = `add-generic-password -U -a "${user}" -s "${service}" -X "${hex}"\n`
    const result = await execa('security', ['-i'], {
      input: cmd,
      reject: false,
      timeout: 5000,
    })
    if (result.exitCode !== 0) {
      const detail = ((result.stderr as string) || (result.stdout as string) || '')
        .trim()
        .replace(/\s*\n\s*/g, '; ')
      logEvent('tengu_api_key_keychain_error', {
        error: detail as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
      })
      throw new Error(
        `Failed to save API key to macOS Keychain${detail ? ` (${detail})` : ''}. ` +
          'Run `claude doctor` to diagnose keychain access.',
      )
    }
    logEvent('tengu_api_key_saved_to_keychain', {})
    savedToKeychain = true
  } else {
    logEvent('tengu_api_key_saved_to_config', {})
  }

  const normalizedKey = normalizeApiKeyForConfig(apiKey)

  // Save config with all updates
  saveGlobalConfig(current => {
    const approved = current.customApiKeyResponses?.approved ?? []
    return {
      ...current,
      // Only save to config if keychain save failed or not on darwin
      primaryApiKey: savedToKeychain ? current.primaryApiKey : apiKey,
      customApiKeyResponses: {
        ...current.customApiKeyResponses,
        approved: approved.includes(normalizedKey)
          ? approved
          : [...approved, normalizedKey],
        rejected: current.customApiKeyResponses?.rejected ?? [],
      },
    }
  })

  // Clear memo cache via callback (avoids circular import to authAlias).
  options?.onSaved?.()
  clearLegacyApiKeyPrefetch()
}
