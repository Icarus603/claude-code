import type { Command } from '@commander-js/extra-typings'
import { Option } from '@commander-js/extra-typings'
import { feature } from 'bun:bundle'
import { bridgeMain } from '@claude-code/bridge'
import { createSortedHelpConfig } from '../entry/commander.js'
import {
  VALID_INSTALLABLE_SCOPES,
  VALID_UPDATE_SCOPES,
} from '../../../../src/services/plugins/pluginCliCommands.js'
import { getAutoModeEnabledStateIfCached } from '@claude-code/permission/permissionSetup'
import { getBaseRenderOptions } from '../../../../src/utils/renderOptions.js'
import { validateUuid } from '../../../../src/utils/uuid.js'
import { TASK_STATUSES } from '../../../../src/utils/tasks.js'

export function registerMiscCommands(program: Command): void {
  // claude auth

  const auth = program
    .command('auth')
    .description('Manage authentication')
    .configureHelp(createSortedHelpConfig())

  auth
    .command('login')
    .description('Sign in to your Anthropic account')
    .option('--email <email>', 'Pre-populate email address on the login page')
    .option('--sso', 'Force SSO login flow')
    .option(
      '--console',
      'Use Anthropic Console (API usage billing) instead of Claude subscription',
    )
    .option('--claudeai', 'Use Claude subscription (default)')
    .action(
      async ({
        email,
        sso,
        console: useConsole,
        claudeai,
      }: {
        email?: string
        sso?: boolean
        console?: boolean
        claudeai?: boolean
      }) => {
        const { authLogin } = await import('../../../../src/cli/handlers/auth.js')
        await authLogin({ email, sso, console: useConsole, claudeai })
      },
    )

  auth
    .command('status')
    .description('Show authentication status')
    .option('--json', 'Output as JSON (default)')
    .option('--text', 'Output as human-readable text')
    .action(async (opts: { json?: boolean; text?: boolean }) => {
      const { authStatus } = await import('../../../../src/cli/handlers/auth.js')
      await authStatus(opts)
    })

  auth
    .command('logout')
    .description('Log out from your Anthropic account')
    .action(async () => {
      const { authLogout } = await import('../../../../src/cli/handlers/auth.js')
      await authLogout()
    })

  // Hidden flag on all plugin/marketplace subcommands to target cowork_plugins.
  const coworkOption = () => new Option('--cowork', 'Use cowork_plugins directory').hideHelp()

  // claude plugin
  const pluginCmd = program
    .command('plugin')
    .alias('plugins')
    .description('Manage Claude Code plugins')
    .configureHelp(createSortedHelpConfig())

  pluginCmd
    .command('validate <path>')
    .description('Validate a plugin or marketplace manifest')
    .addOption(coworkOption())
    .action(async (manifestPath: string, options: { cowork?: boolean }) => {
      const { pluginValidateHandler } = await import('../../../../src/cli/handlers/plugins.js')
      await pluginValidateHandler(manifestPath, options)
    })

  pluginCmd
    .command('list')
    .description('List installed plugins')
    .option('--json', 'Output as JSON')
    .option('--available', 'Include available plugins from marketplaces (requires --json)')
    .addOption(coworkOption())
    .action(
      async (options: {
        json?: boolean
        available?: boolean
        cowork?: boolean
      }) => {
        const { pluginListHandler } = await import('../../../../src/cli/handlers/plugins.js')
        await pluginListHandler(options)
      },
    )

  // Marketplace subcommands
  const marketplaceCmd = pluginCmd
    .command('marketplace')
    .description('Manage Claude Code marketplaces')
    .configureHelp(createSortedHelpConfig())

  marketplaceCmd
    .command('add <source>')
    .description('Add a marketplace from a URL, path, or GitHub repo')
    .addOption(coworkOption())
    .option(
      '--sparse <paths...>',
      'Limit checkout to specific directories via git sparse-checkout (for monorepos). Example: --sparse .claude-plugin plugins',
    )
    .option(
      '--scope <scope>',
      'Where to declare the marketplace: user (default), project, or local',
    )
    .action(
      async (
        source: string,
        options: {
          cowork?: boolean
          sparse?: string[]
          scope?: string
        },
      ) => {
        const { marketplaceAddHandler } = await import('../../../../src/cli/handlers/plugins.js')
        await marketplaceAddHandler(source, options)
      },
    )

  marketplaceCmd
    .command('list')
    .description('List all configured marketplaces')
    .option('--json', 'Output as JSON')
    .addOption(coworkOption())
    .action(async (options: { json?: boolean; cowork?: boolean }) => {
      const { marketplaceListHandler } = await import('../../../../src/cli/handlers/plugins.js')
      await marketplaceListHandler(options)
    })

  marketplaceCmd
    .command('remove <name>')
    .alias('rm')
    .description('Remove a configured marketplace')
    .addOption(coworkOption())
    .action(async (name: string, options: { cowork?: boolean }) => {
      const { marketplaceRemoveHandler } = await import('../../../../src/cli/handlers/plugins.js')
      await marketplaceRemoveHandler(name, options)
    })

  marketplaceCmd
    .command('update [name]')
    .description('Update marketplace(s) from their source - updates all if no name specified')
    .addOption(coworkOption())
    .action(async (name: string | undefined, options: { cowork?: boolean }) => {
      const { marketplaceUpdateHandler } = await import('../../../../src/cli/handlers/plugins.js')
      await marketplaceUpdateHandler(name, options)
    })

  pluginCmd
    .command('install <plugin>')
    .alias('i')
    .description(
      'Install a plugin from available marketplaces (use plugin@marketplace for specific marketplace)',
    )
    .option('-s, --scope <scope>', 'Installation scope: user, project, or local', 'user')
    .addOption(coworkOption())
    .action(async (plugin: string, options: { scope?: string; cowork?: boolean }) => {
      const { pluginInstallHandler } = await import('../../../../src/cli/handlers/plugins.js')
      await pluginInstallHandler(plugin, options)
    })

  pluginCmd
    .command('uninstall <plugin>')
    .alias('remove')
    .alias('rm')
    .description('Uninstall an installed plugin')
    .option('-s, --scope <scope>', 'Uninstall from scope: user, project, or local', 'user')
    .option(
      '--keep-data',
      "Preserve the plugin's persistent data directory (~/.claude/plugins/data/{id}/)",
    )
    .addOption(coworkOption())
    .action(
      async (
        plugin: string,
        options: {
          scope?: string
          cowork?: boolean
          keepData?: boolean
        },
      ) => {
        const { pluginUninstallHandler } = await import('../../../../src/cli/handlers/plugins.js')
        await pluginUninstallHandler(plugin, options)
      },
    )

  pluginCmd
    .command('enable <plugin>')
    .description('Enable a disabled plugin')
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${VALID_INSTALLABLE_SCOPES.join(', ')} (default: auto-detect)`,
    )
    .addOption(coworkOption())
    .action(async (plugin: string, options: { scope?: string; cowork?: boolean }) => {
      const { pluginEnableHandler } = await import('../../../../src/cli/handlers/plugins.js')
      await pluginEnableHandler(plugin, options)
    })

  pluginCmd
    .command('disable [plugin]')
    .description('Disable an enabled plugin')
    .option('-a, --all', 'Disable all enabled plugins')
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${VALID_INSTALLABLE_SCOPES.join(', ')} (default: auto-detect)`,
    )
    .addOption(coworkOption())
    .action(
      async (
        plugin: string | undefined,
        options: { scope?: string; cowork?: boolean; all?: boolean },
      ) => {
        const { pluginDisableHandler } = await import('../../../../src/cli/handlers/plugins.js')
        await pluginDisableHandler(plugin, options)
      },
    )

  pluginCmd
    .command('update <plugin>')
    .description('Update a plugin to the latest version (restart required to apply)')
    .option(
      '-s, --scope <scope>',
      `Installation scope: ${VALID_UPDATE_SCOPES.join(', ')} (default: user)`,
    )
    .addOption(coworkOption())
    .action(async (plugin: string, options: { scope?: string; cowork?: boolean }) => {
      const { pluginUpdateHandler } = await import('../../../../src/cli/handlers/plugins.js')
      await pluginUpdateHandler(plugin, options)
    })

  // claude setup-token
  program
    .command('setup-token')
    .description('Set up a long-lived authentication token (requires Claude subscription)')
    .action(async () => {
      const [{ setupTokenHandler }, { createRoot }] = await Promise.all([
        import('../../../../src/cli/handlers/util.js'),
        import('@anthropic/ink'),
      ])
      const root = await createRoot(getBaseRenderOptions(false))
      await setupTokenHandler(root)
    })

  // claude agents
  program
    .command('agents')
    .description('List configured agents')
    .option(
      '--setting-sources <sources>',
      'Comma-separated list of setting sources to load (user, project, local).',
    )
    .action(async () => {
      const { agentsHandler } = await import('../../../../src/cli/handlers/agents.js')
      await agentsHandler()
      process.exit(0)
    })

  if (feature('TRANSCRIPT_CLASSIFIER')) {
    // Skip when tengu_auto_mode_config.enabled === 'disabled' (circuit breaker).
    // Reads from disk cache — GrowthBook isn't initialized at registration time.
    if (getAutoModeEnabledStateIfCached() !== 'disabled') {
      const autoModeCmd = program
        .command('auto-mode')
        .description('Inspect auto mode classifier configuration')

      autoModeCmd
        .command('defaults')
        .description('Print the default auto mode environment, allow, and deny rules as JSON')
        .action(async () => {
          const { autoModeDefaultsHandler } = await import(
            '../../../../src/cli/handlers/autoMode.js'
          )
          autoModeDefaultsHandler()
          process.exit(0)
        })

      autoModeCmd
        .command('config')
        .description(
          'Print the effective auto mode config as JSON: your settings where set, defaults otherwise',
        )
        .action(async () => {
          const { autoModeConfigHandler } = await import(
            '../../../../src/cli/handlers/autoMode.js'
          )
          autoModeConfigHandler()
          process.exit(0)
        })

      autoModeCmd
        .command('critique')
        .description('Get AI feedback on your custom auto mode rules')
        .option('--model <model>', 'Override which model is used')
        .action(async (options) => {
          const { autoModeCritiqueHandler } = await import(
            '../../../../src/cli/handlers/autoMode.js'
          )
          await autoModeCritiqueHandler(options)
          process.exit()
        })
    }
  }

  // Remote Control command — connect local environment to claude.ai/code.
  // The actual command is intercepted by the fast-path in cli.tsx before
  // Commander.js runs, so this registration exists only for help output.
  if (feature('BRIDGE_MODE')) {
    program
      .command('remote-control', { hidden: true })
      .alias('rc')
      .description(
        'Connect your local environment for remote-control sessions via claude.ai/code',
      )
      .action(async () => {
        // Unreachable — cli.tsx fast-path handles this command before main.tsx loads.
        await bridgeMain(process.argv.slice(3))
      })
  }

  if (feature('KAIROS')) {
    program
      .command('assistant [sessionId]')
      .description(
        'Attach the REPL as a client to a running bridge session. Discovers sessions via API if no sessionId given.',
      )
      .action(() => {
        process.stderr.write(
          'Usage: claude assistant [sessionId]\n\n' +
            'Attach the REPL as a viewer client to a running bridge session.\n' +
            'Omit sessionId to discover and pick from available sessions.\n',
        )
        process.exit(1)
      })
  }

  // claude doctor
  program
    .command('doctor')
    .description(
      'Check the health of your Claude Code auto-updater. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async () => {
      const [{ doctorHandler }, { createRoot }] = await Promise.all([
        import('../../../../src/cli/handlers/util.js'),
        import('@anthropic/ink'),
      ])
      const root = await createRoot(getBaseRenderOptions(false))
      await doctorHandler(root)
    })

  // claude up — ant-only
  if (process.env.USER_TYPE === 'ant') {
    program
      .command('up')
      .description(
        '[ANT-ONLY] Initialize or upgrade the local dev environment using the "# claude up" section of the nearest CLAUDE.md',
      )
      .action(async () => {
        const { up } = await import('../../../../src/cli/up.js')
        await up()
      })
  }

  // claude rollback — ant-only
  if (process.env.USER_TYPE === 'ant') {
    program
      .command('rollback [target]')
      .description(
        '[ANT-ONLY] Roll back to a previous release\n\nExamples:\n  claude rollback                                    Go 1 version back from current\n  claude rollback 3                                  Go 3 versions back from current\n  claude rollback 2.0.73-dev.20251217.t190658        Roll back to a specific version',
      )
      .option('-l, --list', 'List recent published versions with ages')
      .option('--dry-run', 'Show what would be installed without installing')
      .option(
        '--safe',
        'Roll back to the server-pinned safe version (set by oncall during incidents)',
      )
      .action(
        async (
          target?: string,
          options?: {
            list?: boolean
            dryRun?: boolean
            safe?: boolean
          },
        ) => {
          const { rollback } = await import('../../../../src/cli/rollback.js')
          await rollback(target, options)
        },
      )
  }

  // claude install
  program
    .command('install [target]')
    .description(
      'Install Claude Code native build. Use [target] to specify version (stable, latest, or specific version)',
    )
    .option('--force', 'Force installation even if already installed')
    .action(async (target: string | undefined, options: { force?: boolean }) => {
      const { installHandler } = await import('../../../../src/cli/handlers/util.js')
      await installHandler(target, options)
    })

  // ant-only commands
  if (process.env.USER_TYPE === 'ant') {
    const validateLogId = (value: string) => {
      const maybeSessionId = validateUuid(value)
      if (maybeSessionId) return maybeSessionId
      return Number(value)
    }

    program
      .command('log')
      .description('[ANT-ONLY] Manage conversation logs.')
      .argument(
        '[number|sessionId]',
        'A number (0, 1, 2, etc.) to display a specific log, or the sesssion ID (uuid) of a log',
        validateLogId,
      )
      .action(async (logId: string | number | undefined) => {
        const { logHandler } = await import('../../../../src/cli/handlers/ant.js')
        await logHandler(logId)
      })

    program
      .command('error')
      .description(
        '[ANT-ONLY] View error logs. Optionally provide a number (0, -1, -2, etc.) to display a specific log.',
      )
      .argument('[number]', 'A number (0, 1, 2, etc.) to display a specific log', parseInt)
      .action(async (number: number | undefined) => {
        const { errorHandler } = await import('../../../../src/cli/handlers/ant.js')
        await errorHandler(number)
      })

    program
      .command('export')
      .description('[ANT-ONLY] Export a conversation to a text file.')
      .usage('<source> <outputFile>')
      .argument(
        '<source>',
        'Session ID, log index (0, 1, 2...), or path to a .json/.jsonl log file',
      )
      .argument('<outputFile>', 'Output file path for the exported text')
      .addHelpText(
        'after',
        `
Examples:
  $ claude export 0 conversation.txt                Export conversation at log index 0
  $ claude export <uuid> conversation.txt           Export conversation by session ID
  $ claude export input.json output.txt             Render JSON log file to text
  $ claude export <uuid>.jsonl output.txt           Render JSONL session file to text`,
      )
      .action(async (source: string, outputFile: string) => {
        const { exportHandler } = await import('../../../../src/cli/handlers/ant.js')
        await exportHandler(source, outputFile)
      })

    if (process.env.USER_TYPE === 'ant') {
      const taskCmd = program
        .command('task')
        .description('[ANT-ONLY] Manage task list tasks')

      taskCmd
        .command('create <subject>')
        .description('Create a new task')
        .option('-d, --description <text>', 'Task description')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(
          async (subject: string, opts: { description?: string; list?: string }) => {
            const { taskCreateHandler } = await import('../../../../src/cli/handlers/ant.js')
            await taskCreateHandler(subject, opts)
          },
        )

      taskCmd
        .command('list')
        .description('List all tasks')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .option('--pending', 'Show only pending tasks')
        .option('--json', 'Output as JSON')
        .action(
          async (opts: {
            list?: string
            pending?: boolean
            json?: boolean
          }) => {
            const { taskListHandler } = await import('../../../../src/cli/handlers/ant.js')
            await taskListHandler(opts)
          },
        )

      taskCmd
        .command('get <id>')
        .description('Get details of a task')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(async (id: string, opts: { list?: string }) => {
          const { taskGetHandler } = await import('../../../../src/cli/handlers/ant.js')
          await taskGetHandler(id, opts)
        })

      taskCmd
        .command('update <id>')
        .description('Update a task')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .option('-s, --status <status>', `Set status (${TASK_STATUSES.join(', ')})`)
        .option('--subject <text>', 'Update subject')
        .option('-d, --description <text>', 'Update description')
        .option('--owner <agentId>', 'Set owner')
        .option('--clear-owner', 'Clear owner')
        .action(
          async (
            id: string,
            opts: {
              list?: string
              status?: string
              subject?: string
              description?: string
              owner?: string
              clearOwner?: boolean
            },
          ) => {
            const { taskUpdateHandler } = await import('../../../../src/cli/handlers/ant.js')
            await taskUpdateHandler(id, opts)
          },
        )

      taskCmd
        .command('dir')
        .description('Show the tasks directory path')
        .option('-l, --list <id>', 'Task list ID (defaults to "tasklist")')
        .action(async (opts: { list?: string }) => {
          const { taskDirHandler } = await import('../../../../src/cli/handlers/ant.js')
          await taskDirHandler(opts)
        })
    }

    program
      .command('completion <shell>', { hidden: true })
      .description('Generate shell completion script (bash, zsh, or fish)')
      .option('--output <file>', 'Write completion script directly to a file instead of stdout')
      .action(async (shell: string, opts: { output?: string }) => {
        const { completionHandler } = await import('../../../../src/cli/handlers/ant.js')
        await completionHandler(shell, opts, program)
      })
  }
}
