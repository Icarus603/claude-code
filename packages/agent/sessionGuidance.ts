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
import { AGENT_TOOL_NAME } from '@claude-code/tool-registry/tools/AgentTool/constants.js'
import { SEND_MESSAGE_TOOL_NAME } from '@claude-code/tool-registry/tools/SendMessageTool/constants.js'
import { TASK_CREATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskCreateTool/constants.js'
import { TASK_UPDATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TaskUpdateTool/constants.js'
import { TEAM_CREATE_TOOL_NAME } from '@claude-code/tool-registry/tools/TeamCreateTool/constants.js'
import { TEAM_DELETE_TOOL_NAME } from '@claude-code/tool-registry/tools/TeamDeleteTool/constants.js'

// Multi-agent swarm bootstrap. Gated on TEAM_CREATE_TOOL_NAME being
// enabled. Required because TeamCreate / TaskCreate / SendMessage /
// TeamDelete are deferred tools — their descriptions are invisible
// until ToolSearch loads them. Without this turn-1 hint the model
// has no way to know the swarm machinery exists, so it can't trigger
// ToolSearch to find it. This is the only place the workflow gets
// surfaced before deferred-tool fetch.
export function getSwarmGuidance(): string {
  return `For multi-agent work that needs a shared team scope (TeamCreate-managed teammates with task graph + mailbox), follow this exact sequence — do not improvise tool order. (1) If \`${TASK_CREATE_TOOL_NAME}\`/\`${TASK_UPDATE_TOOL_NAME}\` schemas are not yet loaded, call \`ToolSearch\` first with \`query="select:${TASK_CREATE_TOOL_NAME},${TASK_UPDATE_TOOL_NAME}"\` — without this you will misuse them. (2) Call \`${TEAM_CREATE_TOOL_NAME}\` once. (3) Call \`${TASK_CREATE_TOOL_NAME}\` for each task; pass \`blockedBy: [...]\` at create-time to wire the dependency graph in one step (a verifier task with \`blockedBy: [1,2,...,N]\` auto-becomes claimable when all of 1..N complete; cycles are rejected with \`TaskCycleError\`). (4) Spawn teammates by calling the agent tool multiple times **in a single message** (each with \`team_name\` and a unique \`name\`) — this is the only way to get parallel execution; sequential calls in separate messages serialize. (5) Teammates auto-claim unblocked tasks. \`blockedBy\` is the dependency graph's source of truth, not a hint — do not rely on ID order or "prefer earlier" heuristics. (6) When work is done, send each teammate a \`shutdown_request\` via \`${SEND_MESSAGE_TOOL_NAME}\`; on approval the teammate exits. (7) Call \`${TEAM_DELETE_TOOL_NAME}\` last — it refuses if anyone is still active. Mailbox-side dedup (same \`(type, requestId)\` pairs are skipped) and the runner's processed-request ledger together guarantee exactly-once delivery, so retrying a \`shutdown_request\` is safe. For simple parallel work that doesn't need a shared team, prefer fan-out: call ${AGENT_TOOL_NAME} multiple times in one message and synthesize on return.`
}

