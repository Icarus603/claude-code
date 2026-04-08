
export interface AgentConfig {
  sessionId: string

  gates: {
    streamingToolExecution: boolean
    emitToolUseSummaries: boolean
    isAnt: boolean
    fastModeEnabled: boolean
  }
}

export function createAgentConfig(params: {
  sessionId: string
  streamingToolExecution?: boolean
  emitToolUseSummaries?: boolean
  isAnt?: boolean
  fastModeEnabled?: boolean
}): AgentConfig {
  return {
    sessionId: params.sessionId,
    gates: {
      streamingToolExecution: params.streamingToolExecution ?? false,
      emitToolUseSummaries: params.emitToolUseSummaries ?? false,
      isAnt: params.isAnt ?? false,
      fastModeEnabled: params.fastModeEnabled ?? true,
    },
  }
}
