import axios from 'axios'
import { getOauthConfig } from '@claude-code/provider/oauthConstants'
import { getOrganizationUUID } from '@claude-code/provider/oauth/client.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import {
  checkAndRefreshOAuthTokenIfNeeded,
  getClaudeAIOAuthTokens,
  isClaudeAISubscriber,
} from '@claude-code/provider/authAlias.js'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import { detectCurrentRepository } from '@claude-code/storage/detectRepository.js'
import { errorMessage } from '@claude-code/local-observability/errorHelpers.js'
import { findGitRoot, getIsClean } from '@claude-code/storage/git.js'
import { getOAuthHeaders } from '@claude-code/teleport/api.js'
import { fetchEnvironments } from '@claude-code/teleport/environments.js'

/**
 * Checks if user needs to log in with Claude.ai
 */
export async function checkNeedsClaudeAiLogin(): Promise<boolean> {
  if (!isClaudeAISubscriber()) {
    return false
  }
  return checkAndRefreshOAuthTokenIfNeeded()
}

/**
 * Checks if git working directory is clean (no uncommitted changes)
 * Ignores untracked files since they won't be lost during branch switching.
 */
export async function checkIsGitClean(): Promise<boolean> {
  const isClean = await getIsClean({ ignoreUntracked: true })
  return isClean
}

/**
 * Checks if user has access to at least one remote environment
 */
export async function checkHasRemoteEnvironment(): Promise<boolean> {
  try {
    const environments = await fetchEnvironments()
    return environments.length > 0
  } catch (error) {
    logForDebugging(`checkHasRemoteEnvironment failed: ${errorMessage(error)}`)
    return false
  }
}

/**
 * Checks if current directory is inside a git repository (has .git/).
 * Distinct from checkHasGitRemote — a local-only repo passes this but not that.
 */
export function checkIsInGitRepo(): boolean {
  return findGitRoot(getCwd()) !== null
}

/**
 * Checks if current repository has a GitHub remote configured.
 * Returns false for local-only repos (git init with no `origin`).
 */
export async function checkHasGitRemote(): Promise<boolean> {
  const repository = await detectCurrentRepository()
  return repository !== null
}

/**
 * Checks if GitHub app is installed on a specific repository
 */
export async function checkGithubAppInstalled(
  owner: string,
  repo: string,
  signal?: AbortSignal,
): Promise<boolean> {
  try {
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      logForDebugging(
        'checkGithubAppInstalled: No access token found, assuming app not installed',
      )
      return false
    }

    const orgUUID = await getOrganizationUUID()
    if (!orgUUID) {
      logForDebugging(
        'checkGithubAppInstalled: No org UUID found, assuming app not installed',
      )
      return false
    }

    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/code/repos/${owner}/${repo}`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }

    logForDebugging(`Checking GitHub app installation for ${owner}/${repo}`)

    const response = await axios.get<{
      repo: {
        name: string
        owner: { login: string }
        default_branch: string
      }
      status: {
        app_installed: boolean
        relay_enabled: boolean
      } | null
    }>(url, {
      headers,
      timeout: 15000,
      signal,
    })

    if (response.status === 200) {
      if (response.data.status) {
        const installed = response.data.status.app_installed
        logForDebugging(
          `GitHub app ${installed ? 'is' : 'is not'} installed on ${owner}/${repo}`,
        )
        return installed
      }
      logForDebugging(
        `GitHub app is not installed on ${owner}/${repo} (status is null)`,
      )
      return false
    }

    logForDebugging(
      `checkGithubAppInstalled: Unexpected response status ${response.status}`,
    )
    return false
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (status && status >= 400 && status < 500) {
        logForDebugging(
          `checkGithubAppInstalled: Got ${status} error, app likely not installed on ${owner}/${repo}`,
        )
        return false
      }
    }

    logForDebugging(`checkGithubAppInstalled error: ${errorMessage(error)}`)
    return false
  }
}

/**
 * Checks if the user has synced their GitHub credentials via /web-setup
 */
export async function checkGithubTokenSynced(): Promise<boolean> {
  try {
    const accessToken = getClaudeAIOAuthTokens()?.accessToken
    if (!accessToken) {
      logForDebugging('checkGithubTokenSynced: No access token found')
      return false
    }

    const orgUUID = await getOrganizationUUID()
    if (!orgUUID) {
      logForDebugging('checkGithubTokenSynced: No org UUID found')
      return false
    }

    const url = `${getOauthConfig().BASE_API_URL}/api/oauth/organizations/${orgUUID}/sync/github/auth`
    const headers = {
      ...getOAuthHeaders(accessToken),
      'x-organization-uuid': orgUUID,
    }

    logForDebugging('Checking if GitHub token is synced via web-setup')

    const response = await axios.get(url, {
      headers,
      timeout: 15000,
    })

    const synced =
      response.status === 200 && response.data?.is_authenticated === true
    logForDebugging(
      `GitHub token synced: ${synced} (status=${response.status}, data=${JSON.stringify(response.data)})`,
    )
    return synced
  } catch (error) {
    if (axios.isAxiosError(error)) {
      const status = error.response?.status
      if (status && status >= 400 && status < 500) {
        logForDebugging(
          `checkGithubTokenSynced: Got ${status}, token not synced`,
        )
        return false
      }
    }

    logForDebugging(`checkGithubTokenSynced error: ${errorMessage(error)}`)
    return false
  }
}

type RepoAccessMethod = 'github-app' | 'token-sync' | 'none'

/**
 * Tiered check for whether a GitHub repo is accessible for remote operations.
 * 1. GitHub App installed on the repo
 * 2. GitHub token synced via /web-setup
 * 3. Neither — caller should prompt user to set up access
 */
export async function checkRepoForRemoteAccess(
  owner: string,
  repo: string,
): Promise<{ hasAccess: boolean; method: RepoAccessMethod }> {
  if (await checkGithubAppInstalled(owner, repo)) {
    return { hasAccess: true, method: 'github-app' }
  }
  if (
    getFeatureValue_CACHED_MAY_BE_STALE('tengu_cobalt_lantern', false) &&
    (await checkGithubTokenSynced())
  ) {
    return { hasAccess: true, method: 'token-sync' }
  }
  return { hasAccess: false, method: 'none' }
}
