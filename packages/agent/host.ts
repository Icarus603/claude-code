import type { AgentHostBindings } from './contracts.js'

let agentHostBindings: AgentHostBindings | null = null

export function installAgentHostBindings(bindings: AgentHostBindings): void {
  agentHostBindings = bindings
}

export function getAgentHostBindings(): AgentHostBindings {
  if (!agentHostBindings) {
    throw new Error(
      'Agent host bindings have not been installed. Install host bindings before using @claude-code/agent runtime APIs.',
    )
  }
  return agentHostBindings
}

