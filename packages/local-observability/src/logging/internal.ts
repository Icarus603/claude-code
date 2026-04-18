/**
 * V7 §8.12 — internal: `logPermissionContextForAnts` + k8s/container probes.
 *
 * Moved from src/services/internalLogging.ts. Emits analytics-only events
 * for ant-internal users; no-ops otherwise.
 */

import { readFile } from 'fs/promises'
import memoize from 'lodash-es/memoize.js'

import { logEvent } from '../index.js'
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from '../compat.js'
import { jsonStringify } from '../_deps.js'

/**
 * Get the current Kubernetes namespace:
 * Returns null on laptops/local development,
 * "default" for devboxes in default namespace,
 * "ts" for devboxes in ts namespace,
 * ...
 */
const getKubernetesNamespace = memoize(async (): Promise<string | null> => {
  if (process.env.USER_TYPE !== 'ant') return null
  const namespacePath =
    '/var/run/secrets/kubernetes.io/serviceaccount/namespace'
  try {
    const content = await readFile(namespacePath, { encoding: 'utf8' })
    return content.trim()
  } catch {
    return 'namespace not found'
  }
})

/**
 * Get the OCI container ID from within a running container.
 */
export const getContainerId = memoize(async (): Promise<string | null> => {
  if (process.env.USER_TYPE !== 'ant') return null
  const containerIdPath = '/proc/self/mountinfo'
  try {
    const mountinfo = (
      await readFile(containerIdPath, { encoding: 'utf8' })
    ).trim()

    const containerIdPattern =
      /(?:\/docker\/containers\/|\/sandboxes\/)([0-9a-f]{64})/

    const lines = mountinfo.split('\n')
    for (const line of lines) {
      const match = line.match(containerIdPattern)
      if (match && match[1]) return match[1]
    }
    return 'container ID not found in mountinfo'
  } catch {
    return 'container ID not found'
  }
})

/**
 * Logs an event with the current namespace and tool permission context.
 *
 * Accepts `unknown` for `toolPermissionContext` because the concrete type
 * lives in `@claude-code/permission` and we don't cross upward to it from
 * local-observability. Callers pass whatever permission context they have.
 */
export async function logPermissionContextForAnts(
  toolPermissionContext: unknown,
  moment: 'summary' | 'initialization',
): Promise<void> {
  if (process.env.USER_TYPE !== 'ant') return

  void logEvent('tengu_internal_record_permission_context', {
    moment:
      moment as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    namespace:
      (await getKubernetesNamespace()) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    toolPermissionContext: jsonStringify(
      toolPermissionContext,
    ) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
    containerId:
      (await getContainerId()) as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
  })
}
