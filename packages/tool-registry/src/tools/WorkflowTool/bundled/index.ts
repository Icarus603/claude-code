// Built-in workflow registry. Port target: ant 2.1.150 bundled workflows
// (4109-4118: autopilot, etc.) + the .claude/workflows/ loader (3889 _c).
//
// Phase status: scaffold. The Workflow tool engine (sandbox/hooks/journal) is
// live; the named-workflow REGISTRY (built-in scripts + user/project dir
// discovery) is wired in a follow-up. initBundledWorkflows() is the idempotent
// init hook BuiltInToolsProvider calls before exposing the tool.

let initialized = false

export function initBundledWorkflows(): void {
  if (initialized) return
  initialized = true
  // No built-in workflows registered yet. When added, they register into the
  // named-workflow resolver consumed by resolveScript()/workflow().
}

export function getBundledWorkflows(): Array<{ name: string; script: string }> {
  return []
}
