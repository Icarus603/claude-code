/**
 * `/workflows` command — port of ant v2.1.150 4938.js (NlK / B4O):
 *   { type:"local-jsx", name:"workflows", aliases:[],
 *     description:"Browse workflow history (running and completed)",
 *     isEnabled:()=>bp(), load:()=> <LlK history-browser> }
 *
 * ccb has no working Workflow-script subsystem (WorkflowTool /
 * LocalWorkflowTask / createWorkflowCommand are stubs gated behind the
 * opt-in WORKFLOW_SCRIPTS flag, and there is no workflow snapshot store).
 * The genuinely-working autonomous-work primitive in ccb is `/goal` — a
 * session-scoped Stop hook that keeps the agent working until a condition is
 * met. Goal "runs" live as `goal_status` attachments in the transcript.
 *
 * So `/workflows` browses GOAL history: the active goal as the single
 * "running" row plus every completed / failed goal record from the message
 * log — the faithful ccb analogue of ant's local_workflow task list.
 *
 * Gate: ant `bp()` is `CLAUDE_CODE_WORKFLOWS` env + `tengu_workflows_enabled`.
 * ccb rides a single opt-in gate shared with the `ultrawork` keyword — the
 * ULTRAWORK feature flag — folded with the /goal kill-switch via
 * `isWorkflowsCommandEnabled()`.
 */
import { isWorkflowsCommandEnabled } from '@claude-code/agent/goalStopHook.js'
import type { Command } from '../../runtime.js'

// The ULTRAWORK feature gate is applied at the registration site
// (commandRegistryRuntime.ts only requires this module when the flag is on),
// so `feature()` is not — and cannot be — called here (bun:bundle restricts
// feature() to if/ternary positions). `isEnabled` only carries the runtime
// kill-switch half of ant's bp() (CLAUDE_CODE_DISABLE_GOAL).
const workflows: Command = {
  type: 'local-jsx',
  name: 'workflows',
  aliases: [],
  description: 'Browse workflow history (running and completed)',
  isEnabled: () => isWorkflowsCommandEnabled(),
  load: () => import('./workflows.js'),
}

export default workflows
