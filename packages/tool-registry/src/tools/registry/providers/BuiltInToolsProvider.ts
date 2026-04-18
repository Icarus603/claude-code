import { feature } from 'bun:bundle'
import type { Tool, Tools } from 'src/Tool.js'
import { hasEmbeddedSearchTools } from 'src/utils/embeddedTools.js'
import { isEnvTruthy } from 'src/utils/envUtils.js'
import { isPowerShellToolEnabled } from 'src/utils/shell/shellToolUtils.js'
import { isAgentSwarmsEnabled } from 'src/utils/agentSwarmsEnabled.js'
import { isWorktreeModeEnabled } from 'src/utils/worktreeModeEnabled.js'
import { isTodoV2Enabled } from 'src/utils/tasks.js'
import { isToolSearchEnabledOptimistic } from 'src/utils/toolSearch.js'
import type { ToolProvider } from '../types.js'

// Static imports — always loaded
import { AgentTool } from '@claude-code/tool-registry/tools/AgentTool/AgentTool.js'
import { TaskOutputTool } from '@claude-code/tool-registry/tools/TaskOutputTool/TaskOutputTool.js'
import { BashTool } from '@claude-code/tool-registry/tools/BashTool/BashTool.js'
import { GlobTool } from '@claude-code/tool-registry/tools/GlobTool/GlobTool.js'
import { GrepTool } from '@claude-code/tool-registry/tools/GrepTool/GrepTool.js'
import { ExitPlanModeV2Tool } from '@claude-code/tool-registry/tools/ExitPlanModeTool/ExitPlanModeV2Tool.js'
import { FileReadTool } from '@claude-code/tool-registry/tools/FileReadTool/FileReadTool.js'
import { FileEditTool } from '@claude-code/tool-registry/tools/FileEditTool/FileEditTool.js'
import { FileWriteTool } from '@claude-code/tool-registry/tools/FileWriteTool/FileWriteTool.js'
import { NotebookEditTool } from '@claude-code/tool-registry/tools/NotebookEditTool/NotebookEditTool.js'
import { WebFetchTool } from '@claude-code/tool-registry/tools/WebFetchTool/WebFetchTool.js'
import { TodoWriteTool } from '@claude-code/tool-registry/tools/TodoWriteTool/TodoWriteTool.js'
import { WebSearchTool } from '@claude-code/tool-registry/tools/WebSearchTool/WebSearchTool.js'
import { TaskStopTool } from '@claude-code/tool-registry/tools/TaskStopTool/TaskStopTool.js'
import { AskUserQuestionTool } from '@claude-code/tool-registry/tools/AskUserQuestionTool/AskUserQuestionTool.js'
import { SkillTool } from '@claude-code/tool-registry/tools/SkillTool/SkillTool.js'
import { EnterPlanModeTool } from '@claude-code/tool-registry/tools/EnterPlanModeTool/EnterPlanModeTool.js'
import { SendMessageTool } from '@claude-code/tool-registry/tools/SendMessageTool/SendMessageTool.js'
import { TaskCreateTool } from '@claude-code/tool-registry/tools/TaskCreateTool/TaskCreateTool.js'
import { TaskGetTool } from '@claude-code/tool-registry/tools/TaskGetTool/TaskGetTool.js'
import { TaskUpdateTool } from '@claude-code/tool-registry/tools/TaskUpdateTool/TaskUpdateTool.js'
import { TaskListTool } from '@claude-code/tool-registry/tools/TaskListTool/TaskListTool.js'
import { ListMcpResourcesTool } from '@claude-code/tool-registry/tools/ListMcpResourcesTool/ListMcpResourcesTool.js'
import { ReadMcpResourceTool } from '@claude-code/tool-registry/tools/ReadMcpResourceTool/ReadMcpResourceTool.js'
import { ToolSearchTool } from '@claude-code/tool-registry/tools/ToolSearchTool/ToolSearchTool.js'
import { ConfigTool } from '@claude-code/tool-registry/tools/ConfigTool/ConfigTool.js'
import { TungstenTool } from 'src/tools/TungstenTool/TungstenTool.js'
import { BriefTool } from '@claude-code/tool-registry/tools/BriefTool/BriefTool.js'
import { TestingPermissionTool } from '@claude-code/tool-registry/tools/testing/TestingPermissionTool.js'
import { EnterWorktreeTool } from '@claude-code/tool-registry/tools/EnterWorktreeTool/EnterWorktreeTool.js'
import { ExitWorktreeTool } from '@claude-code/tool-registry/tools/ExitWorktreeTool/ExitWorktreeTool.js'

// Lazy requires — conditional / feature-gated (preserving dead code elimination)
/* eslint-disable @typescript-eslint/no-require-imports */
const getREPLTool = () =>
  process.env.USER_TYPE === 'ant'
    ? require('@claude-code/tool-registry/tools/REPLTool/REPLTool.js').REPLTool as Tool
    : null

const getSuggestBackgroundPRTool = () =>
  process.env.USER_TYPE === 'ant'
    ? require('src/tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.js').SuggestBackgroundPRTool as Tool
    : null

const getSleepTool = () =>
  feature('PROACTIVE') || feature('KAIROS')
    ? require('@claude-code/tool-registry/tools/SleepTool/SleepTool.js').SleepTool as Tool
    : null

const getCronTools = (): Tool[] => [
  require('@claude-code/tool-registry/tools/ScheduleCronTool/CronCreateTool.js').CronCreateTool,
  require('@claude-code/tool-registry/tools/ScheduleCronTool/CronDeleteTool.js').CronDeleteTool,
  require('@claude-code/tool-registry/tools/ScheduleCronTool/CronListTool.js').CronListTool,
]

const getRemoteTriggerTool = () =>
  feature('AGENT_TRIGGERS_REMOTE')
    ? require('@claude-code/tool-registry/tools/RemoteTriggerTool/RemoteTriggerTool.js').RemoteTriggerTool as Tool
    : null

const getMonitorTool = () =>
  feature('MONITOR_TOOL')
    ? require('src/tools/MonitorTool/MonitorTool.js').MonitorTool as Tool
    : null

const getSendUserFileTool = () =>
  feature('KAIROS')
    ? require('src/tools/SendUserFileTool/SendUserFileTool.js').SendUserFileTool as Tool
    : null

const getPushNotificationTool = () =>
  feature('KAIROS') || feature('KAIROS_PUSH_NOTIFICATION')
    ? require('src/tools/PushNotificationTool/PushNotificationTool.js').PushNotificationTool as Tool
    : null

const getSubscribePRTool = () =>
  feature('KAIROS_GITHUB_WEBHOOKS')
    ? require('src/tools/SubscribePRTool/SubscribePRTool.js').SubscribePRTool as Tool
    : null

const getVerifyPlanExecutionTool = () =>
  process.env.CLAUDE_CODE_VERIFY_PLAN === 'true'
    ? require('src/tools/VerifyPlanExecutionTool/VerifyPlanExecutionTool.js').VerifyPlanExecutionTool as Tool
    : null

const getOverflowTestTool = () =>
  feature('OVERFLOW_TEST_TOOL')
    ? require('src/tools/OverflowTestTool/OverflowTestTool.js').OverflowTestTool as Tool
    : null

const getCtxInspectTool = () =>
  feature('CONTEXT_COLLAPSE')
    ? require('src/tools/CtxInspectTool/CtxInspectTool.js').CtxInspectTool as Tool
    : null

const getTerminalCaptureTool = () =>
  feature('TERMINAL_PANEL')
    ? require('src/tools/TerminalCaptureTool/TerminalCaptureTool.js').TerminalCaptureTool as Tool
    : null

const getWebBrowserTool = () =>
  feature('WEB_BROWSER_TOOL')
    ? require('src/tools/WebBrowserTool/WebBrowserTool.js').WebBrowserTool as Tool
    : null

const getSnipTool = () =>
  feature('HISTORY_SNIP')
    ? require('src/tools/SnipTool/SnipTool.js').SnipTool as Tool
    : null

const getListPeersTool = () =>
  feature('UDS_INBOX')
    ? require('src/tools/ListPeersTool/ListPeersTool.js').ListPeersTool as Tool
    : null

const getWorkflowTool = () =>
  feature('WORKFLOW_SCRIPTS')
    ? (() => {
        require('src/tools/WorkflowTool/bundled/index.js').initBundledWorkflows()
        return require('src/tools/WorkflowTool/WorkflowTool.js').WorkflowTool as Tool
      })()
    : null

const getTeamCreateTool = () =>
  require('@claude-code/tool-registry/tools/TeamCreateTool/TeamCreateTool.js').TeamCreateTool as Tool

const getTeamDeleteTool = () =>
  require('@claude-code/tool-registry/tools/TeamDeleteTool/TeamDeleteTool.js').TeamDeleteTool as Tool

const getLSPTool = () =>
  isEnvTruthy(process.env.ENABLE_LSP_TOOL)
    ? require('@claude-code/tool-registry/tools/LSPTool/LSPTool.js').LSPTool as Tool
    : null

const getPowerShellTool = () =>
  isPowerShellToolEnabled()
    ? (require('@claude-code/tool-registry/tools/PowerShellTool/PowerShellTool.js') as typeof import('@claude-code/tool-registry/tools/PowerShellTool/PowerShellTool.js')).PowerShellTool
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
