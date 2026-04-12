/**
 * Commander program assembly + parse extracted from src/main.tsx per V7 §10.1.
 *
 * Owns:
 *  - the preAction hook body (init, sinks, inline-plugin handling, migrations,
 *    remote managed settings, background settings sync)
 *  - the feature-gated secondary option attachments (ANT-only, KAIROS, bridge,
 *    teleport, teammate identity, etc.)
 *  - the print-mode short circuit (skips subcommand tree in -p mode)
 *  - the full subcommand registration (mcp/server/ssh/open + misc commands)
 *  - the parseAsync + post-parse profiler report
 */

import type { Command as CommanderCommand } from '@commander-js/extra-typings'
import { Option } from '@commander-js/extra-typings'
import { feature } from 'bun:bundle'
import type { RuntimeHandles } from '@claude-code/app-host'

import { init } from '../../../../src/entrypoints/init.js'
import { loadPolicyLimits } from '../../../../src/services/policyLimits/index.js'
import { loadRemoteManagedSettings } from '../../../../src/services/remoteManagedSettings/index.js'
import { setInlinePlugins } from '../../../../src/bootstrap/state.js'
import { clearPluginCache } from '../../../../src/utils/plugins/pluginLoader.js'
import { runMigrations } from '../../../../src/main/startup/settings.js'
import { canUserConfigureAdvisor } from '../../../../src/utils/advisor.js'
import { ensureMdmSettingsLoaded } from '../../../../src/utils/settings/mdm/settings.js'
import { ensureKeychainPrefetchCompleted } from '../../../../src/utils/secureStorage/keychainPrefetch.js'
import {
  profileCheckpoint,
  profileReport,
} from '../../../../src/utils/startupProfiler.js'
import { isEnvTruthy } from '../../../../src/utils/envUtils.js'

import { createMainProgram } from './commander.js'
import { runModeDispatch } from './mode-dispatch.js'
import type { PendingHandles } from './preprocess-argv.js'
import { registerMcpCommands } from '../commands/mcp-commands.js'
import { registerMiscCommands } from '../commands/misc-commands.js'

/**
 * Attach the preAction hook that runs once per subcommand entry.
 * Handles the shared bootstrap shape: settings ready, sinks installed,
 * migrations applied, remote managed settings kicked off.
 */
function attachPreActionHook(program: CommanderCommand): void {
  program.hook('preAction', async thisCommand => {
    profileCheckpoint('preAction_start')
    // Await async subprocess loads started at module evaluation in main.tsx.
    // Nearly free — subprocesses complete during the ~135ms of imports.
    // Must resolve before init() which triggers the first settings read
    // (applySafeConfigEnvironmentVariables → getSettingsForSource('policySettings')
    // → isRemoteManagedSettingsEligible → sync keychain reads otherwise ~65ms).
    await Promise.all([
      ensureMdmSettingsLoaded(),
      ensureKeychainPrefetchCompleted(),
    ])
    profileCheckpoint('preAction_after_mdm')
    await init()
    profileCheckpoint('preAction_after_init')

    // process.title on Windows sets the console title directly; on POSIX,
    // terminal shell integration may mirror the process name to the tab.
    // After init() so settings.json env can also gate this (gh-4765).
    if (!isEnvTruthy(process.env.CLAUDE_CODE_DISABLE_TERMINAL_TITLE)) {
      process.title = 'claude'
    }

    // Attach logging sinks so subcommand handlers can use logEvent/logError.
    // Before PR #11106 logEvent dispatched directly; after, events queue until
    // a sink attaches. setup() attaches sinks for the default command, but
    // subcommands (doctor, mcp, plugin, auth) never call setup() and would
    // silently drop events on process.exit(). Both inits are idempotent.
    const { initSinks } = await import('../../../../src/utils/sinks.js')
    initSinks()
    profileCheckpoint('preAction_after_sinks')

    // gh-33508: --plugin-dir is a top-level program option. The default
    // action reads it from its own options destructure, but subcommands
    // (plugin list, plugin install, mcp *) have their own actions and
    // never see it. Wire it up here so getInlinePlugins() works everywhere.
    // thisCommand.opts() is typed {} here because this hook is attached
    // before .option('--plugin-dir', ...) in the chain — extra-typings
    // builds the type as options are added. Narrow with a runtime guard;
    // the collect accumulator + [] default guarantee string[] in practice.
    const pluginDir = thisCommand.getOptionValue('pluginDir')
    if (
      Array.isArray(pluginDir) &&
      pluginDir.length > 0 &&
      pluginDir.every((p: unknown) => typeof p === 'string')
    ) {
      setInlinePlugins(pluginDir as string[])
      clearPluginCache('preAction: --plugin-dir inline plugins')
    }

    runMigrations()
    profileCheckpoint('preAction_after_migrations')

    // Load remote managed settings for enterprise customers (non-blocking)
    // Fails open - if fetch fails, continues without remote settings
    // Settings are applied via hot-reload when they arrive
    // Must happen after init() to ensure config reading is allowed
    void loadRemoteManagedSettings()
    void loadPolicyLimits()

    profileCheckpoint('preAction_after_remote_settings')

    // Load settings sync (non-blocking, fail-open)
    // CLI: uploads local settings to remote (CCR download is handled by print.ts)
    if (feature('UPLOAD_USER_SETTINGS')) {
      void import('../../../../src/services/settingsSync/index.js').then(m =>
        m.uploadUserSettingsInBackground(),
      )
    }

    profileCheckpoint('preAction_after_settings_sync')
  })
}

/**
 * Attach the secondary feature-gated options that live outside the main
 * `createMainProgram()` option block. These are either ANT-only, feature
 * flagged, or bridge/teleport-specific.
 */
function attachSecondaryOptions(program: CommanderCommand): void {
  // Worktree flags
  program.option(
    '-w, --worktree [name]',
    'Create a new git worktree for this session (optionally specify a name)',
  )
  program.option(
    '--tmux',
    'Create a tmux session for the worktree (requires --worktree). Uses iTerm2 native panes when available; use --tmux=classic for traditional tmux.',
  )

  if (canUserConfigureAdvisor()) {
    program.addOption(
      new Option(
        '--advisor <model>',
        'Enable the server-side advisor tool with the specified model (alias or full ID).',
      ).hideHelp(),
    )
  }

  if (process.env.USER_TYPE === 'ant') {
    program.addOption(
      new Option(
        '--delegate-permissions',
        '[ANT-ONLY] Alias for --permission-mode auto.',
      ).implies({
        permissionMode: 'auto',
      }),
    )
    program.addOption(
      new Option(
        '--dangerously-skip-permissions-with-classifiers',
        '[ANT-ONLY] Deprecated alias for --permission-mode auto.',
      )
        .hideHelp()
        .implies({ permissionMode: 'auto' }),
    )
    program.addOption(
      new Option(
        '--afk',
        '[ANT-ONLY] Deprecated alias for --permission-mode auto.',
      )
        .hideHelp()
        .implies({ permissionMode: 'auto' }),
    )
    program.addOption(
      new Option(
        '--tasks [id]',
        '[ANT-ONLY] Tasks mode: watch for tasks and auto-process them. Optional id is used as both the task list ID and agent ID (defaults to "tasklist").',
      )
        .argParser(String)
        .hideHelp(),
    )
    program.option(
      '--agent-teams',
      '[ANT-ONLY] Force Claude to use multi-agent mode for solving problems',
      () => true,
    )
  }

  if (feature('TRANSCRIPT_CLASSIFIER')) {
    program.addOption(
      new Option('--enable-auto-mode', 'Opt in to auto mode').hideHelp(),
    )
  }

  if (feature('PROACTIVE') || feature('KAIROS')) {
    program.addOption(
      new Option('--proactive', 'Start in proactive autonomous mode'),
    )
  }

  if (feature('UDS_INBOX')) {
    program.addOption(
      new Option(
        '--messaging-socket-path <path>',
        'Unix domain socket path for the UDS messaging server (defaults to a tmp path)',
      ),
    )
  }

  if (feature('KAIROS') || feature('KAIROS_BRIEF')) {
    program.addOption(
      new Option(
        '--brief',
        'Enable SendUserMessage tool for agent-to-user communication',
      ),
    )
  }
  if (feature('KAIROS')) {
    program.addOption(
      new Option('--assistant', 'Force assistant mode (Agent SDK daemon use)').hideHelp(),
    )
  }
  if (feature('KAIROS') || feature('KAIROS_CHANNELS')) {
    program.addOption(
      new Option(
        '--channels <servers...>',
        'MCP servers whose channel notifications (inbound push) should register this session. Space-separated server names.',
      ).hideHelp(),
    )
    program.addOption(
      new Option(
        '--dangerously-load-development-channels <servers...>',
        'Load channel servers not on the approved allowlist. For local channel development only. Shows a confirmation dialog at startup.',
      ).hideHelp(),
    )
  }

  // Teammate identity options (set by leader when spawning tmux teammates)
  // These replace the CLAUDE_CODE_* environment variables
  program.addOption(new Option('--agent-id <id>', 'Teammate agent ID').hideHelp())
  program.addOption(new Option('--agent-name <name>', 'Teammate display name').hideHelp())
  program.addOption(
    new Option('--team-name <name>', 'Team name for swarm coordination').hideHelp(),
  )
  program.addOption(new Option('--agent-color <color>', 'Teammate UI color').hideHelp())
  program.addOption(
    new Option(
      '--plan-mode-required',
      'Require plan mode before implementation',
    ).hideHelp(),
  )
  program.addOption(
    new Option(
      '--parent-session-id <id>',
      'Parent session ID for analytics correlation',
    ).hideHelp(),
  )
  program.addOption(
    new Option(
      '--teammate-mode <mode>',
      'How to spawn teammates: "tmux", "in-process", or "auto"',
    )
      .choices(['auto', 'tmux', 'in-process'])
      .hideHelp(),
  )
  program.addOption(
    new Option(
      '--agent-type <type>',
      'Custom agent type for this teammate',
    ).hideHelp(),
  )

  // Enable SDK URL for all builds but hide from help
  program.addOption(
    new Option(
      '--sdk-url <url>',
      'Use remote WebSocket endpoint for SDK I/O streaming (only with -p and stream-json format)',
    ).hideHelp(),
  )

  // Enable teleport/remote flags for all builds but keep them undocumented until GA
  program.addOption(
    new Option(
      '--teleport [session]',
      'Resume a teleport session, optionally specify session ID',
    ).hideHelp(),
  )
  program.addOption(
    new Option(
      '--remote [description]',
      'Create a remote session with the given description',
    ).hideHelp(),
  )
  if (feature('BRIDGE_MODE')) {
    program.addOption(
      new Option(
        '--remote-control [name]',
        'Start an interactive session with Remote Control enabled (optionally named)',
      )
        .argParser(value => value || true)
        .hideHelp(),
    )
    program.addOption(
      new Option('--rc [name]', 'Alias for --remote-control')
        .argParser(value => value || true)
        .hideHelp(),
    )
  }

  if (feature('HARD_FAIL')) {
    program.addOption(
      new Option(
        '--hard-fail',
        'Crash on logError calls instead of silently logging',
      ).hideHelp(),
    )
  }
}

/**
 * Build, wire, and invoke the commander program. Mirrors the body of the
 * original `run()` in src/main.tsx.
 */
export async function runCliProgram(
  runtimeHandles: RuntimeHandles,
  pendings: PendingHandles,
): Promise<CommanderCommand> {
  profileCheckpoint('run_function_start')

  const program = createMainProgram()
  profileCheckpoint('run_commander_initialized')

  // Use preAction hook to run initialization only when executing a command,
  // not when displaying help. This avoids the need for env variable signaling.
  attachPreActionHook(program)

  program
    .action(async (prompt: unknown, options: unknown) => {
      await runModeDispatch(
        prompt as string | undefined,
        options as unknown as Record<string, unknown>,
        {
          runtimeHandles,
          pendingConnect: pendings.pendingConnect,
          pendingSSH: pendings.pendingSSH,
          pendingAssistantChat: pendings.pendingAssistantChat,
        },
      )
    })
    .version(`${MACRO.VERSION} (Claude Code)`, '-v, --version', 'Output the version number')

  attachSecondaryOptions(program)

  profileCheckpoint('run_main_options_built')

  // -p/--print mode: skip subcommand registration. The 52 subcommands
  // (mcp, auth, plugin, skill, task, config, doctor, update, etc.) are
  // never dispatched in print mode — commander routes the prompt to the
  // default action. The subcommand registration path was measured at ~65ms
  // on baseline — mostly the isBridgeEnabled() call (25ms settings Zod parse
  // + 40ms sync keychain subprocess), both hidden by the try/catch that
  // always returns false before enableConfigs(). cc:// URLs are rewritten to
  // `open` at main() preprocess-argv BEFORE this runs, so argv check is safe here.
  const isPrintMode =
    process.argv.includes('-p') || process.argv.includes('--print')
  const isCcUrl = process.argv.some(
    a => a.startsWith('cc://') || a.startsWith('cc+unix://'),
  )
  if (isPrintMode && !isCcUrl) {
    profileCheckpoint('run_before_parse')
    await program.parseAsync(process.argv)
    profileCheckpoint('run_after_parse')
    return program
  }

  // claude mcp + server + ssh + open (extracted to @claude-code/cli)
  registerMcpCommands(program, { pendingConnect: pendings.pendingConnect })

  // claude auth/plugin/setup-token/agents/auto-mode/remote-control/assistant/doctor/up/rollback/install/log/error/export/task/completion (extracted to @claude-code/cli)
  registerMiscCommands(program)

  profileCheckpoint('run_before_parse')
  await program.parseAsync(process.argv)
  profileCheckpoint('run_after_parse')

  // Record final checkpoint for total_time calculation
  profileCheckpoint('main_after_run')

  // Log startup perf to Statsig (sampled) and output detailed report if enabled
  profileReport()

  return program
}
