/**
 * `claude project ...` subcommands — byte-for-byte port of ant v2.1.136
 *   - `ni3` → purgeProjectHandler (main orchestrator)
 *   - `SnK` → printPurgePlan (header + items + warnings)
 *   - `xnK` → formatPurgeItem (single line)
 *   - `EnK` → confirmYesNo (readline yes/no)
 *   - `Fi3` → pickProjectInteractive (currently inert — CLI uses cwd
 *             fallback; the Ink picker is deferred to a future port)
 *
 * The handler keeps three modes ant supports:
 *   1. --all  : collectAllProjectsPurgeItems then confirm + delete every item
 *   2. -i     : per-item picker with Delete / Skip / All-from-here / Abort
 *   3. default: collect then bulk confirm + delete
 *
 * --dry-run prints the plan and exits without confirmation.
 */
import type { Command } from '@commander-js/extra-typings'
import { createInterface } from 'node:readline'
import { resolve as pathResolve } from 'node:path'
import { createSortedHelpConfig } from '../entry/commander.js'
import {
  collectAllProjectsPurgeItems,
  collectProjectPurgeItems,
  executePurgeItem,
  type PurgeItem,
  type PurgePlan,
} from '@claude-code/storage/projectPurge.js'
import { getClaudeConfigHomeDir } from '@claude-code/config/env/utils'

interface PurgeOptions {
  dryRun?: boolean
  yes?: boolean
  interactive?: boolean
  all?: boolean
}

/**
 * Ant `EnK` — yes/no prompt against stdin/stdout. Lowercase y/yes only.
 */
async function confirmYesNo(question: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => {
    rl.question(`${question} [y/N] `, answer => {
      rl.close()
      const trimmed = answer.trim().toLowerCase()
      res(trimmed === 'y' || trimmed === 'yes')
    })
  })
}

/**
 * Ant `xnK` — one-line item summary. Two-line output:
 *   {kind}:    {path}
 *              {reason}
 */
function formatPurgeItem(item: PurgeItem): string {
  let header: string
  switch (item.kind) {
    case 'config-key':
      header = `config: projects["${item.path}"]`
      break
    case 'history-lines':
      header = `filter: ${item.path}`
      break
    case 'file':
    case 'dir':
      header = `${item.kind}:    ${item.path}`
      break
  }
  return `${header}\n           ${item.reason}`
}

/** Ant `SnK` — print the plan + warnings without prompting. */
function printPurgePlan(title: string, plan: PurgePlan): void {
  process.stdout.write(`\nPurge plan for ${title}:\n\n`)
  for (const item of plan.items) {
    process.stdout.write(`  ${formatPurgeItem(item)}\n`)
  }
  if (plan.warnings.length > 0) {
    process.stdout.write('\n')
    for (const warn of plan.warnings) {
      process.stdout.write(`! ${warn}\n`)
    }
  }
}

/**
 * Ant `ni3` interactive-mode inner loop — four options per item.
 * Returns the count actually deleted.
 */
async function runInteractive(plan: PurgePlan): Promise<number> {
  let deletedCount = 0
  let deleteAllRemaining = false
  for (let i = 0; i < plan.items.length; i++) {
    const item = plan.items[i]!
    let choice: 'delete' | 'skip' | 'all' | 'abort' = 'delete'
    if (!deleteAllRemaining) {
      choice = await promptItemChoice(plan, i, item)
    }
    if (choice === 'abort') {
      process.stdout.write(
        `Aborted. ${deletedCount} item(s) deleted.\n`,
      )
      return deletedCount
    }
    if (choice === 'skip') continue
    if (choice === 'all') deleteAllRemaining = true
    try {
      await executePurgeItem(item)
      deletedCount++
    } catch {
      // best-effort per ant
    }
  }
  return deletedCount
}

/**
 * Simple readline-based picker. Ant uses an Ink-rendered `Q6` select
 * component (`CnK`); the headless `claude project purge -i` path here
 * falls back to single-character readline. The choice tag-space matches
 * ant 1:1 so the rest of the orchestration is unaffected.
 */
async function promptItemChoice(
  plan: PurgePlan,
  index: number,
  item: PurgeItem,
): Promise<'delete' | 'skip' | 'all' | 'abort'> {
  const prompt = `[${index + 1}/${plan.items.length}] ${formatPurgeItem(item)}\n  [d]elete / [s]kip / [a]ll remaining / a[b]ort? `
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise(res => {
    rl.question(prompt, answer => {
      rl.close()
      const ch = (answer.trim().toLowerCase() || 'd')[0]
      if (ch === 'd') res('delete')
      else if (ch === 's') res('skip')
      else if (ch === 'a') res('all')
      else res('abort')
    })
  })
}

/**
 * Ant `ni3` — `--all` branch.
 */
async function runAllProjectsPurge(options: PurgeOptions): Promise<void> {
  if (options.interactive) {
    process.stderr.write('Cannot use -i/--interactive with --all.\n')
    process.exit(1)
  }
  const plan = await collectAllProjectsPurgeItems()
  if (plan.items.length === 0) {
    process.stdout.write(
      `No Claude Code project state found under ${getClaudeConfigHomeDir()}.\n`,
    )
    return
  }
  printPurgePlan('all projects', plan)
  if (options.dryRun) {
    process.stdout.write(
      `\nDry run: ${plan.items.length} item(s) would be deleted.\n`,
    )
    return
  }
  if (!options.yes) {
    const ok = await confirmYesNo(
      `Delete ${plan.items.length} item(s) for ALL projects? This cannot be undone.`,
    )
    if (!ok) {
      process.stdout.write('Aborted.\n')
      return
    }
  }
  let removed = 0
  for (const item of plan.items) {
    try {
      await executePurgeItem(item)
      removed++
    } catch {
      // best-effort
    }
  }
  process.stdout.write(
    `Purged ${removed} item(s) across all projects.\n`,
  )
}

/**
 * Ant `ni3` — single-project branch.
 */
async function runSingleProjectPurge(
  pathArg: string | undefined,
  options: PurgeOptions,
): Promise<void> {
  const projectPath = pathResolve(pathArg ?? process.cwd())
  const plan = await collectProjectPurgeItems(projectPath)
  if (plan.items.length === 0) {
    process.stdout.write(
      `No Claude Code project state found for ${projectPath} under ${getClaudeConfigHomeDir()}.\n`,
    )
    return
  }
  printPurgePlan(projectPath, plan)
  if (options.dryRun) {
    process.stdout.write(
      `\nDry run: ${plan.items.length} item(s) would be deleted.\n`,
    )
    return
  }
  if (options.interactive) {
    const removed = await runInteractive(plan)
    process.stdout.write(
      `Purged ${removed}/${plan.items.length} item(s) for ${projectPath}.\n`,
    )
    return
  }
  if (!options.yes) {
    const ok = await confirmYesNo(
      `Delete ${plan.items.length} item(s) for ${projectPath}? This cannot be undone.`,
    )
    if (!ok) {
      process.stdout.write('Aborted.\n')
      return
    }
  }
  let removed = 0
  for (const item of plan.items) {
    try {
      await executePurgeItem(item)
      removed++
    } catch {
      // best-effort
    }
  }
  process.stdout.write(
    `Purged ${removed} item(s) for ${projectPath}.\n`,
  )
}

export function registerProjectCommands(program: Command): void {
  const project = program
    .command('project')
    .description('Manage Claude Code project state')
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions()

  project
    .command('purge')
    .description(
      'Delete all Claude Code state for a project (transcripts, tasks, file history, config entry)',
    )
    .argument(
      '[path]',
      'Project absolute path (defaults to current directory)',
    )
    .option('--all', 'Purge state for every project (mutually exclusive with [path])')
    .option('--dry-run', 'List what would be deleted without deleting anything')
    .option('-y, --yes', 'Skip confirmation prompt')
    .option('-i, --interactive', 'Prompt for each item before deleting')
    .action(
      async (
        pathArg: string | undefined,
        options: PurgeOptions,
      ): Promise<void> => {
        if (options.all) {
          if (pathArg) {
            process.stderr.write('Cannot specify both a path and --all.\n')
            process.exit(1)
          }
          await runAllProjectsPurge(options)
          return
        }
        await runSingleProjectPurge(pathArg, options)
      },
    )
}
