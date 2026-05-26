export function getViewedLocalAgentTask<T>(tasks: Record<string, T>, viewingAgentTaskId: string | undefined) {
  return viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
}

/**
 * Whether a backgrounded panel agent (local_agent, non-main-session) is still
 * running. ant's spinner gate `RD` (5359.js) counts in_process_teammates only;
 * ccb's auto mode lets the main loop idle while bg subagents run, so the spinner
 * gate widens to panel agents — "something working ⇒ spinner spins". Kept out of
 * REPLView.tsx (V7 §3.3 thin-host LOC ratchet); REPLView wraps this in a useMemo.
 */
export function hasRunningPanelAgentTask(
  tasks: Record<string, { type?: string; status?: string; agentType?: string }>,
): boolean {
  return Object.values(tasks).some(
    t =>
      t.type === 'local_agent' &&
      t.agentType !== 'main-session' &&
      t.status === 'running',
  );
}
