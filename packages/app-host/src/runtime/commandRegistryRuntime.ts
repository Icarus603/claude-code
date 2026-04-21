// biome-ignore-all assist/source/organizeImports: ANT-ONLY import markers must not be reordered
import addDir from 'src/commands/add-dir/index.js'
import { installCommandRegistryHostBindings } from '@claude-code/command-runtime'
import autofixPr from '@claude-code/command-runtime/stubs/stubCommand.js'
import backfillSessions from '@claude-code/command-runtime/stubs/stubCommand.js'
import btw from 'src/commands/btw/index.js'
import goodClaude from '@claude-code/command-runtime/stubs/stubCommand.js'
import issue from '@claude-code/command-runtime/stubs/stubCommand.js'
import feedback from '@claude-code/repl/commands/feedback/index.js'
import clear from 'src/commands/clear/index.js'
import color from '@claude-code/repl/commands/color/index.js'
import commit from '@claude-code/agent/commands/commit.js'
import copy from 'src/commands/copy/index.js'
import desktop from '@claude-code/repl/commands/desktop/index.js'
import commitPushPr from '@claude-code/agent/commands/commit-push-pr.js'
import compact from 'src/commands/compact/index.js'
import config from '@claude-code/repl/commands/config/index.js'
import { context, contextNonInteractive } from 'src/commands/context/index.js'
import cost from 'src/commands/cost/index.js'
import diff from '@claude-code/repl/commands/diff/index.js'
import ctx_viz from '@claude-code/command-runtime/stubs/stubCommand.js'
import doctor from '@claude-code/repl/commands/doctor/index.js'
import memory from 'src/commands/memory/index.js'
import help from '@claude-code/repl/commands/help/index.js'
import ide from 'src/commands/ide/index.js'
import init from '@claude-code/app-host/commands/initCommand.js'
import initVerifiers from '@claude-code/app-host/commands/init-verifiers.js'
import keybindings from '@claude-code/repl/commands/keybindings/index.js'
import login from '@claude-code/provider/commands/login/index.js'
import logout from '@claude-code/provider/commands/logout/index.js'
import installGitHubApp from 'src/commands/install-github-app/index.js'
import installSlackApp from '@claude-code/repl/commands/install-slack-app/index.js'
import breakCache from '@claude-code/command-runtime/stubs/stubCommand.js'
import mcp from 'src/commands/mcp/index.js'
import mobile from '@claude-code/repl/commands/mobile/index.js'
import onboarding from '@claude-code/command-runtime/stubs/stubCommand.js'
import pr_comments from '@claude-code/agent/commands/pr_comments/index.js'
import releaseNotes from '@claude-code/repl/commands/release-notes/index.js'
import rename from 'src/commands/rename/index.js'
import resume from 'src/commands/resume/index.js'
import review, { ultrareview } from 'src/commands/review.js'
import session from 'src/commands/session/index.js'
import share from '@claude-code/command-runtime/stubs/stubCommand.js'
import skills from '@claude-code/command-runtime/commands/skills/index.js'
import status from 'src/commands/status/index.js'
import tasks from '@claude-code/agent/commands/tasks/index.js'
import teleport from '@claude-code/command-runtime/stubs/stubCommand.js'
/* eslint-disable @typescript-eslint/no-require-imports */
const agentsPlatform =
  process.env.USER_TYPE === 'ant'
    ? require('src/commands/agents-platform/index.js').default
    : null
/* eslint-enable @typescript-eslint/no-require-imports */
import securityReview from '@claude-code/agent/commands/security-review.js'
import bughunter from '@claude-code/command-runtime/stubs/stubCommand.js'
import terminalSetup from 'src/commands/terminalSetup/index.js'
import usage from '@claude-code/repl/commands/usage/index.js'
import theme from 'src/commands/theme/index.js'
import vim from '@claude-code/repl/commands/vim/index.js'
import { feature } from 'bun:bundle'
// Dead code elimination: conditional imports
/* eslint-disable @typescript-eslint/no-require-imports */
const proactive =
  feature('PROACTIVE') || feature('KAIROS')
    ? require('src/commands/proactive.js').default
    : null
const briefCommand =
  feature('KAIROS') || feature('KAIROS_BRIEF')
    ? require('src/commands/brief.js').default
    : null
const assistantCommand = feature('KAIROS')
  ? require('@claude-code/repl/commands/assistant/index.js').default
  : null
const bridge = feature('BRIDGE_MODE')
  ? require('@claude-code/bridge/index.js').default
  : null
const remoteControlServerCommand =
  feature('DAEMON') && feature('BRIDGE_MODE')
    ? require('src/commands/remoteControlServer/index.js').default
    : null
const voiceCommand = feature('VOICE_MODE')
  ? require('src/commands/voice/index.js').default
  : null
const forceSnip = feature('HISTORY_SNIP')
  ? require('src/commands/force-snip.js').default
  : null
const workflowsCmd = feature('WORKFLOW_SCRIPTS')
  ? (
      require('src/commands/workflows/index.js') as typeof import('src/commands/workflows/index.js')
    ).default
  : null
const webCmd = feature('CCR_REMOTE_SETUP')
  ? (
      require('@claude-code/teleport/remote-setup/index.js') as typeof import('@claude-code/teleport/remote-setup/index.js')
    ).default
  : null
const clearSkillIndexCache = feature('EXPERIMENTAL_SKILL_SEARCH')
  ? (
      require('src/services/skillSearch/localSearch.js') as typeof import('src/services/skillSearch/localSearch.js')
    ).clearSkillIndexCache
  : null
const subscribePr = feature('KAIROS_GITHUB_WEBHOOKS')
  ? require('src/commands/subscribe-pr.js').default
  : null
const ultraplan = feature('ULTRAPLAN')
  ? require('src/commands/ultraplan.js').default
  : null
const torch = feature('TORCH') ? require('src/commands/torch.js').default : null
const peersCmd = feature('UDS_INBOX')
  ? (
      require('src/commands/peers/index.js') as typeof import('src/commands/peers/index.js')
    ).default
  : null
const forkCmd = feature('FORK_SUBAGENT')
  ? (
      require('src/commands/fork/index.js') as typeof import('src/commands/fork/index.js')
    ).default
  : null
/* eslint-enable @typescript-eslint/no-require-imports */
import thinkback from 'src/commands/thinkback/index.js'
import thinkbackPlay from 'src/commands/thinkback-play/index.js'
import permissions from '@claude-code/permission/commands/index.js'
import plan from '@claude-code/repl/commands/plan/index.js'
import fast from 'src/commands/fast/index.js'
import passes from '@claude-code/repl/commands/passes/index.js'
import privacySettings from 'src/commands/privacy-settings/index.js'
import hooks from '@claude-code/repl/commands/hooks/index.js'
import files from '@claude-code/repl/commands/files/index.js'
import branch from '@claude-code/swarm/commands/branch/index.js'
import agents from '@claude-code/swarm/commands/agents/index.js'
import plugin from 'src/commands/plugin/index.js'
import reloadPlugins from '@claude-code/config/plugin/commands/reload-plugins/index.js'
import rewind from '@claude-code/repl/commands/rewind/index.js'
import heapDump from '@claude-code/repl/commands/heapdump/index.js'
import mockLimits from '@claude-code/command-runtime/stubs/stubCommand.js'
import bridgeKick from '@claude-code/bridge/commands/bridge-kick.js'
import version from '@claude-code/cli/commands/version.js'
import summary from '@claude-code/command-runtime/stubs/stubCommand.js'
import {
  resetLimits,
  resetLimitsNonInteractive,
} from 'src/commands/reset-limits/index.js'
import antTrace from '@claude-code/command-runtime/stubs/stubCommand.js'
import perfIssue from '@claude-code/command-runtime/stubs/stubCommand.js'
import sandboxToggle from 'src/commands/sandbox-toggle/index.js'
import chrome from 'src/commands/chrome/index.js'
import stickers from '@claude-code/repl/commands/stickers/index.js'
import advisor from '@claude-code/provider/commands/advisor.js'
import provider from '@claude-code/provider/commands/provider.js'
import { logError } from '@claude-code/local-observability/logging'
import { toError } from '@claude-code/local-observability/errorHelpers.js'
import { logForDebugging } from '@claude-code/local-observability/debug.js'
import {
  getSkillDirCommands,
  clearSkillCaches,
  getDynamicSkills,
} from '@claude-code/command-runtime/skills/loadSkillsDir.js'
import { getBundledSkills } from '@claude-code/command-runtime/skills/bundledSkills.js'
import { getBuiltinPluginSkillCommands } from 'src/plugins/builtinPlugins.js'
import {
  getPluginCommands,
  clearPluginCommandCache,
  getPluginSkills,
  clearPluginSkillsCache,
} from '@claude-code/config/plugin/loadPluginCommands'
import memoize from 'lodash-es/memoize.js'
import { isUsing3PServices, isClaudeAISubscriber } from '@claude-code/provider/authAlias.js'
import { isFirstPartyAnthropicBaseUrl } from '@claude-code/provider/providers.js'
import env from '@claude-code/command-runtime/stubs/stubCommand.js'
import exit from '@claude-code/repl/commands/exit/index.js'
import exportCommand from '@claude-code/repl/commands/export/index.js'
import model from '@claude-code/provider/commands/model/index.js'
import tag from '@claude-code/repl/commands/tag/index.js'
import outputStyle from '@claude-code/repl/commands/output-style/index.js'
import remoteEnv from 'src/commands/remote-env/index.js'
import upgrade from 'src/commands/upgrade/index.js'
import {
  extraUsage,
  extraUsageNonInteractive,
} from '@claude-code/repl/extraUsage.js'
import rateLimitOptions from 'src/commands/rate-limit-options/index.js'
import statusline from '@claude-code/repl/commands/statusline.js'
import effort from 'src/commands/effort/index.js'
import stats from '@claude-code/repl/commands/stats/index.js'
// insights.ts is 113KB (3200 lines, includes diffLines/html rendering). Lazy
// shim defers the heavy module until /insights is actually invoked.
const usageReport: Command = {
  type: 'prompt',
  name: 'insights',
  description: 'Generate a report analyzing your Claude Code sessions',
  contentLength: 0,
  progressMessage: 'analyzing your sessions',
  source: 'builtin',
  async getPromptForCommand(args, context) {
    const real = (await import('src/commands/insights.js')).default
    if (real.type !== 'prompt') throw new Error('unreachable')
    return real.getPromptForCommand(args, context)
  },
}
import oauthRefresh from '@claude-code/command-runtime/stubs/stubCommand.js'
import debugToolCall from '@claude-code/command-runtime/stubs/stubCommand.js'
import { getSettingSourceName } from '@claude-code/config/constants'
import {
  type Command,
  getCommandName,
  isCommandEnabled,
} from '@claude-code/agent/command.js'

// Re-export types from the centralized location
export type {
  Command,
  CommandBase,
  CommandResultDisplay,
  LocalCommandResult,
  LocalJSXCommandContext,
  PromptCommand,
  ResumeEntrypoint,
} from '@claude-code/agent/command.js'
export { getCommandName, isCommandEnabled } from '@claude-code/agent/command.js'

// Commands that get eliminated from the external build
export const INTERNAL_ONLY_COMMANDS = [
  backfillSessions,
  breakCache,
  bughunter,
  commit,
  commitPushPr,
  ctx_viz,
  goodClaude,
  issue,
  initVerifiers,
  ...(forceSnip ? [forceSnip] : []),
  mockLimits,
  bridgeKick,
  version,
  ...(subscribePr ? [subscribePr] : []),
  resetLimits,
  resetLimitsNonInteractive,
  onboarding,
  share,
  summary,
  teleport,
  antTrace,
  perfIssue,
  env,
  oauthRefresh,
  debugToolCall,
  agentsPlatform,
  autofixPr,
].filter(Boolean)

// Declared as a function so that we don't run this until getCommands is called,
// since underlying functions read from config, which can't be read at module initialization time
const COMMANDS = memoize((): Command[] => [
  addDir,
  advisor,
  provider,
  agents,
  branch,
  btw,
  chrome,
  clear,
  color,
  compact,
  config,
  copy,
  desktop,
  context,
  contextNonInteractive,
  cost,
  diff,
  doctor,
  effort,
  exit,
  fast,
  files,
  heapDump,
  help,
  ide,
  init,
  keybindings,
  installGitHubApp,
  installSlackApp,
  mcp,
  memory,
  mobile,
  model,
  outputStyle,
  remoteEnv,
  plugin,
  pr_comments,
  releaseNotes,
  reloadPlugins,
  rename,
  resume,
  session,
  skills,
  stats,
  status,
  statusline,
  stickers,
  tag,
  theme,
  feedback,
  review,
  ultrareview,
  rewind,
  securityReview,
  terminalSetup,
  upgrade,
  extraUsage,
  extraUsageNonInteractive,
  rateLimitOptions,
  usage,
  usageReport,
  vim,
  ...(webCmd ? [webCmd] : []),
  ...(forkCmd ? [forkCmd] : []),
  ...(proactive ? [proactive] : []),
  ...(briefCommand ? [briefCommand] : []),
  ...(assistantCommand ? [assistantCommand] : []),
  ...(bridge ? [bridge] : []),
  ...(remoteControlServerCommand ? [remoteControlServerCommand] : []),
  ...(voiceCommand ? [voiceCommand] : []),
  thinkback,
  thinkbackPlay,
  permissions,
  plan,
  privacySettings,
  hooks,
  exportCommand,
  sandboxToggle,
  ...(!isUsing3PServices() ? [logout, login()] : []),
  passes,
  ...(peersCmd ? [peersCmd] : []),
  tasks,
  ...(workflowsCmd ? [workflowsCmd] : []),
  ...(ultraplan ? [ultraplan] : []),
  ...(torch ? [torch] : []),
  ...(process.env.USER_TYPE === 'ant' && !process.env.IS_DEMO
    ? INTERNAL_ONLY_COMMANDS
    : []),
])

export const builtInCommandNames = memoize(
  (): Set<string> =>
    new Set(COMMANDS().flatMap(_ => [_.name, ...(_.aliases ?? [])])),
)

async function getSkills(cwd: string): Promise<{
  skillDirCommands: Command[]
  pluginSkills: Command[]
  bundledSkills: Command[]
  builtinPluginSkills: Command[]
}> {
  try {
    const [skillDirCommands, pluginSkills] = await Promise.all([
      getSkillDirCommands(cwd).catch(err => {
        logError(toError(err))
        logForDebugging(
          'Skill directory commands failed to load, continuing without them',
        )
        return []
      }),
      getPluginSkills().catch(err => {
        logError(toError(err))
        logForDebugging('Plugin skills failed to load, continuing without them')
        return []
      }),
    ])
    // Bundled skills are registered synchronously at startup
    const bundledSkills = getBundledSkills()
    // Built-in plugin skills come from enabled built-in plugins
    const builtinPluginSkills = getBuiltinPluginSkillCommands()
    logForDebugging(
      `getSkills returning: ${skillDirCommands.length} skill dir commands, ${pluginSkills.length} plugin skills, ${bundledSkills.length} bundled skills, ${builtinPluginSkills.length} builtin plugin skills`,
    )
    return {
      skillDirCommands,
      pluginSkills,
      bundledSkills,
      builtinPluginSkills,
    }
  } catch (err) {
    // This should never happen since we catch at the Promise level, but defensive
    logError(toError(err))
    logForDebugging('Unexpected error in getSkills, returning empty')
    return {
      skillDirCommands: [],
      pluginSkills: [],
      bundledSkills: [],
      builtinPluginSkills: [],
    }
  }
}

/* eslint-disable @typescript-eslint/no-require-imports */
const getWorkflowCommands = feature('WORKFLOW_SCRIPTS')
  ? (
      require('@claude-code/tool-registry/tools/WorkflowTool/createWorkflowCommand.js') as typeof import('@claude-code/tool-registry/tools/WorkflowTool/createWorkflowCommand.js')
    ).getWorkflowCommands
  : null
/* eslint-enable @typescript-eslint/no-require-imports */

/**
 * Filters commands by their declared `availability` (auth/provider requirement).
 * Commands without `availability` are treated as universal.
 * This runs before `isEnabled()` so that provider-gated commands are hidden
 * regardless of feature-flag state.
 *
 * Not memoized — auth state can change mid-session (e.g. after /login),
 * so this must be re-evaluated on every getCommands() call.
 */
export function meetsAvailabilityRequirement(cmd: Command): boolean {
  if (!cmd.availability || cmd.availability.length === 0) return true
  for (const a of cmd.availability) {
    switch (a) {
      case 'claude-ai':
        if (isClaudeAISubscriber()) return true
        break
      case 'console':
        // Console API key user = direct 1P API customer (not 3P, not claude.ai).
        // Excludes 3P (Bedrock/Vertex/Foundry) who don't set ANTHROPIC_BASE_URL
        // and gateway users who proxy through a custom base URL.
        if (
          !isClaudeAISubscriber() &&
          !isUsing3PServices() &&
          isFirstPartyAnthropicBaseUrl()
        )
          return true
        break
      default: {
        const _exhaustive: never = a
        void _exhaustive
        break
      }
    }
  }
  return false
}

/**
 * Loads all command sources (skills, plugins, workflows). Memoized by cwd
 * because loading is expensive (disk I/O, dynamic imports).
 */
const loadAllCommands = memoize(async (cwd: string): Promise<Command[]> => {
  const [
    { skillDirCommands, pluginSkills, bundledSkills, builtinPluginSkills },
    pluginCommands,
    workflowCommands,
  ] = await Promise.all([
    getSkills(cwd),
    getPluginCommands(),
    getWorkflowCommands ? getWorkflowCommands(cwd) : Promise.resolve([]),
  ])

  return [
    ...bundledSkills,
    ...builtinPluginSkills,
    ...skillDirCommands,
    ...workflowCommands,
    ...pluginCommands,
    ...pluginSkills,
    ...COMMANDS(),
  ]
})

/**
 * Returns commands available to the current user. The expensive loading is
 * memoized, but availability and isEnabled checks run fresh every call so
 * auth changes (e.g. /login) take effect immediately.
 */
export async function getCommands(cwd: string): Promise<Command[]> {
  const allCommands = await loadAllCommands(cwd)

  // Get dynamic skills discovered during file operations
  const dynamicSkills = getDynamicSkills()

  // Build base commands without dynamic skills
  const baseCommands = allCommands.filter(
    _ => meetsAvailabilityRequirement(_) && isCommandEnabled(_),
  )

  if (dynamicSkills.length === 0) {
    return baseCommands
  }

  // Dedupe dynamic skills - only add if not already present
  const baseCommandNames = new Set(baseCommands.map(c => c.name))
  const uniqueDynamicSkills = dynamicSkills.filter(
    s =>
      !baseCommandNames.has(s.name) &&
      meetsAvailabilityRequirement(s) &&
      isCommandEnabled(s),
  )

  if (uniqueDynamicSkills.length === 0) {
    return baseCommands
  }

  // Insert dynamic skills after plugin skills but before built-in commands
  const builtInNames = new Set(COMMANDS().map(c => c.name))
  const insertIndex = baseCommands.findIndex(c => builtInNames.has(c.name))

  if (insertIndex === -1) {
    return [...baseCommands, ...uniqueDynamicSkills]
  }

  return [
    ...baseCommands.slice(0, insertIndex),
    ...uniqueDynamicSkills,
    ...baseCommands.slice(insertIndex),
  ]
}

/**
 * Clears only the memoization caches for commands, WITHOUT clearing skill caches.
 * Use this when dynamic skills are added to invalidate cached command lists.
 */
export function clearCommandMemoizationCaches(): void {
  loadAllCommands.cache?.clear?.()
  getSkillToolCommands.cache?.clear?.()
  getSlashCommandToolSkills.cache?.clear?.()
  // getSkillIndex in skillSearch/localSearch.ts is a separate memoization layer
  // built ON TOP of getSkillToolCommands/getCommands. Clearing only the inner
  // caches is a no-op for the outer — lodash memoize returns the cached result
  // without ever reaching the cleared inners. Must clear it explicitly.
  clearSkillIndexCache?.()
}

export function clearCommandsCache(): void {
  clearCommandMemoizationCaches()
  clearPluginCommandCache()
  clearPluginSkillsCache()
  clearSkillCaches()
}

/**
 * Filter AppState.mcp.commands to MCP-provided skills (prompt-type,
 * model-invocable, loaded from MCP). These live outside getCommands() so
 * callers that need MCP skills in their skill index thread them through
 * separately.
 */
export function getMcpSkillCommands(
  mcpCommands: readonly Command[],
): readonly Command[] {
  if (feature('MCP_SKILLS')) {
    return mcpCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        cmd.loadedFrom === 'mcp' &&
        !cmd.disableModelInvocation,
    )
  }
  return []
}

// SkillTool shows ALL prompt-based commands that the model can invoke
// This includes both skills (from /skills/) and commands (from /commands/)
export const getSkillToolCommands = memoize(
  async (cwd: string): Promise<Command[]> => {
    const allCommands = await getCommands(cwd)
    return allCommands.filter(
      cmd =>
        cmd.type === 'prompt' &&
        !cmd.disableModelInvocation &&
        cmd.source !== 'builtin' &&
        // Always include skills from /skills/ dirs, bundled skills, and legacy /commands/ entries
        // (they all get an auto-derived description from the first line if frontmatter is missing).
        // Plugin/MCP commands still require an explicit description to appear in the listing.
        (cmd.loadedFrom === 'bundled' ||
          cmd.loadedFrom === 'skills' ||
          cmd.loadedFrom === 'commands_DEPRECATED' ||
          cmd.hasUserSpecifiedDescription ||
          cmd.whenToUse),
    )
  },
)

// Filters commands to include only skills. Skills are commands that provide
// specialized capabilities for the model to use. They are identified by
// loadedFrom being 'skills', 'plugin', or 'bundled', or having disableModelInvocation set.
export const getSlashCommandToolSkills = memoize(
  async (cwd: string): Promise<Command[]> => {
    try {
      const allCommands = await getCommands(cwd)
      return allCommands.filter(
        cmd =>
          cmd.type === 'prompt' &&
          cmd.source !== 'builtin' &&
          (cmd.hasUserSpecifiedDescription || cmd.whenToUse) &&
          (cmd.loadedFrom === 'skills' ||
            cmd.loadedFrom === 'plugin' ||
            cmd.loadedFrom === 'bundled' ||
            cmd.disableModelInvocation),
      )
    } catch (error) {
      logError(toError(error))
      // Return empty array rather than throwing - skills are non-critical
      // This prevents skill loading failures from breaking the entire system
      logForDebugging('Returning empty skills array due to load failure')
      return []
    }
  },
)

/**
 * Commands that are safe to use in remote mode (--remote).
 * These only affect local TUI state and don't depend on local filesystem,
 * git, shell, IDE, MCP, or other local execution context.
 *
 * Used in two places:
 * 1. Pre-filtering commands in main.tsx before REPL renders (prevents race with CCR init)
 * 2. Preserving local-only commands in REPL's handleRemoteInit after CCR filters
 */
export const REMOTE_SAFE_COMMANDS: Set<Command> = new Set([
  session, // Shows QR code / URL for remote session
  exit, // Exit the TUI
  clear, // Clear screen
  help, // Show help
  theme, // Change terminal theme
  color, // Change agent color
  vim, // Toggle vim mode
  cost, // Show session cost (local cost tracking)
  usage, // Show usage info
  copy, // Copy last message
  btw, // Quick note
  feedback, // Send feedback
  plan, // Plan mode toggle
  keybindings, // Keybinding management
  statusline, // Status line toggle
  stickers, // Stickers
  mobile, // Mobile QR code
])

/**
 * Builtin commands of type 'local' that ARE safe to execute when received
 * over the Remote Control bridge. These produce text output that streams
 * back to the mobile/web client and have no terminal-only side effects.
 *
 * 'local-jsx' commands are blocked by type (they render Ink UI) and
 * 'prompt' commands are allowed by type (they expand to text sent to the
 * model) — this set only gates 'local' commands.
 *
 * When adding a new 'local' command that should work from mobile, add it
 * here. Default is blocked.
 */
export const BRIDGE_SAFE_COMMANDS: Set<Command> = new Set(
  [
    compact, // Shrink context — useful mid-session from a phone
    clear, // Wipe transcript
    cost, // Show session cost
    summary, // Summarize conversation
    releaseNotes, // Show changelog
    files, // List tracked files
  ].filter((c): c is Command => c !== null),
)

/**
 * Whether a slash command is safe to execute when its input arrived over the
 * Remote Control bridge (mobile/web client).
 *
 * PR #19134 blanket-blocked all slash commands from bridge inbound because
 * `/model` from iOS was popping the local Ink picker. This predicate relaxes
 * that with an explicit allowlist: 'prompt' commands (skills) expand to text
 * and are safe by construction; 'local' commands need an explicit opt-in via
 * BRIDGE_SAFE_COMMANDS; 'local-jsx' commands render Ink UI and stay blocked.
 */
export function isBridgeSafeCommand(cmd: Command): boolean {
  if (cmd.type === 'local-jsx') return false
  if (cmd.type === 'prompt') return true
  return BRIDGE_SAFE_COMMANDS.has(cmd)
}

/**
 * Filter commands to only include those safe for remote mode.
 * Used to pre-filter commands when rendering the REPL in --remote mode,
 * preventing local-only commands from being briefly available before
 * the CCR init message arrives.
 */
export function filterCommandsForRemoteMode(commands: Command[]): Command[] {
  return commands.filter(cmd => REMOTE_SAFE_COMMANDS.has(cmd))
}

export function findCommand(
  commandName: string,
  commands: Command[],
): Command | undefined {
  return commands.find(
    _ =>
      _.name === commandName ||
      getCommandName(_) === commandName ||
      _.aliases?.includes(commandName),
  )
}

export function hasCommand(commandName: string, commands: Command[]): boolean {
  return findCommand(commandName, commands) !== undefined
}

export function getCommand(commandName: string, commands: Command[]): Command {
  const command = findCommand(commandName, commands)
  if (!command) {
    throw ReferenceError(
      `Command ${commandName} not found. Available commands: ${commands
        .map(_ => {
          const name = getCommandName(_)
          return _.aliases ? `${name} (aliases: ${_.aliases.join(', ')})` : name
        })
        .sort((a, b) => a.localeCompare(b))
        .join(', ')}`,
    )
  }

  return command
}

/**
 * Formats a command's description with its source annotation for user-facing UI.
 * Use this in typeahead, help screens, and other places where users need to see
 * where a command comes from.
 *
 * For model-facing prompts (like SkillTool), use cmd.description directly.
 */
export function formatDescriptionWithSource(cmd: Command): string {
  if (cmd.type !== 'prompt') {
    return cmd.description
  }

  if (cmd.kind === 'workflow') {
    return `${cmd.description} (workflow)`
  }

  if (cmd.source === 'plugin') {
    const pluginName = cmd.pluginInfo?.pluginManifest.name
    if (pluginName) {
      return `(${pluginName}) ${cmd.description}`
    }
    return `${cmd.description} (plugin)`
  }

  if (cmd.source === 'builtin' || cmd.source === 'mcp') {
    return cmd.description
  }

  if (cmd.source === 'bundled') {
    return `${cmd.description} (bundled)`
  }

  return `${cmd.description} (${getSettingSourceName(cmd.source)})`
}

let commandRegistryHostBindingsInstalled = false

export function installCommandRuntimeBindings(): void {
  if (commandRegistryHostBindingsInstalled) {
    return
  }

  installCommandRegistryHostBindings<Command>({
    getCommands,
    clearCommandMemoizationCaches,
    clearCommandsCache,
    getCommandName,
    isCommandEnabled,
    builtInCommandNames: () => builtInCommandNames(),
    findCommand,
    hasCommand,
    getCommand,
    getSkillToolCommands,
    getSlashCommandToolSkills,
    getMcpSkillCommands: mcpCommands => getMcpSkillCommands(mcpCommands),
    internalOnlyCommands: () => INTERNAL_ONLY_COMMANDS,
    remoteSafeCommands: () => REMOTE_SAFE_COMMANDS,
    bridgeSafeCommands: () => BRIDGE_SAFE_COMMANDS,
    isBridgeSafeCommand,
    filterCommandsForRemoteMode,
    formatDescriptionWithSource,
  })

  commandRegistryHostBindingsInstalled = true
}

installCommandRuntimeBindings()
