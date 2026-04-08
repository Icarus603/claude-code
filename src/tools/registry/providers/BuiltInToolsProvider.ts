import { feature } from 'bun:bundle'
import type { Tool, Tools } from '../../../Tool.js'
import { hasEmbeddedSearchTools } from '../../../utils/embeddedTools.js'
import { isEnvTruthy } from '../../../utils/envUtils.js'
import { isPowerShellToolEnabled } from '../../../utils/shell/shellToolUtils.js'
import { isAgentSwarmsEnabled } from '../../../utils/agentSwarmsEnabled.js'
import { isWorktreeModeEnabled } from '../../../utils/worktreeModeEnabled.js'
import { isTodoV2Enabled } from '../../../utils/tasks.js'
import { isToolSearchEnabledOptimistic } from '../../../utils/toolSearch.js'
import type { ToolProvider } from '../types.js'

// Static imports — always loaded
import { AgentTool } from '../../AgentTool/AgentTool.js'
import { TaskOutputTool } from '../../TaskOutputTool/TaskOutputTool.js'
import { BashTool } from '../../BashTool/BashTool.js'
import { GlobTool } from '../../GlobTool/GlobTool.js'
import { GrepTool } from '../../GrepTool/GrepTool.js'
import { ExitPlanModeV2Tool } from '../../ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { FileReadTool } from '../../FileReadTool/FileReadTool.js'
import { FileEditTool } from '../../FileEditTool/FileEditTool.js'
import { FileWriteTool } from '../../FileWriteTool/FileWriteTool.js'
import { NotebookEditTool } from '../../NotebookEditTool/NotebookEditTool.js'
import { WebFetchTool } from '../../WebFetchTool/WebFetchTool.js'
import { TodoWriteTool } from '../../TodoWriteTool/TodoWriteTool.js'
import { WebSearchTool } from '../../WebSearchTool/WebSearchTool.js'
import { TaskStopTool } from '../../TaskStopTool/TaskStopTool.js'
import { AskUserQuestionTool } from '../../AskUserQuestionTool/AskUserQuestionTool.js'
import { SkillTool } from '../../SkillTool/SkillTool.js'
import { EnterPlanModeTool } from '../../EnterPlanModeTool/EnterPlanModeTool.js'
import { SendMessageTool } from '../../SendMessageTool/SendMessageTool.js'
import { TaskCreateTool } from '../../TaskCreateTool/TaskCreateTool.js'
import { TaskGetTool } from '../../TaskGetTool/TaskGetTool.js'
import { TaskUpdateTool } from '../../TaskUpdateTool/TaskUpdateTool.js'
import { TaskListTool } from '../../TaskListTool/TaskListTool.js'
import { ListMcpResourcesTool } from '../../ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from '../../ReadMcpResourceTool/ReadMcpResourceTool.js'
import { ToolSearchTool } from '../../ToolSearchTool/ToolSearchTool.js'
import { ConfigTool } from '../../ConfigTool/ConfigTool.js'
import { TungstenTool } from '../../TungstenTool/TungstenTool.js'
import { BriefTool } from '../../BriefTool/BriefTool.js'
import { TestingPermissionTool } from '../../testing/TestingPermissionTool.js'
import { EnterWorktreeTool } from '../../EnterWorktreeTool/EnterWorktreeTool.js'
import { ExitWorktreeTool } from '../../ExitWorktreeTool/ExitWorktreeTool.js'

// Lazy requires — conditional / feature-gated (preserving dead code elimination)
/* eslint-disable @typescript-eslint/no-require-imports */
const getREPLTool = () =>
  process.env.USER_TYPE === 'ant'
    ? require('../../REPLTool/REPLTool.js').REPLTool as Tool
    : null

const getSuggestBackgroundPRTool = () =>
  process.env.USER_TYPE === 'ant'
    ? require('../../SuggestBackgroundPRTool/SuggestBackgroundPRTool.js').SuggestBackgroundPRTool as Tool
    : null

const getSleepTool = () =>
  feature('PROACTIVE') || feature('KAIROS')
    ? require('../../SleepTool/SleepTool.js').SleepTool as Tool
    : null

const getCronTools = (): Tool[] => [
  require('../../ScheduleCronTool/CronCreateTool.js').CronCreateTool,
  require('../../ScheduleCronTool/CronDeleteTool.js').CronDeleteTool,
  require('../../ScheduleCronTool/CronListTool.js').CronListTool,
]

const getRemoteTriggerTool = () =>
  feature('AGENT_TRIGGERS_REMOTE')
    ? require('../../RemoteTriggerTool/RemoteTriggerTool.js').RemoteTriggerTool as Tool
    : null

const getMonitorTool = () =>
  feature('MONITOR_TOOL')
    ? require('../../MonitorTool/MonitorTool.js').MonitorTool as Tool
    : null

const getSendUserFileTool = () =>
  feature('KAIROS')
    ? require('../../SendUserFileTool/SendUserFileTool.js').SendUserFileTool as Tool
    : null

const getPushNotificationTool = () =>
  feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION')
    ? require('../../PushNotificationTool/PushNotificationTool.js').PushNotificationTool as Tool
    : null

const getSubscribePRTool = () =>
  feature('KAIROS_GITHUB_WEBHOOKS')
    ? require('../../SubscribePRTool/SubscribePRTool.js').SubscribePRTool as Tool
    : null

const getVerifyPlanExecutionTool = () =>
  process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'
    ? require('../../VerifyPlanExecutionTool/VerifyPlanExecutionTool.js').VerifyPlanExecutionTool as Tool
    : null

const getOverflowTestTool = () =>
  feature('OVERFLOW_TEST_TOOL')
    ? require('../../OverflowTestTool/OverflowTestTool.js').OverflowTestTool as Tool
    : null

const getCtxInspectTool = () =>
  feature('CONTEXT_COLLAPSE')
    ? require('../../CtxInspectTool/CtxInspectTool.js').CtxInspectTool as Tool
    : null

const getTerminalCaptureTool = () =>
  feature('TERMINAL_PANEL')
    ? require('../../TerminalCaptureTool/TerminalCaptureTool.js').TerminalCaptureTool as Tool
    : null

const getWebBrowserTool = () =>
  feature('WEB_BROWSER_TOOL')
    ? require('../../WebBrowserTool/WebBrowserTool.js').WebBrowserTool as Tool
    : null

const getSnipTool = () =>
  feature('HISTORY_SNIP')
    ? require('../../SnipTool/SnipTool.js').SnipTool as Tool
    : null

const getListPeersTool = () =>
  feature('UDS_INBOX')
    ? require('../../ListPeersTool/ListPeersTool.js').ListPeersTool as Tool
    : null

const getWorkflowTool = () =>
  feature('WORKFLOW_SCRIPTS')
    ? (() => {
        require('../../WorkflowTool/bundled/index.js').initBundledWorkflows()
        return require('../../WorkflowTool/WorkflowTool.js').WorkflowTool as Tool
      })()
    : null

const getTeamCreateTool = () =>
  require('../../TeamCreateTool/TeamCreateTool.js').TeamCreateTool as Tool

const getTeamDeleteTool = () =>
  require('../../TeamDeleteTool/TeamDeleteTool.js').TeamDeleteTool as Tool

const getLSPTool = () =>
  isEnvTruthy(process.env.ENABLE_LSP_TOOL)
    ? require('../../LSPTool/LSPTool.js').LSPTool as Tool
    : null

const getPowerShellTool = () =>
  isPowerShellToolEnabled()
    ? (require('../../PowerShellTool/PowerShellTool.js') as typeof import('../../PowerShellTool/PowerShellTool.js')).PowerShellTool
    : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Provider for built-in tools. Replicates the exact logic from `getAllBaseTools()`
 * in `tools.ts`, preserving all feature flag / environment variable gating.
 */
export const BuiltInToolsProvider: ToolProvider = {
  name: 'builtin',
  discover(): Tools {
    const tools: Tool[] = []

    // Always-on tools
    tools.push(AgentTool)
    tools.push(TaskOutputTool)
    tools.push(BashTool)

    // Glob/Grep: hidden when embedded search tools are available
    if (!hasEmbeddedSearchTools()) {
      tools.push(GlobTool, GrepTool)
    }

    tools.push(ExitPlanModeV2Tool)
    tools.push(FileReadTool)
    tools.push(FileEditTool)
    tools.push(FileWriteTool)
    tools.push(NotebookEditTool)
    tools.push(WebFetchTool)
    tools.push(TodoWriteTool)
    tools.push(WebSearchTool)
    tools.push(TaskStopTool)
    tools.push(AskUserQuestionTool)
    tools.push(SkillTool)
    tools.push(EnterPlanModeTool)

    // Ant-only tools
    if (process.env.USER_TYPE === 'ant') {
      tools.push(ConfigTool)
      tools.push(TungstenTool)
    }

    // Conditional tools (feature-gated via require)
    const suggestPR = getSuggestBackgroundPRTool()
    if (suggestPR) tools.push(suggestPR)

    const webBrowser = getWebBrowserTool()
    if (webBrowser) tools.push(webBrowser)

    // Todo v2
    if (isTodoV2Enabled()) {
      tools.push(TaskCreateTool, TaskGetTool, TaskUpdateTool, TaskListTool)
    }

    // Feature-gated tools
    const overflow = getOverflowTestTool()
    if (overflow) tools.push(overflow)

    const ctxInspect = getCtxInspectTool()
    if (ctxInspect) tools.push(ctxInspect)

    const terminalCapture = getTerminalCaptureTool()
    if (terminalCapture) tools.push(terminalCapture)

    // LSP tool
    const lsp = getLSPTool()
    if (lsp) tools.push(lsp)

    // Worktree tools
    if (isWorktreeModeEnabled()) {
      tools.push(EnterWorktreeTool, ExitWorktreeTool)
    }

    // SendMessage (lazy require to break circular dep)
    tools.push(SendMessageTool)

    // UDS Inbox
    const listPeers = getListPeersTool()
    if (listPeers) tools.push(listPeers)

    // Agent swarms / teams
    if (isAgentSwarmsEnabled()) {
      tools.push(getTeamCreateTool(), getTeamDeleteTool())
    }

    // Verify plan
    const verifyPlan = getVerifyPlanExecutionTool()
    if (verifyPlan) tools.push(verifyPlan)

    // REPL (ant-only)
    if (process.env.USER_TYPE === 'ant') {
      const repl = getREPLTool()
      if (repl) tools.push(repl)
    }

    // Workflow
    const workflow = getWorkflowTool()
    if (workflow) tools.push(workflow)

    // Sleep
    const sleep = getSleepTool()
    if (sleep) tools.push(sleep)

    // Cron tools (always loaded)
    tools.push(...getCronTools())

    // Remote trigger
    const remoteTrigger = getRemoteTriggerTool()
    if (remoteTrigger) tools.push(remoteTrigger)

    // Monitor
    const monitor = getMonitorTool()
    if (monitor) tools.push(monitor)

    tools.push(BriefTool)

    // KAIROS tools
    const sendUserFile = getSendUserFileTool()
    if (sendUserFile) tools.push(sendUserFile)

    const pushNotification = getPushNotificationTool()
    if (pushNotification) tools.push(pushNotification)

    const subscribePR = getSubscribePRTool()
    if (subscribePR) tools.push(subscribePR)

    // PowerShell
    const powerShell = getPowerShellTool()
    if (powerShell) tools.push(powerShell)

    // History snip
    const snip = getSnipTool()
    if (snip) tools.push(snip)

    // Testing permission tool (test env only)
    if (process.env.NODE_ENV === 'test') {
      tools.push(TestingPermissionTool)
    }

    // MCP resource tools (always present)
    tools.push(ListMcpResourcesTool)
    tools.push(ReadMcpResourceTool)

    // Tool search (optimistic)
    if (isToolSearchEnabledOptimistic()) {
      tools.push(ToolSearchTool)
    }

    return tools
  },
}
