import { z } from 'zod/v4'
import { isAbsolute, relative, resolve } from 'node:path'
import { getSessionId, setOriginalCwd } from '@claude-code/app-host/bootstrap/state.js'
import { clearSystemPromptSections } from '@claude-code/provider/systemPromptSections'
import { logEvent } from '@claude-code/local-observability'
import type { Tool } from '../../Tool.js'
import { buildTool, type ToolDef } from '../../Tool.js'
import { clearMemoryFileCaches } from '@claude-code/storage/claudemd.js'
import { getCwd } from '@claude-code/app-host/bootstrap/cwd.js'
import { findCanonicalGitRoot } from '@claude-code/storage/git.js'
import { lazySchema } from '../../utils/lazySchema.js'
import { getPlanSlug, getPlansDirectory } from '@claude-code/storage/plans.js'
import { setCwd } from '@claude-code/shell/Shell.js'
import { saveWorktreeState } from '@claude-code/storage/sessionStorage.js'
import {
  createWorktreeForSession,
  getCurrentWorktreeSession,
  validateWorktreeSlug,
} from '@claude-code/swarm'
import { ENTER_WORKTREE_TOOL_NAME } from './constants.js'
import { getEnterWorktreeToolPrompt } from './prompt.js'
import { renderToolResultMessage, renderToolUseMessage } from './UI.js'

const inputSchema = lazySchema(() =>
  z.strictObject({
    name: z
      .string()
      .superRefine((s, ctx) => {
        try {
          validateWorktreeSlug(s)
        } catch (e) {
          ctx.addIssue({ code: 'custom', message: (e as Error).message })
        }
      })
      .optional()
      .describe(
        'Optional name for the worktree to create. Each "/"-separated segment may contain only letters, digits, dots, underscores, and dashes; max 64 chars total. A random name is generated if not provided. Mutually exclusive with `path`.',
      ),
    // Port of ant v2.1.128 K7H (3871.js) — `path` mode lets the model
    // re-enter an existing worktree (e.g. one created during a prior
    // session). Safety: the path MUST already appear in `git worktree
    // list` output. We don't accept arbitrary paths because the session
    // CWD swap has side effects that should only happen against
    // actually-existing worktrees.
    path: z
      .string()
      .optional()
      .describe(
        'Optional absolute path to an existing worktree to enter. The path MUST be present in `git worktree list`. Mutually exclusive with `name`.',
      ),
  }),
)
type InputSchema = ReturnType<typeof inputSchema>

const outputSchema = lazySchema(() =>
  z.object({
    worktreePath: z.string(),
    worktreeBranch: z.string().optional(),
    message: z.string(),
  }),
)
type OutputSchema = ReturnType<typeof outputSchema>
export type Output = z.infer<OutputSchema>

export const EnterWorktreeTool: Tool<InputSchema, Output> = buildTool({
  name: ENTER_WORKTREE_TOOL_NAME,
  searchHint: 'create an isolated git worktree and switch into it',
  maxResultSizeChars: 100_000,
  async description() {
    return 'Creates an isolated worktree (via git or configured hooks) and switches the session into it'
  },
  async prompt() {
    return getEnterWorktreeToolPrompt()
  },
  get inputSchema(): InputSchema {
    return inputSchema()
  },
  get outputSchema(): OutputSchema {
    return outputSchema()
  },
  userFacingName() {
    return 'Creating worktree'
  },
  shouldDefer: true,
  toAutoClassifierInput(input) {
    return input.name ?? ''
  },
  async checkPermissions(input) {
    if (!input.path) return { behavior: 'allow', updatedInput: input }
    const root = findCanonicalGitRoot(getCwd()) ?? getCwd()
    const candidate = resolve(input.path)
    const managedRoot = resolve(root, '.claude', 'worktrees')
    const rel = relative(managedRoot, candidate)
    const isManaged =
      rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
    if (isManaged) return { behavior: 'allow', updatedInput: input }
    return {
      behavior: 'ask',
      message:
        `Enter existing worktree outside ${managedRoot}: ${candidate}. ` +
        'This changes the session working directory and trust boundary.',
    }
  },
  renderToolUseMessage,
  renderToolResultMessage,
  async call(input) {
    // Validate mutually exclusive flags.
    if (input.name && input.path) {
      throw new Error(
        'name and path are mutually exclusive — pass one or neither',
      )
    }
    // Validate not already in a worktree created by this session
    if (getCurrentWorktreeSession()) {
      throw new Error('Already in a worktree session')
    }

    // Resolve to main repo root so worktree creation works from within a worktree
    const mainRepoRoot = findCanonicalGitRoot(getCwd())
    if (mainRepoRoot && mainRepoRoot !== getCwd()) {
      process.chdir(mainRepoRoot)
      setCwd(mainRepoRoot)
    }

    // Port of ant v2.1.128 K7H — `path` mode: enter an existing worktree
    // after checking it appears in `git worktree list`. We piggy-back on
    // the shell exec module rather than spawning gh ourselves so the
    // environment-override + sandbox semantics stay consistent with
    // BashTool's behaviour.
    if (input.path) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { execSync } = require('node:child_process') as typeof import('node:child_process')
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { resolve: pathResolve } = require('node:path') as typeof import('node:path')
      let out: string
      try {
        out = execSync('git worktree list --porcelain', {
          encoding: 'utf-8',
          timeout: 5000,
          cwd: mainRepoRoot ?? getCwd(),
        })
      } catch {
        throw new Error(
          'Failed to enumerate worktrees via `git worktree list`',
        )
      }
      const absPath = pathResolve(input.path)
      const lines = out.split(/\r?\n/)
      const known = new Set<string>()
      for (const line of lines) {
        if (line.startsWith('worktree ')) known.add(line.slice('worktree '.length).trim())
      }
      if (!known.has(absPath)) {
        throw new Error(
          `Path "${absPath}" is not in \`git worktree list\`. Use \`name\` to create a new worktree, or pass an existing worktree path.`,
        )
      }
      process.chdir(absPath)
      setCwd(absPath)
      setOriginalCwd(absPath)
      // We didn't create a session here — leave session storage untouched.
      // Just clear caches so subsequent reads reflect the new cwd.
      clearSystemPromptSections()
      clearMemoryFileCaches()
      getPlansDirectory.cache.clear?.()
      logEvent('tengu_worktree_entered_existing', {
        mid_session: true,
      })
      return {
        data: {
          worktreePath: absPath,
          message: `Entered existing worktree at ${absPath}. The session is now working in the worktree.`,
        },
      }
    }

    const slug = input.name ?? getPlanSlug()

    const worktreeSession = await createWorktreeForSession(getSessionId(), slug)

    process.chdir(worktreeSession.worktreePath)
    setCwd(worktreeSession.worktreePath)
    setOriginalCwd(getCwd())
    saveWorktreeState(worktreeSession)
    // Clear cached system prompt sections so env_info_simple recomputes with worktree context
    clearSystemPromptSections()
    // Clear memoized caches that depend on CWD
    clearMemoryFileCaches()
    getPlansDirectory.cache.clear?.()

    logEvent('tengu_worktree_created', {
      mid_session: true,
    })

    const branchInfo = worktreeSession.worktreeBranch
      ? ` on branch ${worktreeSession.worktreeBranch}`
      : ''

    return {
      data: {
        worktreePath: worktreeSession.worktreePath,
        worktreeBranch: worktreeSession.worktreeBranch,
        message: `Created worktree at ${worktreeSession.worktreePath}${branchInfo}. The session is now working in the worktree. Use ExitWorktree to leave mid-session, or exit the session to be prompted.`,
      },
    }
  },
  mapToolResultToToolResultBlockParam({ message }, toolUseID) {
    return {
      type: 'tool_result',
      content: message,
      tool_use_id: toolUseID,
    }
  },
} satisfies ToolDef<InputSchema, Output>)
