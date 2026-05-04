// Tool progress data types — discriminated union over `type` field.
//
// History: these used to all be `unknown` (decompilation placeholders) —
// see V9-2b in docs/refactor/v9-deps-shrinkpath.md. The real shapes were
// always present at the construction sites in each tool's `onProgress({...})`
// call but the type-side was widened to `unknown`, producing TS2339 at
// every consumer that accessed progress.field. V9-2b 2026-05-04 narrows
// the type-side to match the construction-side reality.
//
// Each progress type is the body passed inside `onProgress({ data: T })` —
// it does NOT include the wrapping `{ toolUseID, data }`; that is the
// `ToolCallProgress` envelope from `Tool.ts`.

/**
 * BashTool progress event body.
 * Constructed at packages/tool-registry/src/tools/BashTool/BashTool.tsx:900.
 */
export type BashProgress = {
  type: 'bash_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes: number
  taskId?: string
  timeoutMs?: number
}

/**
 * PowerShellTool progress event body. Same shape as BashProgress modulo the
 * `type` discriminator. Constructed at PowerShellTool.tsx:637-647.
 */
export type PowerShellProgress = {
  type: 'powershell_progress'
  output: string
  fullOutput: string
  elapsedTimeSeconds: number
  totalLines: number
  totalBytes: number
  taskId?: string
  timeoutMs?: number
}

/**
 * ShellProgress is the union both shell tools emit. Used by the REPL's
 * BashModeProgress component (and processBashCommand.tsx) to render a
 * shared progress UI for both bash and powershell shells.
 */
export type ShellProgress = BashProgress | PowerShellProgress

/**
 * MCPTool progress event body. Constructed at
 * mcp-runtime/clientRuntime.ts:2918-2924 (forwards SDK's progress notifications).
 */
export type MCPProgress = {
  type: 'mcp_progress'
  status: 'progress'
  serverName: string
  toolName: string
  /** Optional — undefined when the server omits a progress count. */
  progress?: number
  /** Optional total — undefined when the server doesn't report total. */
  total?: number
  /** Optional human-readable progress message. */
  progressMessage?: string
}

/**
 * Other tool progress types kept as `unknown` placeholders. Each requires
 * either narrowing the inner `message` field (Agent/SkillTool — see V9-2b
 * iter-19 for why this expanded scope: AgentToolProgress.message is a
 * NormalizedMessage union, narrowing it cascades into 30+ message-shape
 * dependencies), or reading from external adapters (WebSearch). Defer.
 */
export type AgentToolProgress = unknown
export type SkillToolProgress = unknown
export type REPLToolProgress = unknown
export type TaskOutputProgress = unknown
export type WebSearchProgress = unknown
export type SdkWorkflowProgress = unknown

/**
 * Top-level union over every tool's progress event body. Currently
 * weakened to `unknown` because the union members are still partly
 * placeholders; tighten when more progress types are narrowed.
 */
export type ToolProgressData = unknown
