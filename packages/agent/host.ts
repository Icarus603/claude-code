import type { AgentHostBindings } from './contracts.js'
import { HostBindingsError } from './errors.js'

let agentHostBindings: AgentHostBindings | null = null

export function installAgentHostBindings(bindings: AgentHostBindings): void {
  agentHostBindings = bindings
}

export function getAgentHostBindings(): AgentHostBindings {
  if (!agentHostBindings) {
    throw new HostBindingsError(
      'Agent host bindings have not been installed. Install host bindings before using @claude-code/agent runtime APIs.',
    )
  }
  return agentHostBindings
}
