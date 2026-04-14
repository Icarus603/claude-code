import type { Command } from '@commander-js/extra-typings'
import { feature } from 'bun:bundle'
import { isXaaEnabled } from '@claude-code/mcp-runtime'
import { createSortedHelpConfig } from '../entry/commander.js'
import { registerMcpAddCommand } from '../../../../src/commands/mcp/addCommand.js'
import { registerMcpXaaIdpCommand } from '../../../../src/commands/mcp/xaaIdpCommand.js'
import {
  getOriginalCwd,
  setOriginalCwd,
  setCwdState,
  setDirectConnectServerUrl,
} from '../../../../src/bootstrap/state.js'
import {
  createDirectConnectSession,
  DirectConnectError,
} from '../../../../src/server/createDirectConnectSession.js'

interface PendingConnect {
  url: string | undefined
  authToken: string | undefined
  dangerouslySkipPermissions: boolean
}

interface RegisterMcpCommandsDeps {
  pendingConnect?: PendingConnect
}

export function registerMcpCommands(
  program: Command,
  deps: RegisterMcpCommandsDeps = {},
): void {
  // claude mcp

  const mcp = program
    .command('mcp')
    .description('Configure and manage MCP servers')
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions()

  mcp
    .command('serve')
    .description('Start the Claude Code MCP server')
    .option('-d, --debug', 'Enable debug mode', () => true)
    .option('--verbose', 'Override verbose mode setting from config', () => true)
    .action(
      async ({
        debug,
        verbose,
      }: {
        debug?: boolean
        verbose?: boolean
      }) => {
        const { mcpServeHandler } = await import('../../../../src/cli/handlers/mcp.js')
        await mcpServeHandler({ debug, verbose })
      },
    )

  // Register the mcp add subcommand (extracted for testability)
  registerMcpAddCommand(mcp)

  if (isXaaEnabled()) {
    registerMcpXaaIdpCommand(mcp)
  }

  mcp
    .command('remove <name>')
    .description('Remove an MCP server')
    .option(
      '-s, --scope <scope>',
      'Configuration scope (local, user, or project) - if not specified, removes from whichever scope it exists in',
    )
    .action(async (name: string, options: { scope?: string }) => {
      const { mcpRemoveHandler } = await import('../../../../src/cli/handlers/mcp.js')
      await mcpRemoveHandler(name, options)
    })

  mcp
    .command('list')
    .description(
      'List configured MCP servers. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async () => {
      const { mcpListHandler } = await import('../../../../src/cli/handlers/mcp.js')
      await mcpListHandler()
    })

  mcp
    .command('get <name>')
    .description(
      'Get details about an MCP server. Note: The workspace trust dialog is skipped and stdio servers from .mcp.json are spawned for health checks. Only use this command in directories you trust.',
    )
    .action(async (name: string) => {
      const { mcpGetHandler } = await import('../../../../src/cli/handlers/mcp.js')
      await mcpGetHandler(name)
    })

  mcp
    .command('add-json <name> <json>')
    .description('Add an MCP server (stdio or SSE) with a JSON string')
    .option('-s, --scope <scope>', 'Configuration scope (local, user, or project)', 'local')
    .option(
      '--client-secret',
      'Prompt for OAuth client secret (or set MCP_CLIENT_SECRET env var)',
    )
    .action(
      async (
        name: string,
        json: string,
        options: { scope?: string; clientSecret?: true },
      ) => {
        const { mcpAddJsonHandler } = await import('../../../../src/cli/handlers/mcp.js')
        await mcpAddJsonHandler(name, json, options)
      },
    )

  mcp
    .command('add-from-claude-desktop')
    .description('Import MCP servers from Claude Desktop (Mac and WSL only)')
    .option('-s, --scope <scope>', 'Configuration scope (local, user, or project)', 'local')
    .action(async (options: { scope?: string }) => {
      const { mcpAddFromDesktopHandler } = await import('../../../../src/cli/handlers/mcp.js')
      await mcpAddFromDesktopHandler(options)
    })

  mcp
    .command('reset-project-choices')
    .description(
      'Reset all approved and rejected project-scoped (.mcp.json) servers within this project',
    )
    .action(async () => {
      const { mcpResetChoicesHandler } = await import('../../../../src/cli/handlers/mcp.js')
      await mcpResetChoicesHandler()
    })

  // claude server
  if (feature('DIRECT_CONNECT')) {
    program
      .command('server')
      .description('Start a Claude Code session server')
      .option('--port <number>', 'HTTP port', '0')
      .option('--host <string>', 'Bind address', '0.0.0.0')
      .option('--auth-token <token>', 'Bearer token for auth')
      .option('--unix <path>', 'Listen on a unix domain socket')
      .option(
        '--workspace <dir>',
        'Default working directory for sessions that do not specify cwd',
      )
      .option(
        '--idle-timeout <ms>',
        'Idle timeout for detached sessions in ms (0 = never expire)',
        '600000',
      )
      .option('--max-sessions <n>', 'Maximum concurrent sessions (0 = unlimited)', '32')
      .action(
        async (opts: {
          port: string
          host: string
          authToken?: string
          unix?: string
          workspace?: string
          idleTimeout: string
          maxSessions: string
        }) => {
          const { randomBytes } = await import('crypto')
          const { startServer } = await import('../../../../src/server/server.js')
          const { SessionManager } = await import('../../../../src/server/sessionManager.js')
          const { DangerousBackend } = await import('../../../../src/server/backends/dangerousBackend.js')
          const { printBanner } = await import('../../../../src/server/serverBanner.js')
          const { createServerLogger } = await import('../../../../src/server/serverLog.js')
          const { writeServerLock, removeServerLock, probeRunningServer } = await import(
            '../../../../src/server/lockfile.js'
          )

          const existing = await probeRunningServer()
          if (existing) {
            process.stderr.write(
              `A claude server is already running (pid ${existing.pid}) at ${existing.httpUrl}\n`,
            )
            process.exit(1)
          }

          const authToken =
            opts.authToken ?? `sk-ant-cc-${randomBytes(16).toString('base64url')}`

          const config = {
            port: parseInt(opts.port, 10),
            host: opts.host,
            authToken,
            unix: opts.unix,
            workspace: opts.workspace,
            idleTimeoutMs: parseInt(opts.idleTimeout, 10),
            maxSessions: parseInt(opts.maxSessions, 10),
          }

          const backend = new DangerousBackend()
          const sessionManager = new SessionManager(backend, {
            idleTimeoutMs: config.idleTimeoutMs,
            maxSessions: config.maxSessions,
          })
          const logger = createServerLogger()

          const server = startServer(config, sessionManager, logger)
          const actualPort = server.port ?? config.port
          printBanner(config, authToken, actualPort)

          await writeServerLock({
            pid: process.pid,
            port: actualPort,
            host: config.host,
            httpUrl: config.unix
              ? `unix:${config.unix}`
              : `http://${config.host}:${actualPort}`,
            startedAt: Date.now(),
          })

          let shuttingDown = false
          const shutdown = async () => {
            if (shuttingDown) return
            shuttingDown = true
            // Stop accepting new connections before tearing down sessions.
            server.stop(true)
            await sessionManager.destroyAll()
            await removeServerLock()
            process.exit(0)
          }
          process.once('SIGINT', () => void shutdown())
          process.once('SIGTERM', () => void shutdown())
        },
      )
  }

  // `claude ssh <host> [dir]` — registered here only so --help shows it.
  // The actual interactive flow is handled by early argv rewriting in main()
  // (parallels the DIRECT_CONNECT/cc:// pattern above). If commander reaches
  // this action it means the argv rewrite didn't fire (e.g. user ran
  // `claude ssh` with no host) — just print usage.
  if (feature('SSH_REMOTE')) {
    program
      .command('ssh <host> [dir]')
      .description(
        'Run Claude Code on a remote host over SSH. Deploys the binary and ' +
          'tunnels API auth back through your local machine — no remote setup needed.',
      )
      .option('--permission-mode <mode>', 'Permission mode for the remote session')
      .option(
        '--dangerously-skip-permissions',
        'Skip all permission prompts on the remote (dangerous)',
      )
      .option(
        '--local',
        'e2e test mode — spawn the child CLI locally (skip ssh/deploy). ' +
          'Exercises the auth proxy and unix-socket plumbing without a remote host.',
      )
      .action(async () => {
        // Argv rewriting in main() should have consumed `ssh <host>` before
        // commander runs. Reaching here means host was missing or the
        // rewrite predicate didn't match.
        process.stderr.write(
          'Usage: claude ssh <user@host | ssh-config-alias> [dir]\n\n' +
            'Runs Claude Code on a remote Linux host. You don\'t need to install\n' +
            'anything on the remote or run `claude auth login` there — the binary is\n' +
            'deployed over SSH and API auth tunnels back through your local machine.\n',
        )
        process.exit(1)
      })
  }

  // claude connect — subcommand only handles -p (headless) mode.
  // Interactive mode (without -p) is handled by early argv rewriting in main()
  // which redirects to the main command with full TUI support.
  if (feature('DIRECT_CONNECT')) {
    program
      .command('open <cc-url>')
      .description('Connect to a Claude Code server (internal — use cc:// URLs)')
      .option('-p, --print [prompt]', 'Print mode (headless)')
      .option('--output-format <format>', 'Output format: text, json, stream-json', 'text')
      .action(
        async (
          ccUrl: string,
          opts: {
            print?: string | boolean
            outputFormat: string
          },
        ) => {
          const { parseConnectUrl } = await import('../../../../src/server/parseConnectUrl.js')
          const { serverUrl, authToken } = parseConnectUrl(ccUrl)

          let connectConfig
          try {
            const session = await createDirectConnectSession({
              serverUrl,
              authToken,
              cwd: getOriginalCwd(),
              dangerouslySkipPermissions: deps.pendingConnect?.dangerouslySkipPermissions,
            })
            if (session.workDir) {
              setOriginalCwd(session.workDir)
              setCwdState(session.workDir)
            }
            setDirectConnectServerUrl(serverUrl)
            connectConfig = session.config
          } catch (err) {
            // biome-ignore lint/suspicious/noConsole: intentional error output
            console.error(err instanceof DirectConnectError ? err.message : String(err))
            process.exit(1)
          }

          const { runConnectHeadless } = await import('../../../../src/server/connectHeadless.js')

          const prompt = typeof opts.print === 'string' ? opts.print : ''
          const interactive = opts.print === true
          await runConnectHeadless(connectConfig, prompt, opts.outputFormat, interactive)
        },
      )
  }
}
