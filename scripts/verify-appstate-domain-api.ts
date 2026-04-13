import { enableConfigs } from '@claude-code/config'
import { installConfigHostBindings } from '../packages/config/host.js'

async function main(): Promise<void> {
  // Install minimal host bindings so enableConfigs() doesn't throw.
  installConfigHostBindings({})
  enableConfigs()

  const { getDefaultAppState } = await import('../src/state/AppStateStore.js')
  const { selectMcp } = await import('../src/state/mcpSelectors.js')
  const { selectToolPermissionContext } = await import(
    '../src/state/permissionSelectors.js'
  )
  const { selectPlugins } = await import('../src/state/pluginSelectors.js')
  const { selectInitialMessage } = await import(
    '../src/state/sessionSelectors.js'
  )
  const { selectTasks } = await import('../src/state/taskSelectors.js')
  const { selectTeamContext } = await import('../src/state/teamSelectors.js')
  const { selectShowExpandedTodos } = await import('../src/state/uiSelectors.js')

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
