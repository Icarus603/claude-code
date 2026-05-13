/**
 * Port of ant v2.1.136 wT_ (2643.js) — `skill_activated` OTel event helper.
 * Extracted from SkillTool.ts so the call site is a one-liner.
 */

import {
  logSkillActivatedEvent,
  toolDetailsLoggingEnabled,
} from '@claude-code/local-observability/telemetry'

export function emitSkillActivated(args: {
  commandName: string
  isBuiltIn: boolean
  isBundled: boolean
  isOfficialMarketplace: boolean
  queryDepth: number
  source?: string
  kind?: string
  pluginName?: string
  marketplaceName?: string
}): void {
  // ant vF9: official iff source is 'official'/'default-bundle'; bC adds
  // marketplace whitelist; P$ = OTEL_LOG_TOOL_DETAILS escape hatch.
  const isOfficial =
    args.isBuiltIn ||
    args.isBundled ||
    args.isOfficialMarketplace ||
    toolDetailsLoggingEnabled()
  void logSkillActivatedEvent({
    skillName: args.commandName,
    invocationTrigger: args.queryDepth > 0 ? 'nested-skill' : 'claude-proactive',
    skillSource: args.source,
    skillKind: args.kind,
    isOfficial,
    pluginName: args.pluginName,
    marketplaceName: args.marketplaceName,
  })
}
