export function applyCliOptionEnvironment(
  options: Record<string, unknown>,
): void {
  if (options.bare === true) process.env.CLAUDE_CODE_SIMPLE = '1'
  if (options.excludeDynamicSystemPromptSections === true) {
    process.env.CLAUDE_CODE_EXCLUDE_DYNAMIC_SYSTEM_PROMPT_SECTIONS = '1'
  }
  const prefix = options.remoteControlSessionNamePrefix
  if (typeof prefix === 'string' && prefix.trim()) {
    process.env.CLAUDE_CODE_REMOTE_CONTROL_SESSION_NAME_PREFIX = prefix.trim()
  }
}
