import { enableConfigs } from '@claude-code/config'
import { installConfigHostBindings } from '../packages/config/host.js'

async function main(): Promise<void> {
  // Install minimal host bindings so enableConfigs() doesn't throw.
  installConfigHostBindings({})
  enableConfigs()

  const { getDefaultAppState } = await import('@claude-code/app-host/state/AppStateStore.js')
  const { selectMcp } = await import('@claude-code/app-host/state/mcpSelectors.js')
  const { selectToolPermissionContext } = await import(
    '@claude-code/app-host/state/permissionSelectors.js'
  )
  const { selectPlugins } = await import('@claude-code/app-host/state/pluginSelectors.js')
  const { selectInitialMessage } = await import(
    '@claude-code/app-host/state/sessionSelectors.js'
  )
  const { selectTasks } = await import('@claude-code/app-host/state/taskSelectors.js')
  const { selectTeamContext } = await import('@claude-code/app-host/state/teamSelectors.js')
  const { selectShowExpandedTodos } = await import('@claude-code/app-host/state/uiSelectors.js')

  const state = getDefaultAppState()

  const mcp = selectMcp(state)
  const toolPermissionContext = selectToolPermissionContext(state)
  const plugins = selectPlugins(state)
  const tasks = selectTasks(state)
  void selectTeamContext(state)

  // Optional selectors should still be callable.
  void selectInitialMessage(state)
  void selectShowExpandedTodos(state)

  if (
    !mcp ||
    !toolPermissionContext ||
    !plugins ||
    !tasks
  ) {
    throw new Error('AppState domain selector returned an invalid result')
  }

  console.log('appstate domain api verification passed')
}

await main()
