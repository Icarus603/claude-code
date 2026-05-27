export function getViewedLocalAgentTask<T>(tasks: Record<string, T>, viewingAgentTaskId: string | undefined) {
  return viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
}

// Removed hasRunningPanelAgentTask: it widened the main-spinner gate to bg
// panel/local_agent subagents, which made the leader's spinner keep animating
// while the leader was idle and a subagent did the work. ant's spinner gate
// (5359.js:923 `RD`) counts ONLY in-process teammates, not panel subagents —
// a leader-idle main agent shows a quiet prompt, and the subagent's progress
// surfaces in the footer task pill + its tool-use block. See REPLView showSpinner.
