import type { Tool, ToolPermissionContext } from '@claude-code/tool-registry/runtime'
import type { AppState } from '@claude-code/app-host/state/AppStateCompat.js'

/**
 * V7 §7.2 SDK boundary placeholder types — narrowed inputs that
 * `createHeadlessSessionStore` consumes when initialising store state
 * for headless / -p mode. cli/headless.ts re-exports these names so
 * existing SDK consumers keep working.
 *
 * @public
 */
export type MCPServerConnection = unknown
/** @public */
export type McpCommand = unknown

/**
 * Initial-state inputs for `createHeadlessSessionStore`. Lives in agent
 * because the consumer (`buildHeadlessCompatState`) does — moves agent
 * out of cli's dep graph (V7 §3.2 / §8 coupling rule).
 */
export type HeadlessStoreParams = {
  mcpClients: MCPServerConnection[]
  mcpCommands: McpCommand[]
  mcpTools: Tool[]
  toolPermissionContext: ToolPermissionContext
  effort: string | undefined
  effectiveModel: string | null
  advisorModel?: string
  kairosEnabled?: boolean
}

import { getDefaultAppState } from '@claude-code/app-host/state/AppStateCompat.js'
import { projectHostSessionState, type HostSessionState } from '@claude-code/app-host/state/hostSessionState.js'
import { onChangeAppState } from '@claude-code/repl/onChangeAppState.js'
import { createStore, type Store } from '@claude-code/app-host/state/store.js'
import {
  parseEffortValue,
  toPersistableEffort,
} from './effort.js'
import {
  getFastModeUnavailableReason,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '@claude-code/provider/fastMode.js'
import { getInitialSettings } from '@claude-code/config/settings'
import { feature } from 'bun:bundle'

export type InteractiveSessionStore = Store<AppState>
export type HeadlessSessionStore = Store<AppState>

export function createInteractiveSessionStore(
  initialState?: AppState,
): InteractiveSessionStore {
  return createStore<AppState>(
    initialState ?? getDefaultAppState(),
    onChangeAppState,
  )
}

function buildHeadlessCompatState(
  params: HeadlessStoreParams,
): AppState {
  const defaultState = getDefaultAppState()
  const hostState = projectHostSessionState(defaultState)
  const initialSettings = getInitialSettings()
  const initialEffortValue =
    parseEffortValue(params.effort) ??
    toPersistableEffort(initialSettings.effortLevel)
  const initialFastMode =
    isFastModeEnabled() &&
    getFastModeUnavailableReason() === null &&
    isFastModeSupportedByModel(params.effectiveModel) &&
    !initialSettings.fastModePerSessionOptIn &&
    initialSettings.fastMode === true

  // Cross-package types (MCPServerConnection / McpCommand / Tool /
  // ToolPermissionContext) are SDK boundary placeholders (V7 §7.2) —
  // each is a structural superset of the local AppState slot shape. The
  // construction is structurally sound; the named types are documentation
  // for SDK consumers, not internal type assertions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    ...hostState,
    ...defaultState,
    mcp: {
      ...defaultState.mcp,
      clients: params.mcpClients,
      commands: params.mcpCommands,
      tools: params.mcpTools,
    },
    toolPermissionContext: params.toolPermissionContext,
    effortValue: initialEffortValue,
    ...(isFastModeEnabled() ? { fastMode: initialFastMode } : {}),
    ...(params.advisorModel ? { advisorModel: params.advisorModel } : {}),
    ...(feature('KAIROS') && params.kairosEnabled !== undefined
      ? { kairosEnabled: params.kairosEnabled }
      : {}),
  } as AppState
}

export function createHeadlessSessionStore(
  params: HeadlessStoreParams,
): HeadlessSessionStore {
  return createStore<AppState>(buildHeadlessCompatState(params), onChangeAppState)
}

export function projectInteractiveHostSessionState(
  initialState?: AppState,
): HostSessionState {
  return projectHostSessionState(initialState ?? getDefaultAppState())
}
