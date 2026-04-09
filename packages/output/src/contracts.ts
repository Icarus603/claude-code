export type OutputEvent =
  | { type: 'message'; value: unknown }
  | { type: 'tool_progress'; value: unknown }
  | { type: 'error'; error: unknown }
  | { type: 'permission'; value: unknown }
  | { type: string; [key: string]: unknown }

export type OutputTarget = {
  emit(event: OutputEvent): Promise<void> | void
  flush?(): Promise<void> | void
  close?(): Promise<void> | void
}
