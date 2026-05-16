export const SEND_USER_FILE_TOOL_NAME = 'SendUserFile'

export const DESCRIPTION = 'Send one or more files to the user'

export const SEND_USER_FILE_TOOL_PROMPT =
  'Send files to the user. Use this when the file *is* the deliverable — a generated diagram, a report, a screenshot, a built artifact — and you want it surfaced, not just mentioned. Paths can be absolute or relative to the current working directory.\n\nAdd a `caption` when a one-liner of context helps ("the failing case is row 42", "before vs after"). Skip it if the file speaks for itself.\n\nSet `status` on every call. Use `proactive` when you\'re initiating — the user is away and you want this to reach their phone (build artifact ready, report generated). Use `normal` when replying to something the user just said.'
