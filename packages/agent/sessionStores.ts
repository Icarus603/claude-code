import type { HeadlessStoreParams } from '@claude-code/cli'
import type { AppState } from '@claude-code/app-host/state/AppStateCompat.js'
import { getDefaultAppState } from '@claude-code/app-host/state/AppStateCompat.js'
import { projectHostSessionState, type HostSessionState } from '@claude-code/app-host/state/hostSessionState.js'
import { onChangeAppState } from '@claude-code/repl/onChangeAppState.js'
import { createStore, type Store } from '@claude-code/app-host/state/store.js'
import {
  parseEffortValue,
  toPersistableEffort,
} from '@claude-code/agent/effort.js'
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
  }
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
