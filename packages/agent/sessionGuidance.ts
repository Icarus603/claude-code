/**
 * Long-form guidance bullets that get injected into the system
 * prompt's "Session-specific guidance" section. Extracted from
 * prompts.ts so each bullet is independently testable and the main
 * file stays scannable.
 *
 * Adding a new bullet: add a builder here, then wire it in
 * prompts.ts:getSessionSpecificGuidanceSection with the appropriate
 * conditional gate.
 */
import {
  AGENT_TOOL_NAME,
  VERIFICATION_AGENT_TYPE,
} from '@claude-code/tool-registry/tools/AgentTool/constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/tool-registry/tools/SendMessageTool/constants.js'
import { TASK_CREATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskCreateTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskUpdateTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@claude-code/tool-registry/tools/TeamDeleteTool/constants.js'

// Adversarial verification contract — see VERIFICATION_AGENT in
// AgentTool/built-in/. Injected when the verification agent is
// enabled (feature gate + GrowthBook).
export function getVerificationAgentGuidance(): string {
  return `The contract: when non-trivial implementation happens on your turn, independent adversarial verification must happen before you report completion \u2014 regardless of who did the implementing (you directly, a fork you spawned, or a subagent). You are the one reporting to the user; you own the gate. Non-trivial means: 3+ file edits, backend/API changes, or infrastructure changes. Spawn the ${AGENT_TOOL_NAME} tool with subagent_type="${VERIFICATION_AGENT_TYPE}". Your own checks, caveats, and a fork's self-checks do NOT substitute \u2014 only the verifier assigns a verdict; you cannot self-assign PARTIAL. Pass the original user request, all files changed (by anyone), the approach, and the plan file path if applicable. Flag concerns if you have them but do NOT share test results or claim things work. On FAIL: fix, resume the verifier with its findings plus your fix, repeat until PASS. On PASS: spot-check it \u2014 re-run 2-3 commands from its report, confirm every PASS has a Command run block with output that matches your re-run. If any PASS lacks a command block or diverges, resume the verifier with the specifics. On PARTIAL (from the verifier): report what passed and what could not be verified.`
}

// Multi-agent swarm 7-step workflow. Gated on TEAM_CREATE_TOOL_NAME
// being enabled to keep the prompt-cache fragment scoped.
export function getSwarmGuidance(): string {
  return `When workers need to read/react to each other mid-task — adversarial debate or competing-hypothesis investigation, multi-angle review where cognitive isolation matters (each reviewer must not anchor on others' findings), or post-plan parallel execution of file-disjoint tasks after the architecture is frozen — a team may help. Otherwise prefer a single ${AGENT_TOOL_NAME} or fan-out (call ${AGENT_TOOL_NAME} multiple times in one message, synthesize when they return) — single-mind execution catches cross-cutting invariants and silent fallbacks that fragmented teammates miss. Teams cost ~2.5-4x the tokens of a single session and review/validation of N teammates' output is itself sequential, so the parallelism has to be real. When the task is borderline, ask the user before spawning. If a team is the right call, follow this exact sequence — do not improvise tool order. (1) If \`${TASK_CREATE_TOOL_NAME}\`/\`${TASK_UPDATE_TOOL_NAME}\` schemas are not yet loaded, call \`ToolSearch\` first with \`query="select:${TASK_CREATE_TOOL_NAME},${TASK_UPDATE_TOOL_NAME}"\` — without this you will misuse them. (2) Call \`${TEAM_CREATE_TOOL_NAME}\` once. (3) Call \`${TASK_CREATE_TOOL_NAME}\` for each task; pass \`blockedBy: [...]\` at create-time to wire the dependency graph in one step (a verifier task with \`blockedBy: [1,2,...,N]\` auto-becomes claimable when all of 1..N complete; cycles are rejected with \`TaskCycleError\`). (4) Spawn teammates by calling the agent tool multiple times **in a single message** (each with \`team_name\` and a unique \`name\`) — this is the only way to get parallel execution; sequential calls in separate messages serialize. (5) Teammates auto-claim unblocked tasks. \`blockedBy\` is the dependency graph's source of truth, not a hint — do not rely on ID order or "prefer earlier" heuristics. (6) When work is done, send each teammate a \`shutdown_request\` via \`${SEND_MESSAGE_TOOL_NAME}\`; on approval the teammate exits. (7) Call \`${TEAM_DELETE_TOOL_NAME}\` last — it refuses if anyone is still active. Mailbox-side dedup (same \`(type, requestId)\` pairs are skipped) and the runner's processed-request ledger together guarantee exactly-once delivery, so retrying a \`shutdown_request\` is safe.`
}
