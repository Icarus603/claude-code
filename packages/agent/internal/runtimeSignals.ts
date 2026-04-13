import { getAgentHostBindings } from '../host.js'

export function headlessProfilerCheckpoint(name: string): void {
  getAgentHostBindings().headlessProfilerCheckpoint?.(name)
}

export function queryCheckpoint(name: string): void {
  getAgentHostBindings().queryCheckpoint?.(name)
}

export function notifyCommandLifecycle(
  uuid: string,
  state: 'started' | 'completed',
): void {
  getAgentHostBindings().notifyCommandLifecycle?.(uuid, state)
}
