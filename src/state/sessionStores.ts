import type { HeadlessStoreParams } from '@claude-code/cli'
import type { AppState } from './AppStateCompat.js'
import { getDefaultAppState } from './AppStateCompat.js'
import { projectHostSessionState, type HostSessionState } from './hostSessionState.js'
import { onChangeAppState } from './onChangeAppState.js'
import { createStore, type Store } from './store.js'
import {
  parseEffortValue,
  toPersistableEffort,
} from '../utils/effort.js'
import {
  getFastModeUnavailableReason,
  isFastModeEnabled,
  isFastModeSupportedByModel,
} from '../utils/fastMode.js'
import { getInitialSettings } from '../utils/settings/settings.js'
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
