/**
 * Per-worker classifier orchestrator — ant 3921.js Wp7/Gp7 + ZB5.
 *
 * For each WorkerVm:
 *   1. Subscribe to ring writes (via WorkerVm.on('write')).
 *   2. Every CLASSIFIER_TICK_MS, read ring tail and run preclassify →
 *      heuristic → llm pipeline.
 *   3. Write state.json + append timeline.jsonl on state change.
 *   4. Emit tengu_bg_classify with full ant payload.
 *
 * Stops orchestration on vm.settle.
 *
 * Gate: CLAUDE_CODE_BG_CLASSIFIER=1 (env var). LLM engine additionally
 * requires CLAUDE_CODE_BG_CLASSIFIER_ENGINE=llm; default is heuristic
 * (no API spend).
 *
 * @dynamicRequire
 */

import { logEvent } from '@claude-code/local-observability'
import type { WorkerVm } from '../workerVm.js'
import { closingShape } from './heuristic.js'
import { classify } from './llmClient.js'
import { isTerminalState, type WorkerState, type WorkerStateFile } from './state.js'
import { appendTimeline, readState, writeState } from './stateFile.js'

const CLASSIFIER_TICK_MS = 5000
const CLASSIFIER_DEBOUNCE_MS = 1500

interface OrchestratorState {
  vm: WorkerVm
  intent?: string
  startedAt: number
  prevState: WorkerState
  prevDetail: string
  prevTempo: 'active' | 'idle' | 'blocked'
  lastClassifyAt: number
  pendingTick: NodeJS.Timeout | null
  intervalTimer: NodeJS.Timeout | null
  stopped: boolean
  /** Cumulative tokens across all LLM calls for this worker. */
  tokens: { input: number; output: number; cacheRead: number; cacheCreation: number }
}

const orchestrators = new Map<string, OrchestratorState>()

export function isClassifierEnabled(): boolean {
  return process.env.CLAUDE_CODE_BG_CLASSIFIER === '1'
}

export function getClassifierEngine(): 'heuristic' | 'llm' {
  return process.env.CLAUDE_CODE_BG_CLASSIFIER_ENGINE === 'llm' ? 'llm' : 'heuristic'
}

/** ant fp7 — record once per process, on first orchestrator start. */
let configEmitted = false
function emitConfigOnce(): void {
  if (configEmitted) return
  configEmitted = true
  logEvent('tengu_bg_classifier_config', {
    useSmallFastModel: 'true',
    disableThinking: 'true',
    engine: getClassifierEngine(),
  })
}

export function startOrchestrator(vm: WorkerVm, intent?: string): void {
  if (!isClassifierEnabled()) return
  const short = vm.short
  if (orchestrators.has(short)) return
  emitConfigOnce()
  const state: OrchestratorState = {
    vm,
    intent,
    startedAt: Date.now(),
    prevState: 'working',
    prevDetail: '',
    prevTempo: 'active',
    lastClassifyAt: 0,
    pendingTick: null,
    intervalTimer: null,
    stopped: false,
    tokens: { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 },
  }
  // Seed prev from existing state file (so daemon restart preserves continuity).
  const existing = readState(short)
  if (existing) {
    state.prevState = existing.state
    state.prevDetail = existing.detail
    state.prevTempo = existing.tempo
    state.tokens = existing.tokens ?? state.tokens
  } else {
    // Initial state file write — captures intent + cwd + cliVersion.
    const now = new Date().toISOString()
    const initial: WorkerStateFile = {
      state: 'working',
      detail: 'starting',
      tempo: 'active',
      createdAt: now,
      updatedAt: now,
      cwd: vm.getRecord().cwd,
      cliVersion: vm.getRecord().cliVersion,
      intent,
      backend: 'daemon',
    }
    writeState(short, initial)
  }
  orchestrators.set(short, state)

  const triggerClassify = (): void => {
    if (state.stopped) return
    if (state.pendingTick) return
    const elapsed = Date.now() - state.lastClassifyAt
    const wait = Math.max(0, CLASSIFIER_DEBOUNCE_MS - elapsed)
    state.pendingTick = setTimeout(() => {
      state.pendingTick = null
      void runClassify(state).catch(() => {})
    }, wait)
    state.pendingTick.unref()
  }

  // Ring write listener (fires on every PTY chunk).
  vm.on('write', triggerClassify)
  // Periodic tick to catch stalls + cron-like classification.
  state.intervalTimer = setInterval(triggerClassify, CLASSIFIER_TICK_MS)
  state.intervalTimer.unref()
  // Settle listener stops orchestrator.
  vm.once('settled', () => stopOrchestrator(short))
}

export function stopOrchestrator(short: string): void {
  const state = orchestrators.get(short)
  if (!state) return
  state.stopped = true
  if (state.pendingTick) clearTimeout(state.pendingTick)
  if (state.intervalTimer) clearInterval(state.intervalTimer)
  orchestrators.delete(short)
  // Final state write — mark firstTerminalAt if state is terminal.
  const cur = readState(short)
  if (cur && !cur.firstTerminalAt && isTerminalState(cur.state)) {
    writeState(short, { ...cur, firstTerminalAt: new Date().toISOString() })
  }
}

async function runClassify(state: OrchestratorState): Promise<void> {
  if (state.stopped) return
  state.lastClassifyAt = Date.now()
  const ringChunks = state.vm.getRingSnapshot()
  const text = Buffer.concat(ringChunks).toString('utf8')
  if (!text.trim()) return

  const cur = readState(state.vm.short)
  const minsInState = cur
    ? Math.round((Date.now() - Date.parse(cur.updatedAt)) / 60_000)
    : 0
  const result = await classify({
    text,
    prevState: state.prevState,
    latestAsk: state.intent,
    toolSummary: undefined,
    minsInState,
    engine: getClassifierEngine(),
  })

  // Accumulate tokens.
  state.tokens.input += result.tokens.input
  state.tokens.output += result.tokens.output
  state.tokens.cacheRead += result.tokens.cacheRead
  state.tokens.cacheCreation += result.tokens.cacheCreation

  const stateChanged = cur === null || cur.state !== result.state
  const now = new Date().toISOString()
  const next: WorkerStateFile = {
    state: result.state,
    detail: result.detail,
    tempo: result.tempo,
    needs: result.needs,
    output: result.output,
    classifySource: result.source,
    firstTerminalAt:
      cur?.firstTerminalAt ??
      (isTerminalState(result.state) ? now : undefined),
    createdAt: cur?.createdAt ?? now,
    updatedAt: now,
    cwd: state.vm.getRecord().cwd,
    cliVersion: state.vm.getRecord().cliVersion,
    intent: state.intent ?? cur?.intent,
    backend: 'daemon',
    sessionId: cur?.sessionId,
    tokens: state.tokens,
  }
  writeState(state.vm.short, next)
  if (stateChanged) {
    appendTimeline(state.vm.short, {
      at: now,
      state: result.state,
      detail: result.detail,
      text: text.slice(-4000),
    })
  }

  logEvent('tengu_bg_classify', {
    short: state.vm.short,
    engine: result.engine,
    branch: result.branch ?? 'none',
    closingShape: closingShape(text),
    prevState: state.prevState,
    newState: result.state,
    stateChanged: String(stateChanged),
    minsInPrevState: String(minsInState),
    durationMs: String(result.durationMs),
    tailChars: String(text.length),
    ...(result.engine === 'llm' && {
      attempts: String(result.attempts),
      inputTokens: String(result.tokens.input),
      outputTokens: String(result.tokens.output),
      cacheReadInputTokens: String(result.tokens.cacheRead),
      cacheCreationInputTokens: String(result.tokens.cacheCreation),
    }),
  })

  // Emit agent_terminal once when entering terminal state.
  if (
    isTerminalState(result.state) &&
    !cur?.firstTerminalAt
  ) {
    logEvent('tengu_bg_agent_terminal', {
      short: state.vm.short,
      outcome: result.state,
      durationMs: String(Date.now() - state.startedAt),
      classifySource: result.source,
    })
  }

  state.prevState = result.state
  state.prevDetail = result.detail
  state.prevTempo = result.tempo
}

/** Test/inspection helper. */
export function _orchestratorCount(): number {
  return orchestrators.size
}
