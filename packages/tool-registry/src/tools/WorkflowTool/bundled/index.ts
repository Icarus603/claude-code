// Built-in workflow registry shim. ant 2.1.150 ships ZERO built-in workflows
// (3888 jHK is [] and sZ is never called); the real registry is the user/
// project `.claude/workflows/` loader in agent/workflow/namedWorkflows.ts
// (ant 3889/3890). This module is the idempotent init hook BuiltInToolsProvider
// calls before exposing the tool, plus a thin getter kept for back-compat.

import {
  listAllNamedWorkflows,
  registerBuiltinWorkflow,
} from '@claude-code/agent/workflow/namedWorkflows.js'

let initialized = false

export function initBundledWorkflows(): void {
  if (initialized) return
  initialized = true
  // ant ships none. Register built-ins here via registerBuiltinWorkflow(meta,
  // script) if any are ever bundled — they merge into the named-workflow
  // registry consumed by resolveScript()/workflow().
  void registerBuiltinWorkflow
}

/** Back-compat: the merged registry (builtin + user/project), names+scripts. */
export async function getBundledWorkflows(): Promise<
  Array<{ name: string; script: string }>
> {
  return (await listAllNamedWorkflows()).map(w => ({
    name: w.name,
    script: w.script,
  }))
}
