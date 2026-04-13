import { getAgentHostBindings } from '../host.js'
import type { AgentMessage } from '../internalTypes.js'

export function registerStructuredOutputEnforcement(
  setAppState: (f: (prev: unknown) => unknown) => void,
  sessionId: string,
): void {
  getAgentHostBindings().registerStructuredOutputEnforcement?.(
    setAppState,
    sessionId,
  )
}

export function getMainLoopModel(): string {
  return getAgentHostBindings().getMainLoopModel?.() ?? ''
}

export function parseUserSpecifiedModel(model: string): string {
  return getAgentHostBindings().parseUserSpecifiedModel?.(model) ?? model
}

export async function loadAllPluginsCacheOnly(): Promise<{
  enabled: unknown[]
  [key: string]: unknown
}> {
  return (
    (await getAgentHostBindings().loadAllPluginsCacheOnly?.()) ?? {
      enabled: [],
    }
  )
}

export async function processUserInput(params: unknown): Promise<{
  messages: AgentMessage[]
  shouldQuery: boolean
  allowedTools: unknown
  model?: string
  resultText?: string
  [key: string]: unknown
}> {
  const result = await getAgentHostBindings().processUserInput?.(params)
  return (
    result ?? {
      messages: [],
      shouldQuery: false,
      allowedTools: undefined,
    }
  )
}

export async function fetchSystemPromptParts(params: unknown): Promise<{
  defaultSystemPrompt: string[]
  userContext: Record<string, string>
  systemContext: Record<string, string>
}> {
  return (
    (await getAgentHostBindings().fetchSystemPromptParts?.(params)) ?? {
      defaultSystemPrompt: [],
      userContext: {},
      systemContext: {},
    }
  )
}

export function shouldEnableThinkingByDefault(): boolean | undefined {
  return getAgentHostBindings().shouldEnableThinkingByDefault?.()
}

export function buildSystemInitMessage(params: unknown): unknown {
  return getAgentHostBindings().buildSystemInitMessage?.(params)
}

export function sdkCompatToolName(toolName: string): string {
  return getAgentHostBindings().sdkCompatToolName?.(toolName) ?? toolName
}

export async function* handleOrphanedPermission(
  orphanedPermission: unknown,
  tools: unknown[],
  messages: AgentMessage[],
  context: unknown,
): AsyncGenerator<unknown> {
  const handler = getAgentHostBindings().handleOrphanedPermission
  if (!handler) {
    return
  }
  yield* handler(orphanedPermission, tools, messages, context)
}

export function isResultSuccessful(
  result: AgentMessage | undefined,
  lastStopReason: string | null,
): boolean {
  return (
    getAgentHostBindings().isResultSuccessful?.(result, lastStopReason) ?? false
  )
}

export async function* normalizeMessage(
  message: AgentMessage,
): AsyncGenerator<unknown> {
  const normalizer = getAgentHostBindings().normalizeMessage
  if (!normalizer) {
    return
  }
  yield* normalizer(message)
}

export function selectableUserMessagesFilter(message: AgentMessage): boolean {
  return getAgentHostBindings().selectableUserMessagesFilter?.(message) ?? true
}

export function getCoordinatorUserContext(
  mcpClients: ReadonlyArray<{ name: string }>,
  scratchpadDir?: string,
): Record<string, string> {
  return (
    getAgentHostBindings().getCoordinatorUserContext?.(
      mcpClients,
      scratchpadDir,
    ) ?? {}
  )
}

export function isSnipBoundaryMessage(message: AgentMessage): boolean {
  return getAgentHostBindings().isSnipBoundaryMessage?.(message) ?? false
}

export function snipCompactIfNeeded(
  messages: AgentMessage[],
  options?: { force?: boolean },
): { messages: AgentMessage[]; executed: boolean } | undefined {
  return getAgentHostBindings().snipCompactIfNeeded?.(messages, options)
}
