/**
 * V7 §8.6 — Hook Zod schemas owned by config (settings schema sub-section).
 * Moved from src/schemas/hooks.ts; source file becomes re-export facade.
 *
 * HOOK_EVENTS and SHELL_TYPES are inlined here (V7 §11.4) because config
 * cannot depend on agent SDK types or shell provider at Wave 1.
 */
import { z } from 'zod/v4'
import { lazySchema } from '../../internal/lazySchema.js'

// Inlined from src/entrypoints/agentSdkTypes.js — canonical list of hook events.
const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'UserPromptSubmit',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
] as const

type HookEvent = (typeof HOOK_EVENTS)[number]

// Inlined from src/utils/shell/shellProvider.ts
const SHELL_TYPES = ['bash', 'powershell'] as const

const IfConditionSchema = lazySchema(() =>
  z
    .string()
    .optional()
    .describe(
      'Permission rule syntax to filter when this hook runs (e.g., "Bash(git *)"). ' +
        'Only runs if the tool call matches the pattern.',
    ),
)

function buildHookSchemas() {
  const BashCommandHookSchema = z.object({
    type: z.literal('command').describe('Shell command hook type'),
    command: z.string().describe('Shell command to execute'),
    if: IfConditionSchema(),
    shell: z.enum(SHELL_TYPES).optional().describe("Shell interpreter. 'bash' uses your $SHELL; 'powershell' uses pwsh. Defaults to bash."),
    timeout: z.number().positive().optional().describe('Timeout in seconds'),
    statusMessage: z.string().optional().describe('Custom spinner status message'),
    once: z.boolean().optional().describe('If true, hook runs once and is removed'),
    async: z.boolean().optional().describe('If true, hook runs in background'),
    asyncRewake: z.boolean().optional().describe('If true, hook runs in background and wakes the model on exit code 2'),
  })

  const PromptHookSchema = z.object({
    type: z.literal('prompt').describe('LLM prompt hook type'),
    prompt: z.string().describe('Prompt to evaluate with LLM. Use $ARGUMENTS placeholder for hook input JSON.'),
    if: IfConditionSchema(),
    timeout: z.number().positive().optional().describe('Timeout in seconds'),
    model: z.string().optional().describe('Model to use (e.g., "claude-sonnet-4-6"). Defaults to small fast model.'),
    statusMessage: z.string().optional().describe('Custom spinner status message'),
    once: z.boolean().optional().describe('If true, hook runs once and is removed'),
  })

  const HttpHookSchema = z.object({
    type: z.literal('http').describe('HTTP hook type'),
    url: z.string().url().describe('URL to POST the hook input JSON to'),
    if: IfConditionSchema(),
    timeout: z.number().positive().optional().describe('Timeout in seconds'),
    headers: z.record(z.string(), z.string()).optional().describe('Additional headers (env var interpolation via $VAR_NAME)'),
    allowedEnvVars: z.array(z.string()).optional().describe('Env vars allowed in header interpolation'),
    statusMessage: z.string().optional().describe('Custom spinner status message'),
    once: z.boolean().optional().describe('If true, hook runs once and is removed'),
  })

  const AgentHookSchema = z.object({
    type: z.literal('agent').describe('Agentic verifier hook type'),
    prompt: z.string().describe('Prompt describing what to verify. Use $ARGUMENTS placeholder.'),
    if: IfConditionSchema(),
    timeout: z.number().positive().optional().describe('Timeout in seconds (default 60)'),
    model: z.string().optional().describe('Model to use (e.g., "claude-sonnet-4-6"). Defaults to Haiku.'),
    statusMessage: z.string().optional().describe('Custom spinner status message'),
    once: z.boolean().optional().describe('If true, hook runs once and is removed'),
  })

  return { BashCommandHookSchema, PromptHookSchema, HttpHookSchema, AgentHookSchema }
}

export const HookCommandSchema = lazySchema(() => {
  const { BashCommandHookSchema, PromptHookSchema, AgentHookSchema, HttpHookSchema } = buildHookSchemas()
  return z.discriminatedUnion('type', [BashCommandHookSchema, PromptHookSchema, AgentHookSchema, HttpHookSchema])
})

export const HookMatcherSchema = lazySchema(() =>
  z.object({
    matcher: z.string().optional().describe('String pattern to match (e.g. tool names like "Write")'),
    hooks: z.array(HookCommandSchema()).describe('List of hooks to execute when the matcher matches'),
  }),
)

export const HooksSchema = lazySchema(() =>
  z.partialRecord(z.enum(HOOK_EVENTS), z.array(HookMatcherSchema())),
)

// Inferred types
export type HookCommand = z.infer<ReturnType<typeof HookCommandSchema>>
export type BashCommandHook = Extract<HookCommand, { type: 'command' }>
export type PromptHook = Extract<HookCommand, { type: 'prompt' }>
export type AgentHook = Extract<HookCommand, { type: 'agent' }>
export type HttpHook = Extract<HookCommand, { type: 'http' }>
export type HookMatcher = z.infer<ReturnType<typeof HookMatcherSchema>>
export type HooksSettings = Partial<Record<HookEvent, HookMatcher[]>>
