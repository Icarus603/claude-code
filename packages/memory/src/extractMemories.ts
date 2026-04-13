/**
 * Extracts durable memories from the current session transcript
 * and writes them to the auto-memory directory (~/.claude/projects/<path>/memory/).
 *
 * It runs once at the end of each complete query loop (when the model produces
 * a final response with no tool calls) via handleStopHooks in stopHooks.ts.
 *
 * Uses the forked agent pattern (runForkedAgent) — a perfect fork of the main
 * conversation that shares the parent's prompt cache.
 *
 * State is closure-scoped inside initExtractMemories() rather than module-level,
 * following the same pattern as confidenceRating.ts. Tests call
 * initExtractMemories() in beforeEach to get a fresh closure.
 */

import { feature } from 'bun:bundle'
import { basename } from 'path'
import { ENTRYPOINT_NAME } from './memdir.js'
import {
  getAutoMemPath,
  isAutoMemoryEnabled,
  isAutoMemPath,
} from './paths.js'
import { getMemoryHostBindings } from './host.js'
import { count, uniq } from './internalUtils.js'
import { getFeatureValue_CACHED_MAY_BE_STALE } from '@claude-code/config/feature-flags'
import type {
  MemREPLContext,
  MemMessage,
  MemAssistantMessage,
  MemTool,
  MemToolPermissionResult,
  MemCanUseTool,
  MemSystemMessage,
} from './internalTypes.js'

/* eslint-disable @typescript-eslint/no-require-imports */
const teamMemPaths = feature('TEAMMEM')
  ? (require('./teamMemPaths.js') as typeof import('./teamMemPaths.js'))
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

// Tool name constants — inlined to avoid importing from app-compat
const BASH_TOOL_NAME = 'Bash'
const FILE_EDIT_TOOL_NAME = 'Edit'
const FILE_READ_TOOL_NAME = 'Read'
const FILE_WRITE_TOOL_NAME = 'Write'
const GLOB_TOOL_NAME = 'Glob'
const GREP_TOOL_NAME = 'Grep'
const REPL_TOOL_NAME = 'REPL'

// ============================================================================
// Helpers
// ============================================================================

/**
 * Returns true if a message is visible to the model (sent in API calls).
 * Excludes progress, system, and attachment messages.
 */
function isModelVisibleMessage(message: MemMessage): boolean {
  return message.type === 'user' || message.type === 'assistant'
}

function countModelVisibleMessagesSince(
  messages: MemMessage[],
  sinceUuid: string | undefined,
): number {
  if (sinceUuid === null || sinceUuid === undefined) {
    return count(messages, isModelVisibleMessage)
  }

  let foundStart = false
  let n = 0
  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }
    if (isModelVisibleMessage(message)) {
      n++
    }
  }
  // If sinceUuid was not found (e.g., removed by context compaction),
  // fall back to counting all model-visible messages rather than returning 0
  // which would permanently disable extraction for the rest of the session.
  if (!foundStart) {
    return count(messages, isModelVisibleMessage)
  }
  return n
}

/**
 * Returns true if any assistant message after the cursor UUID contains a
 * Write/Edit tool_use block targeting an auto-memory path.
 */
function hasMemoryWritesSince(
  messages: MemMessage[],
  sinceUuid: string | undefined,
): boolean {
  let foundStart = sinceUuid === undefined
  for (const message of messages) {
    if (!foundStart) {
      if (message.uuid === sinceUuid) {
        foundStart = true
      }
      continue
    }
    if (message.type !== 'assistant') {
      continue
    }
    const content = (message as MemAssistantMessage).message.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      const filePath = getWrittenFilePath(block)
      if (filePath !== undefined && isAutoMemPath(filePath)) {
        return true
      }
    }
  }
  return false
}

// ============================================================================
// Tool Permissions
// ============================================================================

function denyAutoMemTool(tool: MemTool, reason: string): MemToolPermissionResult {
  const bindings = getMemoryHostBindings()
  bindings.logDebug?.(`[autoMem] denied ${tool.name}: ${reason}`)
  bindings.logEvent?.('tengu_auto_mem_tool_denied', {
    tool_name: bindings.sanitizeToolNameForAnalytics?.(tool.name) ?? tool.name,
  })
  return {
    behavior: 'deny' as const,
    message: reason,
    decisionReason: { type: 'other' as const, reason },
  }
}

/**
 * Creates a canUseTool function that allows Read/Grep/Glob (unrestricted),
 * read-only Bash commands, and Edit/Write only for paths within the
 * auto-memory directory. Shared by extractMemories and autoDream.
 */
export function createAutoMemCanUseTool(memoryDir: string): MemCanUseTool {
  return async (tool: MemTool, input: Record<string, unknown>) => {
    // Allow REPL
    if (tool.name === REPL_TOOL_NAME) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Allow Read/Grep/Glob unrestricted — all inherently read-only
    if (
      tool.name === FILE_READ_TOOL_NAME ||
      tool.name === GREP_TOOL_NAME ||
      tool.name === GLOB_TOOL_NAME
    ) {
      return { behavior: 'allow' as const, updatedInput: input }
    }

    // Allow Bash only for commands that pass BashTool.isReadOnly.
    if (tool.name === BASH_TOOL_NAME) {
      const parsed = tool.inputSchema.safeParse(input)
      if (parsed.success && tool.isReadOnly?.(parsed.data)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
      return denyAutoMemTool(
        tool,
        'Only read-only shell commands are permitted in this context (ls, find, grep, cat, stat, wc, head, tail, and similar)',
      )
    }

    if (
      (tool.name === FILE_EDIT_TOOL_NAME ||
        tool.name === FILE_WRITE_TOOL_NAME) &&
      'file_path' in input
    ) {
      const filePath = input.file_path
      if (typeof filePath === 'string' && isAutoMemPath(filePath)) {
        return { behavior: 'allow' as const, updatedInput: input }
      }
    }

    return denyAutoMemTool(
      tool,
      `only ${FILE_READ_TOOL_NAME}, ${GREP_TOOL_NAME}, ${GLOB_TOOL_NAME}, read-only ${BASH_TOOL_NAME}, and ${FILE_EDIT_TOOL_NAME}/${FILE_WRITE_TOOL_NAME} within ${memoryDir} are allowed`,
    )
  }
}

// ============================================================================
// Extract file paths from agent output
// ============================================================================

/**
 * Extract file_path from a tool_use block's input, if present.
 */
function getWrittenFilePath(block: {
  type: string
  name?: string
  input?: unknown
}): string | undefined {
  if (
    block.type !== 'tool_use' ||
    (block.name !== FILE_EDIT_TOOL_NAME && block.name !== FILE_WRITE_TOOL_NAME)
  ) {
    return undefined
  }
  const input = block.input
  if (typeof input === 'object' && input !== null && 'file_path' in input) {
    const fp = (input as { file_path: unknown }).file_path
    return typeof fp === 'string' ? fp : undefined
  }
  return undefined
}

function extractWrittenPaths(agentMessages: unknown[]): string[] {
  const paths: string[] = []
  for (const message of agentMessages) {
    const msg = message as MemMessage
    if (msg.type !== 'assistant') {
      continue
    }
    const content = (msg as MemAssistantMessage).message.content
    if (!Array.isArray(content)) {
      continue
    }
    for (const block of content) {
      const filePath = getWrittenFilePath(block)
      if (filePath !== undefined) {
        paths.push(filePath)
      }
    }
  }
  return uniq(paths)
}

// ============================================================================
// Initialization & Closure-scoped State
// ============================================================================

type AppendSystemMessageFn = (
  msg: MemSystemMessage,
) => void

/** The active extractor function, set by initExtractMemories(). */
let extractor:
  | ((
      context: MemREPLContext,
      appendSystemMessage?: AppendSystemMessageFn,
    ) => Promise<void>)
  | null = null

/** The active drain function, set by initExtractMemories(). No-op until init. */
let drainer: (timeoutMs?: number) => Promise<void> = async () => {}

/**
 * Initialize the memory extraction system.
 * Creates a fresh closure that captures all mutable state (cursor position,
 * overlap guard, pending context). Call once at startup alongside
 * initConfidenceRating/initPromptCoaching, or per-test in beforeEach.
 */
export function initExtractMemories(): void {
  // --- Closure-scoped mutable state ---

  const inFlightExtractions = new Set<Promise<void>>()

  let lastMemoryMessageUuid: string | undefined

  let hasLoggedGateFailure = false

  let inProgress = false

  let turnsSinceLastExtraction = 0

  let pendingContext:
    | {
        context: MemREPLContext
        appendSystemMessage?: AppendSystemMessageFn
      }
    | undefined

  // --- Inner extraction logic ---

  async function runExtraction({
    context,
    appendSystemMessage,
    isTrailingRun,
  }: {
    context: MemREPLContext
    appendSystemMessage?: AppendSystemMessageFn
    isTrailingRun?: boolean
  }): Promise<void> {
    const bindings = getMemoryHostBindings()
    const { messages } = context
    const memoryDir = getAutoMemPath()
    const newMessageCount = countModelVisibleMessagesSince(
      messages,
      lastMemoryMessageUuid,
    )

    // Mutual exclusion: when the main agent wrote memories, skip the
    // forked agent and advance the cursor past this range.
    if (hasMemoryWritesSince(messages, lastMemoryMessageUuid)) {
      bindings.logDebug?.(
        '[extractMemories] skipping — conversation already wrote to memory files',
      )
      const lastMessage = messages.at(-1)
      if (lastMessage?.uuid) {
        lastMemoryMessageUuid = lastMessage.uuid
      }
      bindings.logEvent?.('tengu_extract_memories_skipped_direct_write', {
        message_count: newMessageCount,
      })
      return
    }

    const teamMemoryEnabled = feature('TEAMMEM')
      ? teamMemPaths!.isTeamMemoryEnabled()
      : false

    const skipIndex = getFeatureValue_CACHED_MAY_BE_STALE(
      'tengu_moth_copse',
      false,
    )

    const canUseTool = createAutoMemCanUseTool(memoryDir)
    const cacheSafeParams = bindings.createCacheSafeParams?.(context)

    // Only run extraction every N eligible turns (tengu_bramble_lintel, default 1).
    if (!isTrailingRun) {
      turnsSinceLastExtraction++
      if (
        turnsSinceLastExtraction <
        (getFeatureValue_CACHED_MAY_BE_STALE('tengu_bramble_lintel', null) ?? 1)
      ) {
        return
      }
    }
    turnsSinceLastExtraction = 0

    inProgress = true
    const startTime = Date.now()
    try {
      bindings.logDebug?.(
        `[extractMemories] starting — ${newMessageCount} new messages, memoryDir=${memoryDir}`,
      )

      // Pre-inject the memory directory manifest so the agent doesn't spend
      // a turn on `ls`. Reuses findRelevantMemories' frontmatter scan.
      const abortController = bindings.createAbortController?.() ?? new AbortController()
      const scanned = await (bindings.scanMemoryFiles?.(memoryDir, abortController.signal) ?? Promise.resolve([]))
      const existingMemories = bindings.formatMemoryManifest?.(scanned) ?? ''

      const userPrompt =
        feature('TEAMMEM') && teamMemoryEnabled
          ? (bindings.buildExtractCombinedPrompt?.(
              newMessageCount,
              existingMemories,
              skipIndex,
            ) ?? '')
          : (bindings.buildExtractAutoOnlyPrompt?.(
              newMessageCount,
              existingMemories,
              skipIndex,
            ) ?? '')

      const result = await bindings.runForkedAgent?.({
        promptMessages: [bindings.createUserMessage?.({ content: userPrompt })],
        cacheSafeParams,
        canUseTool: canUseTool as (tool: unknown, input: Record<string, unknown>) => Promise<unknown>,
        querySource: 'extract_memories',
        forkLabel: 'extract_memories',
        skipTranscript: true,
        maxTurns: 5,
      })

      if (!result) return

      // Advance the cursor only after a successful run.
      const lastMessage = messages.at(-1)
      if (lastMessage?.uuid) {
        lastMemoryMessageUuid = lastMessage.uuid
      }

      const writtenPaths = extractWrittenPaths(result.messages)
      const turnCount = count(result.messages as MemMessage[], m => m.type === 'assistant')

      const totalInput =
        result.totalUsage.input_tokens +
        result.totalUsage.cache_creation_input_tokens +
        result.totalUsage.cache_read_input_tokens
      const hitPct =
        totalInput > 0
          ? (
              (result.totalUsage.cache_read_input_tokens / totalInput) *
              100
            ).toFixed(1)
          : '0.0'
      bindings.logDebug?.(
        `[extractMemories] finished — ${writtenPaths.length} files written, cache: read=${result.totalUsage.cache_read_input_tokens} create=${result.totalUsage.cache_creation_input_tokens} input=${result.totalUsage.input_tokens} (${hitPct}% hit)`,
      )

      if (writtenPaths.length > 0) {
        bindings.logDebug?.(
          `[extractMemories] memories saved: ${writtenPaths.join(', ')}`,
        )
      } else {
        bindings.logDebug?.('[extractMemories] no memories saved this run')
      }

      // Index file updates are mechanical — the agent touches MEMORY.md to add
      // a topic link, but the user-visible "memory" is the topic file itself.
      const memoryPaths = writtenPaths.filter(
        p => basename(p) !== ENTRYPOINT_NAME,
      )
      const teamCount = feature('TEAMMEM')
        ? count(memoryPaths, teamMemPaths!.isTeamMemPath)
        : 0

      bindings.logEvent?.('tengu_extract_memories_extraction', {
        input_tokens: result.totalUsage.input_tokens,
        output_tokens: result.totalUsage.output_tokens,
        cache_read_input_tokens: result.totalUsage.cache_read_input_tokens,
        cache_creation_input_tokens:
          result.totalUsage.cache_creation_input_tokens,
        message_count: newMessageCount,
        turn_count: turnCount,
        files_written: writtenPaths.length,
        memories_saved: memoryPaths.length,
        team_memories_saved: teamCount,
        duration_ms: Date.now() - startTime,
      })

      bindings.logDebug?.(
        `[extractMemories] writtenPaths=${writtenPaths.length} memoryPaths=${memoryPaths.length} appendSystemMessage defined=${appendSystemMessage != null}`,
      )
      if (memoryPaths.length > 0) {
        const msg = bindings.createMemorySavedMessage?.(memoryPaths)
        if (msg) {
          if (feature('TEAMMEM')) {
            msg.teamCount = teamCount
          }
          appendSystemMessage?.(msg as MemSystemMessage)
        }
      }
    } catch (error) {
      bindings.logDebug?.(`[extractMemories] error: ${error}`)
      bindings.logEvent?.('tengu_extract_memories_error', {
        duration_ms: Date.now() - startTime,
      })
    } finally {
      inProgress = false

      const trailing = pendingContext
      pendingContext = undefined
      if (trailing) {
        bindings.logDebug?.(
          '[extractMemories] running trailing extraction for stashed context',
        )
        await runExtraction({
          context: trailing.context,
          appendSystemMessage: trailing.appendSystemMessage,
          isTrailingRun: true,
        })
      }
    }
  }

  // --- Public entry point (captured by extractor) ---

  async function executeExtractMemoriesImpl(
    context: MemREPLContext,
    appendSystemMessage?: AppendSystemMessageFn,
  ): Promise<void> {
    const bindings = getMemoryHostBindings()
    // Only run for the main agent, not subagents
    if (context.toolUseContext.agentId) {
      return
    }

    if (!getFeatureValue_CACHED_MAY_BE_STALE('tengu_passport_quail', false)) {
      if (process.env.USER_TYPE === 'ant' && !hasLoggedGateFailure) {
        hasLoggedGateFailure = true
        bindings.logEvent?.('tengu_extract_memories_gate_disabled', {})
      }
      return
    }

    // Check auto-memory is enabled
    if (!isAutoMemoryEnabled()) {
      return
    }

    // Skip in remote mode
    if (bindings.getIsRemoteMode?.()) {
      return
    }

    if (inProgress) {
      bindings.logDebug?.(
        '[extractMemories] extraction in progress — stashing for trailing run',
      )
      bindings.logEvent?.('tengu_extract_memories_coalesced', {})
      pendingContext = { context, appendSystemMessage }
      return
    }

    await runExtraction({ context, appendSystemMessage })
  }

  extractor = async (context, appendSystemMessage) => {
    const p = executeExtractMemoriesImpl(context, appendSystemMessage)
    inFlightExtractions.add(p)
    try {
      await p
    } finally {
      inFlightExtractions.delete(p)
    }
  }

  drainer = async (timeoutMs = 60_000) => {
    if (inFlightExtractions.size === 0) return
    await Promise.race([
      Promise.all(inFlightExtractions).catch(() => {}),
      // eslint-disable-next-line no-restricted-syntax -- sleep() has no .unref(); timer must not block exit
      new Promise<void>(r => setTimeout(r, timeoutMs).unref()),
    ])
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Run memory extraction at the end of a query loop.
 * Called fire-and-forget from handleStopHooks, alongside prompt suggestion/coaching.
 * No-ops until initExtractMemories() has been called.
 */
export async function executeExtractMemories(
  context: MemREPLContext,
  appendSystemMessage?: AppendSystemMessageFn,
): Promise<void> {
  await extractor?.(context, appendSystemMessage)
}

/**
 * Awaits all in-flight extractions (including trailing stashed runs) with a
 * soft timeout. Called by print.ts after the response is flushed but before
 * gracefulShutdownSync. No-op until initExtractMemories() has been called.
 */
export async function drainPendingExtraction(
  timeoutMs?: number,
): Promise<void> {
  await drainer(timeoutMs)
}
