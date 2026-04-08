export function getViewedLocalAgentTask<T>(tasks: Record<string, T>, viewingAgentTaskId: string | undefined) {
  return viewingAgentTaskId ? tasks[viewingAgentTaskId] : undefined;
}
