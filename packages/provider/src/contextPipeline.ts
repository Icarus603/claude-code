import {
  getSystemContext,
  getUserContext,
} from '../../../src/context.js'
import type { ContextPipeline } from './types.js'

const contextPipeline: ContextPipeline = {
  getUserContext,
  getSystemContext,
}

export function getProviderContextPipeline(): ContextPipeline {
  return contextPipeline
}
