/**
 * LLM-based classifier — ant 3921.js kp7().
 *
 * Calls Haiku (small fast model) with a system prompt that asks it to
 * classify the worker's tail output into {state, detail, tempo, needs?,
 * output?}. 2-attempt retry. Falls back to heuristic on apiError.
 *
 * Reuses ccb's existing queryModelWithoutStreaming → respects user's
 * existing OAuth/api-key/Bedrock/Vertex config without daemon-specific
 * auth duplication.
 *
 * @dynamicRequire
 */

import { APIUserAbortError } from '@anthropic-ai/sdk'
import {
  type ClassifierResult,
  type WorkerState,
  LLM_TAIL_CHARS,
  truncate,
} from './state.js'
import {
  closingShape,
  fallbackHeuristic,
  mergeWithPrev,
  parseLlmJson,
  preClassify,
} from './heuristic.js'
import { CLASSIFIER_SYSTEM_PROMPT } from './systemPrompt.js'

interface LlmClassifyArgs {
  /** Full worker output text (typically the ring buffer joined). */
  text: string
  /** Previous classifier state (sticky guidance for the LLM). */
  prevState: WorkerState
  /** Latest user prompt verbatim (for "what was asked"). */
  latestAsk?: string
  /** Compact summary of recent tool calls (e.g. "Read×3, Bash×2"). */
  toolSummary?: string
  /** Minutes spent in prevState. */
  minsInState: number
  /** Force engine: 'preclassify' uses only em7; 'heuristic' uses J08; 'llm' calls Haiku. */
  engine: 'preclassify' | 'heuristic' | 'llm'
  signal?: AbortSignal
}

export interface LlmClassifyOutcome extends ClassifierResult {
  /** Engine actually used (may differ from requested if early-exit). */
  engine: 'preclassify' | 'heuristic' | 'llm' | 'apiError'
  attempts: number
  durationMs: number
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
}

function buildUserPrompt(
  text: string,
  prev: WorkerState,
  latestAsk: string | undefined,
  toolSummary: string | undefined,
  minsInState: number,
): string {
  const tail = text.slice(-LLM_TAIL_CHARS)
  const askBlock = latestAsk ? `\nUser's most recent ask: "${latestAsk}"` : ''
  return `Current state: ${prev} (for ${minsInState}m)\nTool calls so far: ${toolSummary || 'none'}${askBlock}\n\nAssistant message tail (last ${tail.length} chars):\n${tail}`
}

/**
 * Run the full pipeline: preclassify → heuristic fallback → LLM if engine='llm'.
 *
 * The orchestrator usually requests engine='llm' which still tries
 * preclassify first as a fast-path; engine='heuristic' skips LLM entirely
 * (used when GB gate is off or LLM unavailable).
 */
export async function classify(args: LlmClassifyArgs): Promise<LlmClassifyOutcome> {
  const start = Date.now()
  const tokens = { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
  const pre = preClassify(args.text)

  if (pre) {
    return {
      ...pre,
      engine: 'preclassify',
      attempts: 0,
      durationMs: Date.now() - start,
      tokens,
    }
  }

  if (args.engine === 'heuristic') {
    const fb = fallbackHeuristic(args.text)
    return { ...fb, engine: 'heuristic', attempts: 0, durationMs: Date.now() - start, tokens }
  }

  // LLM path
  let attempts = 0
  let parsed: Record<string, unknown> | null = null
  try {
    const provider = await import('@claude-code/provider/claude.js')
    const model = await import('@claude-code/provider/model.js')
    const provSp = await import('@claude-code/provider/systemPromptType.js')
    const tool = await import('@claude-code/tool-registry/Tool.js')
    const messages = await import('@claude-code/agent/messages.js')
    const userPrompt = buildUserPrompt(args.text, args.prevState, args.latestAsk, args.toolSummary, args.minsInState)
    const userMsg = messages.createUserMessage({ content: userPrompt })
    for (let i = 0; i < 2 && !parsed; i++) {
      attempts++
      const response = await provider.queryModelWithoutStreaming({
        messages: [userMsg],
        systemPrompt: provSp.asSystemPrompt([CLASSIFIER_SYSTEM_PROMPT]),
        thinkingConfig: { type: 'disabled' },
        tools: [],
        signal: args.signal ?? new AbortController().signal,
        options: {
          getToolPermissionContext: async () => tool.getEmptyToolPermissionContext(),
          model: model.getSmallFastModel(),
          toolChoice: undefined,
          isNonInteractiveSession: true,
          hasAppendSystemPrompt: false,
          agents: [],
          querySource: 'bg_classifier',
          mcpTools: [],
          skipCacheWrite: true,
        },
      })
      if (response.isApiErrorMessage) continue
      // Sum usage if present.
      const usage = (response as unknown as { message?: { usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number } } }).message?.usage
      if (usage) {
        tokens.input += usage.input_tokens ?? 0
        tokens.output += usage.output_tokens ?? 0
        tokens.cacheRead += usage.cache_read_input_tokens ?? 0
        tokens.cacheCreation += usage.cache_creation_input_tokens ?? 0
      }
      const text = messages.getAssistantMessageText(response).trim()
      if (!text) continue
      parsed = parseLlmJson(text)
    }
  } catch (e) {
    if (e instanceof APIUserAbortError) {
      const fb = fallbackHeuristic(args.text)
      return { ...fb, engine: 'apiError', branch: 'aborted', attempts, durationMs: Date.now() - start, tokens }
    }
    const fb = fallbackHeuristic(args.text)
    return { ...fb, engine: 'apiError', branch: `error: ${(e as Error).message?.slice(0, 80) ?? 'unknown'}`, attempts, durationMs: Date.now() - start, tokens }
  }
  if (!parsed) {
    const fb = fallbackHeuristic(args.text)
    return { ...fb, engine: 'apiError', branch: 'no-parse', attempts, durationMs: Date.now() - start, tokens }
  }
  const merged = mergeWithPrev(parsed, args.prevState, null)
  return {
    state: merged.state,
    detail: truncate(merged.detail),
    tempo: merged.tempo,
    needs: merged.needs ? truncate(merged.needs) : undefined,
    output: merged.output,
    source: 'llm',
    branch: 'llm-ok',
    engine: 'llm',
    attempts,
    durationMs: Date.now() - start,
    tokens,
  }
}

/** Re-export so orchestrator can use closing shape in metadata. */
export { closingShape }
