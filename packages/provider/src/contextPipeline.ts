import type { ContextPipeline } from './types.js'
import { getProviderHostBindings } from './host.js'

export function getProviderContextPipeline(): ContextPipeline {
  return getProviderHostBindings().contextPipeline
}
