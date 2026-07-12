import { executeNotificationHooks } from '@claude-code/agent/hooks.js'

export function fireBackgroundAgentNotification(
  kind: 'agent_needs_input' | 'agent_completed',
  name: string,
  detail?: string,
): void {
  const action =
    kind === 'agent_needs_input' ? 'needs your input' : 'completed its work'
  const suffix = detail?.trim() ? `: ${detail.trim()}` : ''
  void executeNotificationHooks({
    notificationType: kind,
    title: 'Background agent',
    message: `${name || 'Background agent'} ${action}${suffix}`,
  })
}
