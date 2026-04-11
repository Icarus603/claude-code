/**
 * Commander.js program factory extracted from src/main.tsx.
 * Provides the main CLI program with all options configured,
 * excluding the .action() handler and preAction hook (those
 * remain in main.tsx and are cut-E territory).
 *
 * Moved from src/main.tsx per V7 Phase 4 cut-B.
 */

import {
  Command as CommanderCommand,
  InvalidArgumentError,
  Option,
} from '@commander-js/extra-typings'
import { PERMISSION_MODES } from '@claude-code/permission/PermissionMode'

/**
 * Creates help configuration that sorts subcommands and options alphabetically.
 * Commander supports compareOptions at runtime but @commander-js/extra-typings
 * doesn't include it in the type definitions, so we use Object.assign to add it.
 */
export function createSortedHelpConfig(): {
  sortSubcommands: true
  sortOptions: true
} {
  const getOptionSortKey = (opt: Option): string =>
    opt.long?.replace(/^--/, '') ?? opt.short?.replace(/^-/, '') ?? ''
  return Object.assign({ sortSubcommands: true, sortOptions: true } as const, {
    compareOptions: (a: Option, b: Option) =>
      getOptionSortKey(a).localeCompare(getOptionSortKey(b)),
  })
}

/**
 * Creates and configures the main Commander program with all CLI options.
 * Returns the program without .action() or preAction hook attached —
 * those are wired in main.tsx's run() function.
 */
export function createMainProgram(): CommanderCommand {
  return new CommanderCommand()
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions()
    .name('claude')
    .description(
      `Claude Code - starts an interactive session by default, use -p/--print for non-interactive output`,
    )
    .argument('[prompt]', 'Your prompt', String)
    // Subcommands inherit helpOption via commander's copyInheritedSettings —
    // setting it once here covers mcp, plugin, auth, and all other subcommands.
    .helpOption('-h, --help', 'Display help for command')
    .option(
      '-d, --debug [filter]',
      'Enable debug mode with optional category filtering (e.g., "api,hooks" or "!1p,!file")',
      (_value: string | true) => {
        // If value is provided, it will be the filter string
        // If not provided but flag is present, value will be true
        // The actual filtering is handled in debug.ts by parsing process.argv
        return true
      },
    )
    .addOption(
      new Option('--debug-to-stderr', 'Enable debug mode (to stderr)')
        .argParser(Boolean)
        .hideHelp(),
    )
    .option(
      '--debug-file <path>',
      'Write debug logs to a specific file path (implicitly enables debug mode)',
      () => true,
    )
    .option(
      '--verbose',
      'Override verbose mode setting from config',
      () => true,
    )
    .option(
      '-p, --print',
      'Print response and exit (useful for pipes). Note: The workspace trust dialog is skipped when Claude is run with the -p mode. Only use this flag in directories you trust.',
      () => true,
    )
    .option(
      '--bare',
      'Minimal mode: skip hooks, LSP, plugin sync, attribution, auto-memory, background prefetches, keychain reads, and CLAUDE.md auto-discovery. Sets CLAUDE_CODE_SIMPLE=1. Anthropic auth is strictly ANTHROPIC_API_KEY or apiKeyHelper via --settings (OAuth and keychain are never read). 3P providers (Bedrock/Vertex/Foundry) use their own credentials. Skills still resolve via /skill-name. Explicitly provide context via: --system-prompt[-file], --append-system-prompt[-file], --add-dir (CLAUDE.md dirs), --mcp-config, --settings, --agents, --plugin-dir.',
      () => true,
    )
    .addOption(
      new Option('--init', 'Run Setup hooks with init trigger, then continue').hideHelp(),
    )
    .addOption(
      new Option(
        '--init-only',
        'Run Setup and SessionStart:startup hooks, then exit',
      ).hideHelp(),
    )
    .addOption(
      new Option(
        '--maintenance',
        'Run Setup hooks with maintenance trigger, then continue',
      ).hideHelp(),
    )
    .addOption(
      new Option(
        '--output-format <format>',
        'Output format (only works with --print): "text" (default), "json" (single result), or "stream-json" (realtime streaming)',
      ).choices(['text', 'json', 'stream-json']),
    )
    .addOption(
      new Option(
        '--json-schema <schema>',
        'JSON Schema for structured output validation. ' +
          'Example: {"type":"object","properties":{"name":{"type":"string"}},"required":["name"]}',
      ).argParser(String),
    )
    .option(
      '--include-hook-events',
      'Include all hook lifecycle events in the output stream (only works with --output-format=stream-json)',
      () => true,
    )
    .option(
      '--include-partial-messages',
      'Include partial message chunks as they arrive (only works with --print and --output-format=stream-json)',
      () => true,
    )
    .addOption(
      new Option(
        '--input-format <format>',
        'Input format (only works with --print): "text" (default), or "stream-json" (realtime streaming input)',
      ).choices(['text', 'stream-json']),
    )
    .option(
      '--mcp-debug',
      '[DEPRECATED. Use --debug instead] Enable MCP debug mode (shows MCP server errors)',
      () => true,
    )
    .option(
      '--dangerously-skip-permissions',
      'Bypass all permission checks. Recommended only for sandboxes with no internet access.',
      () => true,
    )
    .option(
      '--allow-dangerously-skip-permissions',
      'Enable bypassing all permission checks as an option, without it being enabled by default. Recommended only for sandboxes with no internet access.',
      () => true,
    )
    .addOption(
      new Option('--thinking <mode>', 'Thinking mode: enabled (equivalent to adaptive), disabled')
        .choices(['enabled', 'adaptive', 'disabled'])
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--max-thinking-tokens <tokens>',
        '[DEPRECATED. Use --thinking instead for newer models] Maximum number of thinking tokens (only works with --print)',
      )
        .argParser(Number)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--max-turns <turns>',
        'Maximum number of agentic turns in non-interactive mode. This will early exit the conversation after the specified number of turns. (only works with --print)',
      )
        .argParser(Number)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--max-budget-usd <amount>',
        'Maximum dollar amount to spend on API calls (only works with --print)',
      ).argParser((value) => {
        const amount = Number(value)
        if (isNaN(amount) || amount <= 0) {
          throw new Error('--max-budget-usd must be a positive number greater than 0')
        }
        return amount
      }),
    )
    .addOption(
      new Option(
        '--task-budget <tokens>',
        'API-side task budget in tokens (output_config.task_budget)',
      )
        .argParser((value) => {
          const tokens = Number(value)
          if (isNaN(tokens) || tokens <= 0 || !Number.isInteger(tokens)) {
            throw new Error('--task-budget must be a positive integer')
          }
          return tokens
        })
        .hideHelp(),
    )
    .option(
      '--replay-user-messages',
      'Re-emit user messages from stdin back on stdout for acknowledgment (only works with --input-format=stream-json and --output-format=stream-json)',
      () => true,
    )
    .addOption(
      new Option('--enable-auth-status', 'Enable auth status messages in SDK mode')
        .default(false)
        .hideHelp(),
    )
    .option(
      '--allowedTools, --allowed-tools <tools...>',
      'Comma or space-separated list of tool names to allow (e.g. "Bash(git:*) Edit")',
    )
    .option(
      '--tools <tools...>',
      'Specify the list of available tools from the built-in set. Use "" to disable all tools, "default" to use all tools, or specify tool names (e.g. "Bash,Edit,Read").',
    )
    .option(
      '--disallowedTools, --disallowed-tools <tools...>',
      'Comma or space-separated list of tool names to deny (e.g. "Bash(git:*) Edit")',
    )
    .option(
      '--mcp-config <configs...>',
      'Load MCP servers from JSON files or strings (space-separated)',
    )
    .addOption(
      new Option(
        '--permission-prompt-tool <tool>',
        'MCP tool to use for permission prompts (only works with --print)',
      )
        .argParser(String)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--system-prompt <prompt>',
        'System prompt to use for the session',
      ).argParser(String),
    )
    .addOption(
      new Option('--system-prompt-file <file>', 'Read system prompt from a file')
        .argParser(String)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--append-system-prompt <prompt>',
        'Append a system prompt to the default system prompt',
      ).argParser(String),
    )
    .addOption(
      new Option(
        '--append-system-prompt-file <file>',
        'Read system prompt from a file and append to the default system prompt',
      )
        .argParser(String)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--permission-mode <mode>',
        'Permission mode to use for the session',
      )
        .argParser(String)
        .choices(PERMISSION_MODES),
    )
    .option(
      '-c, --continue',
      'Continue the most recent conversation in the current directory',
      () => true,
    )
    .option(
      '-r, --resume [value]',
      'Resume a conversation by session ID, or open interactive picker with optional search term',
      (value) => value || true,
    )
    .option(
      '--fork-session',
      'When resuming, create a new session ID instead of reusing the original (use with --resume or --continue)',
      () => true,
    )
    .addOption(
      new Option(
        '--prefill <text>',
        'Pre-fill the prompt input with text without submitting it',
      ).hideHelp(),
    )
    .addOption(
      new Option(
        '--deep-link-origin',
        'Signal that this session was launched from a deep link',
      ).hideHelp(),
    )
    .addOption(
      new Option(
        '--deep-link-repo <slug>',
        'Repo slug the deep link ?repo= parameter resolved to the current cwd',
      ).hideHelp(),
    )
    .addOption(
      new Option(
        '--deep-link-last-fetch <ms>',
        'FETCH_HEAD mtime in epoch ms, precomputed by the deep link trampoline',
      )
        .argParser((v) => {
          const n = Number(v)
          return Number.isFinite(n) ? n : undefined
        })
        .hideHelp(),
    )
    .option(
      '--from-pr [value]',
      'Resume a session linked to a PR by PR number/URL, or open interactive picker with optional search term',
      (value) => value || true,
    )
    .option(
      '--no-session-persistence',
      'Disable session persistence - sessions will not be saved to disk and cannot be resumed (only works with --print)',
    )
    .addOption(
      new Option(
        '--resume-session-at <message id>',
        'When resuming, only messages up to and including the assistant message with <message.id> (use with --resume in print mode)',
      )
        .argParser(String)
        .hideHelp(),
    )
    .addOption(
      new Option(
        '--rewind-files <user-message-id>',
        'Restore files to state at the specified user message and exit (requires --resume)',
      ).hideHelp(),
    )
    // @[MODEL LAUNCH]: Update the example model ID in the --model help text.
    .option(
      '--model <model>',
      `Model for the current session. Provide an alias for the latest model (e.g. 'sonnet' or 'opus') or a model's full name (e.g. 'claude-sonnet-4-6').`,
    )
    .addOption(
      new Option(
        '--effort <level>',
        `Effort level for the current session (low, medium, high, max)`,
      ).argParser((rawValue: string) => {
        const value = rawValue.toLowerCase()
        const allowed = ['low', 'medium', 'high', 'max']
        if (!allowed.includes(value)) {
          throw new InvalidArgumentError(`It must be one of: ${allowed.join(', ')}`)
        }
        return value
      }),
    )
    .option('--agent <agent>', `Agent for the current session. Overrides the 'agent' setting.`)
    .option('--betas <betas...>', 'Beta headers to include in API requests (API key users only)')
    .option(
      '--fallback-model <model>',
      'Enable automatic fallback to specified model when default model is overloaded (only works with --print)',
    )
    .addOption(
      new Option(
        '--workload <tag>',
        'Workload tag for billing-header attribution (cc_workload). Process-scoped; set by SDK daemon callers that spawn subprocesses for cron work. (only works with --print)',
      ).hideHelp(),
    )
    .option(
      '--settings <file-or-json>',
      'Path to a settings JSON file or a JSON string to load additional settings from',
    )
    .option('--add-dir <directories...>', 'Additional directories to allow tool access to')
    .option(
      '--ide',
      'Automatically connect to IDE on startup if exactly one valid IDE is available',
      () => true,
    )
    .option(
      '--strict-mcp-config',
      'Only use MCP servers from --mcp-config, ignoring all other MCP configurations',
      () => true,
    )
    .option(
      '--session-id <uuid>',
      'Use a specific session ID for the conversation (must be a valid UUID)',
    )
    .option(
      '-n, --name <name>',
      'Set a display name for this session (shown in /resume and terminal title)',
    )
    .option(
      '--agents <json>',
      'JSON object defining custom agents (e.g. \'{"reviewer": {"description": "Reviews code", "prompt": "You are a code reviewer"}}\')',
    )
    .option(
      '--setting-sources <sources>',
      'Comma-separated list of setting sources to load (user, project, local).',
    )
    // gh-33508: <paths...> (variadic) consumed everything until the next
    // --flag. `claude --plugin-dir /path mcp add --transport http` swallowed
    // `mcp` and `add` as paths, then choked on --transport as an unknown
    // top-level option. Single-value + collect accumulator means each
    // --plugin-dir takes exactly one arg; repeat the flag for multiple dirs.
    .option(
      '--plugin-dir <path>',
      'Load plugins from a directory for this session only (repeatable: --plugin-dir A --plugin-dir B)',
      (val: string, prev: string[]) => [...prev, val],
      [] as string[],
    )
    .option('--disable-slash-commands', 'Disable all skills', () => true)
    .option('--chrome', 'Enable Claude in Chrome integration')
    .option('--no-chrome', 'Disable Claude in Chrome integration')
    .option(
      '--file <specs...>',
      'File resources to download at startup. Format: file_id:relative_path (e.g., --file file_abc:doc.txt file_def:img.png)',
    )
}
