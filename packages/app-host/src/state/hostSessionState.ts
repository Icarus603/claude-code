import type { AppState } from '@claude-code/app-host/state/AppStateCompat.js'

export type HostSessionState = Omit<
  AppState,
  'toolPermissionContext' | 'mcp' | 'plugins' | 'agentDefinitions'
>

export function projectHostSessionState(
  state: AppState,
): HostSessionState {
  const {
    toolPermissionContext: _toolPermissionContext,
    mcp: _mcp,
    plugins: _plugins,
    agentDefinitions: _agentDefinitions,
    ...hostState
  } = state

  return hostState
}
