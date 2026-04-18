/**
 * V7 §10.3 facade — `logPermissionContextForAnts` + `getContainerId` now
 * live in `@claude-code/local-observability/logging/internal`.
 *
 * Note: the moved function accepts `unknown` for `toolPermissionContext`
 * because the concrete type lives in `@claude-code/permission` and
 * local-observability doesn't depend upward. This facade retains the
 * `ToolPermissionContext` parameter type for the sole remaining call site
 * to preserve the existing API.
 */

import type { ToolPermissionContext } from 'src/services/Tool.js'
import {
  getContainerId,
  logPermissionContextForAnts as _logPermissionContextForAnts,
} from '@claude-code/local-observability/logging'

export { getContainerId }

export async function logPermissionContextForAnts(
  toolPermissionContext: ToolPermissionContext | null,
  moment: 'summary' | 'initialization',
): Promise<void> {
  return _logPermissionContextForAnts(toolPermissionContext, moment)
}
