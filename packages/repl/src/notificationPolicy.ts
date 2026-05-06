// Single decision point for "should this OS-level banner fire?". Every
// banner path eventually hits sendNotification (notifier.ts) which calls
// shouldFireBanner before doing any work. Adding a new notification path
// means adding a NotificationType here and putting it in the right set.
//
// Diverges from upstream ant 2.1.131: ant's agentPushNotifEnabled and
// inputNeededNotifEnabled also encode server-side mobile-push topic
// subscriptions PATCHed to /api/claude_code/notification/preferences
// (decoded 4096.js). ccb has no mobile-push transport (replBridgeTransport
// confirms) and ccb does not port the notif_prefs PATCH path; on ccb
// these toggles are pure local-banner mute switches, nothing more.

import { getGlobalConfig } from '@claude-code/config'

export const NOTIFICATION_TYPES = [
  'push_notification', // PushNotificationTool — LLM-initiated
  'idle_prompt', // REPLView idle watcher — "Claude is waiting"
  'permission_prompt', // PermissionRequest 6 s timeout banner
  'elicitation_dialog', // MCP elicitation form
  'elicitation_url_dialog', // MCP elicitation URL variant
  'worker_permission_prompt', // teammate worker / sandbox permission
  'auth_success', // OAuth login success — never gated by category
] as const

export type NotificationType = (typeof NOTIFICATION_TYPES)[number]

const ACTION_REQUIRED: ReadonlySet<string> = new Set<NotificationType>([
  'idle_prompt',
  'permission_prompt',
  'elicitation_dialog',
  'elicitation_url_dialog',
  'worker_permission_prompt',
])

const CLAUDE_DECISION: ReadonlySet<string> = new Set<NotificationType>([
  'push_notification',
])

export function shouldFireBanner(type: string): boolean {
  const cfg = getGlobalConfig()
  if (cfg.preferredNotifChannel === 'notifications_disabled') return false
  if (CLAUDE_DECISION.has(type)) return cfg.agentPushNotifEnabled === true
  if (ACTION_REQUIRED.has(type)) return cfg.inputNeededNotifEnabled === true
  // 'always' bucket — auth_success, plus any unknown type passed by future
  // callsites. Channel kill-switch above still applies.
  return true
}
