/**
 * Combines settings validation errors with MCP configuration errors.
 *
 * This module exists to break a circular dependency:
 *   settings.ts → mcp/config.ts → settings.ts
 *
 * V7 §8.6 / §11.1: config (Wave 1 leaf) cannot import from mcp-runtime
 * (Wave 5 integration). The MCP error retrieval is injected via the
 * ConfigHostBindings.getMcpErrorsByScope binding, which the app-host wires
 * to mcp-runtime at composition time.
 */

import { getConfigHostBindings } from '../host.js'
import { getSettingsWithErrors } from './settings.js'
import type { SettingsWithErrors } from './validation.js'

/**
 * Get merged settings with all validation errors, including MCP config errors.
 *
 * Use this instead of getSettingsWithErrors() when you need the full set of
 * errors (settings + MCP). The underlying getSettingsWithErrors() no longer
 * includes MCP errors to avoid the circular dependency.
 */
export function getSettingsWithAllErrors(): SettingsWithErrors {
  const result = getSettingsWithErrors()
  const getMcpErrors = getConfigHostBindings().getMcpErrorsByScope
  if (!getMcpErrors) {
    // Host binding not installed yet (early bootstrap or headless runs
    // that skip MCP). Return settings errors only.
    return result
  }
  // 'dynamic' scope does not have errors returned; it throws and is set on cli startup
  const scopes = ['user', 'project', 'local'] as const
  const mcpErrors = scopes.flatMap(scope => getMcpErrors(scope))
  return {
    settings: result.settings,
    errors: [...result.errors, ...mcpErrors],
  }
}
