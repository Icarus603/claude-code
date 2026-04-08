
export type Terminal = {
  type: 'terminal'
  reason: 'end_turn' | 'max_turns' | 'interrupted' | 'error' | 'stop_hook' | 'budget'
}

export type Continue = {
  type: 'continue'
  toolResults?: Array<{
    toolUseId: string
    result: unknown
  }>
}

export type Transition = Terminal | Continue
