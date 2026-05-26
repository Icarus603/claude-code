/**
 * `/workflows` command — port of ant v2.1.150 4938.js (NlK / B4O):
 *   { type:"local-jsx", name:"workflows", aliases:[],
 *     description:"Browse workflow history (running and completed)",
 *     isEnabled:()=>bp(), load:()=> <LlK history-browser> }
 *
 * The dialog (workflows.tsx / WorkflowsDialog) shows real Workflow-engine runs
 * when the engine is enabled, and otherwise falls back to GOAL history (the
 * active goal as the single "running" row plus every completed / failed goal
 * record) — ccb's other autonomous-work primitive.
 *
 * Gate: ant `bp()` is `CLAUDE_CODE_WORKFLOWS` env + `tengu_workflows_enabled`,
 * a RUNTIME gate. ccb mirrors it via `isWorkflowsEnabled()` (default-on,
 * `CLAUDE_CODE_WORKFLOWS=0` kill-switch + the /goal kill-switch). The command
 * is registered unconditionally; this `isEnabled` is the sole visibility gate.
 */
import { isWorkflowsEnabled } from '@claude-code/agent/goalStopHook.js'
import type { Command } from '../../runtime.js'

const workflows: Command = {
  type: 'local-jsx',
  name: 'workflows',
  aliases: [],
  description: 'Browse workflow history (running and completed)',
  isEnabled: () => isWorkflowsEnabled(),
  load: () => import('./workflows.js'),
}

export default workflows
