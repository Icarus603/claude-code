/**
 * Job-name generator — ant 3991.js Vq3.
 *
 * After the LLM classifier produces its first 'llm'-source result for a
 * worker whose state.json has no `name` yet, this module fires Claude
 * (small-fast model, Haiku) asking for a 2-4 word lowercase label and
 * writes it back to the same state.json with `nameSource: "auto"`.
 *
 * The result is the auto-generated session label users see in FleetView
 * (e.g. raw prompt "who am i" → auto label "ccb repo maintainer"). The
 * `useLabelReplaceAnim` hook in packages/repl/src/screens/agentFleet/
 * components/FleetJobRow.tsx animates the swap.
 *
 * Source verbatim from ant 3991.js:
 *
 *   var Lq3 = 3
 *   var kq3 = /^(unspecified|untitled|unnamed)\b|^(unknown|no) (request|task|job|input)\b/
 *
 *   async function Vq3(jobDir, userMsg, agentTail) {
 *     let allJobs = await H7H().catch(() => [])
 *     let taken = new Set(
 *       allJobs.filter(z => !lR(z.state.state) && z.state.name).map(z => z.state.name)
 *     )
 *     let candidate = ""
 *     for (let z = 0; z < Lq3; z++) {
 *       let avoidBlock = taken.size > 0 ? `\n\nAvoid these (already taken): ${[...taken].join(", ")}` : ""
 *       let model = $a7()                          // useSmallFastModel ? haiku : main
 *       let [think, budget] = za7(model)           // disableThinking ? [false,0] : [undefined,default]
 *       let resp = await Fg({
 *         querySource: "agent_namer",
 *         model, thinking: think,
 *         max_tokens: 32 + budget,
 *         maxRetries: 1,
 *         skipSystemPromptPrefix: true,
 *         messages: [{role: "user", content:
 *           `2-4 word lowercase label for this job.\n` +
 *           `User: "${userMsg.slice(0,300)}"${agentTail ? `\nAgent: "${agentTail.slice(0,300)}"` : ""}\n\n` +
 *           `Include the MOST SPECIFIC identifier (component/file/feature). Skip generic\n` +
 *           `verbs like fix/add/update. Respond with ONLY the label.${avoidBlock}`
 *         }]
 *       }).catch(() => null)
 *       let text = resp?.content.find(m => m.type === "text")
 *       if (text?.type !== "text") { logFailure("side_query_failed"); return }
 *       candidate = text.text.trim().toLowerCase().slice(0, 40)
 *       if (!candidate || kq3.test(candidate)) { logFailure("degenerate_label"); return }
 *       if (!taken.has(candidate)) break
 *       taken.add(candidate)
 *     }
 *     if (taken.has(candidate)) { logFailure("all_names_taken"); return }
 *     let cur = await readJobState(jobDir)
 *     if (!cur) { logFailure("state_gone_after_gen"); return }
 *     if (cur.name) { logSuccess(); return }       // raced — someone else set it
 *     await writeJobState(jobDir, { ...cur, name: candidate, nameSource: "auto", updatedAt: now })
 *     logSuccess()
 *   }
 *
 * @dynamicRequire
 */

import { APIUserAbortError } from '@anthropic-ai/sdk'
import { logEvent } from '@claude-code/local-observability'
import { listFleetJobs } from './listFleetJobs.js'
import {
  getJobDir,
  invalidateCache,
  readJobState,
  writeJobState,
} from './fleetStore.js'

/** ant Lq3 — max retries when the model picks an already-taken name. */
const MAX_ATTEMPTS = 3

/**
 * ant kq3 — degenerate label sentinel. Drops the auto-name if the model
 * answers with "unspecified", "untitled", "unnamed", "unknown task" etc.
 */
const DEGENERATE_LABEL_RE =
  /^(unspecified|untitled|unnamed)\b|^(unknown|no) (request|task|job|input)\b/

/** ant n7 — truncate to N chars. Match by length, not graphemes (ant). */
function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n)
}

/**
 * Returns true if the given worker is in a terminal classifier state
 * (done/failed/stopped). Source: ant `lR` — those states' rows are
 * excluded from the "taken names" set so completed jobs don't blockade
 * new label choices.
 */
function isTerminalState(state: string): boolean {
  return state === 'done' || state === 'failed' || state === 'stopped'
}

/** Tracks in-flight name generation per worker so we don't fire twice. */
const inflight = new Set<string>()

/** Already-attempted shorts — fire-once per worker lifetime, mirroring ant
 *  `H.nameInFlight` latch (it's set on first dispatch and never cleared
 *  in the same worker process). Prevents re-runs on every tick. */
const attempted = new Set<string>()

export interface GenerateNameArgs {
  short: string
  /** User's original prompt (state.intent). */
  userMsg: string
  /** Recent agent text (tail of the ring buffer). May be empty. */
  agentTail: string
}

/**
 * Fire name generation for one worker. No-op if a generation is already
 * in flight or has been attempted for this short. Best-effort: failures
 * surface as telemetry events but never throw.
 */
export async function generateJobName(args: GenerateNameArgs): Promise<void> {
  const { short, userMsg, agentTail } = args
  if (inflight.has(short)) return
  if (attempted.has(short)) return
  inflight.add(short)
  attempted.add(short)
  try {
    await runNamer(short, userMsg, agentTail)
  } finally {
    inflight.delete(short)
  }
}

function logFailure(short: string, reason: string): void {
  logEvent('tengu_bg_job_name', {
    short,
    outcome: 'failed',
    reason,
  })
}

function logSuccess(short: string, name: string): void {
  logEvent('tengu_bg_job_name', {
    short,
    outcome: 'set',
    nameLen: String(name.length),
  })
}

async function buildTakenNames(): Promise<Set<string>> {
  try {
    const jobs = await listFleetJobs()
    const taken = new Set<string>()
    for (const j of jobs) {
      if (isTerminalState(j.state.state)) continue
      if (j.state.name) taken.add(j.state.name)
    }
    return taken
  } catch {
    return new Set()
  }
}

function buildPrompt(
  userMsg: string,
  agentTail: string,
  taken: Set<string>,
): string {
  const userPart = `User: "${truncate(userMsg, 300)}"`
  const agentPart = agentTail
    ? `\nAgent: "${truncate(agentTail, 300)}"`
    : ''
  const avoid =
    taken.size > 0 ? `\n\nAvoid these (already taken): ${[...taken].join(', ')}` : ''
  return (
    `2-4 word lowercase label for this job.\n` +
    `${userPart}${agentPart}\n\n` +
    `Include the MOST SPECIFIC identifier (component/file/feature). Skip generic\n` +
    `verbs like fix/add/update. Respond with ONLY the label.${avoid}`
  )
}

async function callModel(prompt: string): Promise<string | null> {
  try {
    const provider = await import('@claude-code/provider/claude.js')
    const model = await import('@claude-code/provider/model.js')
    const provSp = await import('@claude-code/provider/systemPromptType.js')
    const tool = await import('@claude-code/tool-registry/Tool.js')
    const messages = await import('../../messages.js')
    const userMsg = messages.createUserMessage({ content: prompt })
    const response = await provider.queryModelWithoutStreaming({
      messages: [userMsg],
      systemPrompt: provSp.asSystemPrompt([]),
      thinkingConfig: { type: 'disabled' },
      tools: [],
      signal: new AbortController().signal,
      options: {
        getToolPermissionContext: async () => tool.getEmptyToolPermissionContext(),
        model: model.getSmallFastModel(),
        toolChoice: undefined,
        isNonInteractiveSession: true,
        hasAppendSystemPrompt: false,
        agents: [],
        querySource: 'agent_namer',
        mcpTools: [],
        skipCacheWrite: true,
      },
    })
    if (response.isApiErrorMessage) return null
    return messages.getAssistantMessageText(response).trim() || null
  } catch (e) {
    if (e instanceof APIUserAbortError) return null
    return null
  }
}

async function runNamer(
  short: string,
  userMsg: string,
  agentTail: string,
): Promise<void> {
  // Loop ant Lq3 times — re-prompt with extra "avoid" entries if the
  // chosen label collides with an already-taken active worker name.
  let taken = await buildTakenNames()
  let candidate = ''
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const text = await callModel(buildPrompt(userMsg, agentTail, taken))
    if (text === null) {
      logFailure(short, 'side_query_failed')
      return
    }
    candidate = truncate(text.trim().toLowerCase(), 40)
    if (!candidate || DEGENERATE_LABEL_RE.test(candidate)) {
      logFailure(short, 'degenerate_label')
      return
    }
    if (!taken.has(candidate)) break
    taken.add(candidate)
  }
  if (taken.has(candidate)) {
    // Every retry collided — ant aborts here.
    logFailure(short, 'all_names_taken')
    return
  }

  // Re-read state.json to (a) confirm worker still exists, (b) avoid
  // overwriting a name written between our call and now.
  const jobDir = getJobDir(short)
  invalidateCache(jobDir)
  const cur = await readJobState(jobDir)
  if (cur === null) {
    logFailure(short, 'state_gone_after_gen')
    return
  }
  if (cur.name !== undefined && cur.name !== '') {
    // Raced — another writer (manual rename, classifier with stale data)
    // already set a name. Don't clobber.
    logSuccess(short, cur.name)
    return
  }
  await writeJobState(jobDir, {
    ...cur,
    name: candidate,
    nameSource: 'auto',
    updatedAt: new Date().toISOString(),
  })
  logSuccess(short, candidate)
}
