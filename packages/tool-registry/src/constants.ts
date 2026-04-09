export const ALL_AGENT_DISALLOWED_TOOLS = new Set([
  'TaskOutput',
  'ExitPlanMode',
  'EnterPlanMode',
  'Task',
  'AskUserQuestion',
  'TaskStop',
])

export const CUSTOM_AGENT_DISALLOWED_TOOLS = new Set([
  ...ALL_AGENT_DISALLOWED_TOOLS,
])

export const ASYNC_AGENT_ALLOWED_TOOLS = new Set([
  'Read',
  'WebSearch',
  'TodoWrite',
  'Grep',
  'WebFetch',
  'Glob',
  'Bash',
  'PowerShell',
  'Edit',
  'Write',
  'NotebookEdit',
  'Skill',
  'SyntheticOutput',
  'ToolSearch',
  'EnterWorktree',
  'ExitWorktree',
])

export const COORDINATOR_MODE_ALLOWED_TOOLS = new Set([
  'Task',
  'TaskStop',
  'SendMessage',
  'SyntheticOutput',
])
