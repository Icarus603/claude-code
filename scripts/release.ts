#!/usr/bin/env bun
/**
 * One-command release for ccb.
 *
 * Cuts a tag at the current main HEAD and pushes it. release.yml takes it
 * from there (5 platforms × build → SHA256 sidecar → upload → publish).
 *
 * Usage:
 *   bun run release v26.5.30           tag, push, publish
 *   bun run release v26.5.30 --dry     report only, no git/network mutation
 *
 * Why no quality gate inside this script:
 *   ci.yml + pre-push hook already gate every commit on main with the full
 *   lint/test/build/doctor:arch/smoke matrix. A tag pushed to origin
 *   triggers release.yml which only builds — by design, no test, no doctor.
 *   See feedback_release_pipeline_chase_root_causes.md for the v26.5.18
 *   series cautionary tale that locked this in.
 *
 *   This script's job is the irreversible plumbing layer: refuse to tag
 *   off a SHA the user can't possibly have intended (dirty tree, branch
 *   ahead of origin, last release still failing on GHA, etc.) and produce
 *   a clear roll-forward instruction when something does fail.
 *
 * Pre-flight (any FAIL aborts before touching git tag/push):
 *   1. tag matches /^v[0-9]+\.[0-9]+\.[0-9]+$/                — CalVer shape
 *   2. tag does not exist locally or on origin                — no silent retag
 *   3. working tree is clean                                  — no half-staged WIP
 *   4. branch is main (override: --force-branch)              — single release line
 *   5. branch has an upstream                                 — git push has a target
 *   6. local HEAD == origin/<branch>'s tip                    — tag the SHA CI proved
 *   7. last release.yml run state                             — warn if previous failed/in-flight
 *   8. stale draft releases                                   — warn so user can clean up
 *
 * Order of irreversible operations:
 *   tag → push tag.
 *   No "branch push" step — pre-flight #6 enforces HEAD == origin/main, so
 *   anything pushable is already pushed. If the branch is ahead, the right
 *   move is `git push origin <branch>` first (then ci.yml decides whether
 *   that SHA is releasable), not silently push it as part of release.
 *
 * Failure rollback:
 *   `git push origin <tag>` failure deletes the local tag and prints the
 *   exact retry command. No partial state is published — origin gets
 *   either a fully-pushed tag or nothing.
 */

import { spawnSync } from 'node:child_process'

interface ProcResult {
  code: number
  out: string
  err: string
}

function run(cmd: string, args: string[]): ProcResult {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return {
    code: r.status ?? 1,
    out: r.stdout?.trim() ?? '',
    err: r.stderr?.trim() ?? '',
  }
}

function fatal(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function warn(msg: string): void {
  console.warn(`⚠ ${msg}`)
}

function ok(msg: string): void {
  console.log(`✓ ${msg}`)
}

function info(msg: string): void {
  console.log(`→ ${msg}`)
}

interface Args {
  tag: string
  forceBranch: boolean
  dryRun: boolean
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const tag = argv.find(a => !a.startsWith('--'))
  if (!tag) {
    console.error('Usage: bun run release <tag> [--force-branch] [--dry]')
    console.error('       (e.g. bun run release v26.5.30)')
    process.exit(1)
  }
  return {
    tag,
    forceBranch: argv.includes('--force-branch'),
    dryRun: argv.includes('--dry') || argv.includes('--dry-run'),
  }
}

// ─── Pre-flight checks ─────────────────────────────────────────────────────

function checkTagShape(tag: string): void {
  // CalVer: v<year>.<month>.<Nth-of-month>. Strict 3-segment numeric so
  // npm semver / GitHub Release sort all work natively. Identifier
  // strings like "carus" go in --version banner / README / release notes,
  // not the tag.
  if (!/^v[0-9]+\.[0-9]+\.[0-9]+$/.test(tag)) {
    fatal(
      `tag "${tag}" must match v<year>.<month>.<n>  (e.g. v26.5.30)\n` +
        `  Identifier strings (carus, beta, rc) go in release notes, not the tag — they break sort.`,
    )
  }
}

function checkTagAvailable(tag: string): void {
  const local = run('git', ['tag', '-l', tag]).out
  if (local) {
    fatal(
      `tag ${tag} exists locally. If a previous release attempt failed, retry with the same tag:\n` +
        `  git push origin ${tag}\n` +
        `Otherwise pick a new tag.`,
    )
  }
  const remote = run('git', ['ls-remote', '--tags', 'origin', tag]).out
  if (remote) {
    fatal(`tag ${tag} already exists on origin — pick a new tag.`)
  }
}

function checkCleanTree(): void {
  const status = run('git', ['status', '--porcelain'])
  if (status.out) {
    fatal(
      `working tree dirty — commit or stash first:\n${status.out
        .split('\n')
        .map(l => `  ${l}`)
        .join('\n')}`,
    )
  }
}

function checkBranch(forceBranch: boolean): string {
  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out
  if (branch !== 'main' && !forceBranch) {
    fatal(
      `current branch is "${branch}", not main.\n` +
        `Releases cut from main only — that's the branch ci.yml gates.\n` +
        `Override (rare, e.g. hotfix branch already in production): --force-branch`,
    )
  }
  return branch
}

function checkUpstream(branch: string): void {
  const upstream = run('git', [
    'rev-parse',
    '--abbrev-ref',
    `${branch}@{upstream}`,
  ])
  if (upstream.code !== 0) {
    fatal(
      `branch "${branch}" has no upstream. Set one once:\n  git push -u origin ${branch}`,
    )
  }
}

function checkHeadInSync(branch: string): void {
  // The single most important check: the SHA we are about to tag MUST
  // already be on origin. Otherwise we'd tag a SHA only this machine
  // has — release.yml's checkout would fail, and even if it didn't,
  // the SHA never went through ci.yml.
  const local = run('git', ['rev-parse', 'HEAD']).out
  const remote = run('git', ['rev-parse', `origin/${branch}`]).out
  if (!local || !remote) {
    fatal(
      `cannot resolve HEAD/origin/${branch}. Run 'git fetch origin' and retry.`,
    )
  }
  if (local !== remote) {
    fatal(
      `HEAD (${local.slice(0, 12)}) != origin/${branch} (${remote.slice(0, 12)}).\n` +
        `  Releases tag the SHA that already passed ci.yml on origin.\n` +
        `  If you have unpushed commits: 'git push origin ${branch}' first, wait for ci.yml, then release.\n` +
        `  If origin is ahead: 'git pull --ff-only origin ${branch}' first.`,
    )
  }
}

interface LastRunStatus {
  status: 'success' | 'failure' | 'in_progress' | 'unknown' | 'no_history'
  conclusion: string
  url: string
  tag: string
}

function checkLastReleaseRun(): LastRunStatus {
  // gh CLI is a soft dependency — if missing or unauthenticated, skip the
  // check but warn. Hard-failing on 'gh not installed' would block users
  // who never set up gh CLI from doing local releases.
  const which = run('which', ['gh'])
  if (which.code !== 0) {
    warn('gh CLI not installed — skipping release.yml history check')
    return {
      status: 'unknown',
      conclusion: '',
      url: '',
      tag: '',
    }
  }
  const r = run('gh', [
    'run',
    'list',
    '--workflow',
    'release.yml',
    '--limit',
    '1',
    '--json',
    'status,conclusion,url,headBranch,displayTitle,event',
  ])
  if (r.code !== 0) {
    warn(`gh run list failed (continuing): ${r.err.split('\n')[0]}`)
    return { status: 'unknown', conclusion: '', url: '', tag: '' }
  }
  try {
    const arr = JSON.parse(r.out) as Array<{
      status: string
      conclusion: string
      url: string
      displayTitle: string
    }>
    if (arr.length === 0) {
      return { status: 'no_history', conclusion: '', url: '', tag: '' }
    }
    const last = arr[0]
    if (!last) {
      return { status: 'no_history', conclusion: '', url: '', tag: '' }
    }
    return {
      status:
        last.status === 'completed'
          ? last.conclusion === 'success'
            ? 'success'
            : 'failure'
          : 'in_progress',
      conclusion: last.conclusion,
      url: last.url,
      tag: last.displayTitle,
    }
  } catch {
    return { status: 'unknown', conclusion: '', url: '', tag: '' }
  }
}

interface StaleDraft {
  tag: string
  url: string
}

function checkStaleDrafts(): StaleDraft[] {
  const which = run('which', ['gh'])
  if (which.code !== 0) return []
  const r = run('gh', [
    'release',
    'list',
    '--limit',
    '20',
    '--json',
    'tagName,isDraft,url',
  ])
  if (r.code !== 0) return []
  try {
    const arr = JSON.parse(r.out) as Array<{
      tagName: string
      isDraft: boolean
      url: string
    }>
    return arr.filter(r => r.isDraft).map(r => ({ tag: r.tagName, url: r.url }))
  } catch {
    return []
  }
}

// ─── Plan summary ──────────────────────────────────────────────────────────

interface Plan {
  tag: string
  branch: string
  headSha: string
  headSubject: string
  lastRun: LastRunStatus
  staleDrafts: StaleDraft[]
  warnings: string[]
}

function buildPlan(args: Args): Plan {
  checkTagShape(args.tag)
  checkTagAvailable(args.tag)
  checkCleanTree()
  const branch = checkBranch(args.forceBranch)
  checkUpstream(branch)
  checkHeadInSync(branch)

  const headSha = run('git', ['rev-parse', '--short=12', 'HEAD']).out
  const headSubject = run('git', ['log', '-1', '--pretty=%s']).out
  const lastRun = checkLastReleaseRun()
  const staleDrafts = checkStaleDrafts()

  const warnings: string[] = []
  if (lastRun.status === 'failure') {
    warnings.push(
      `last release.yml run FAILED for ${lastRun.tag} (${lastRun.url})\n` +
        `  Investigate before cutting a new tag — same failure may bite this release.`,
    )
  }
  if (lastRun.status === 'in_progress') {
    warnings.push(
      `last release.yml run for ${lastRun.tag} is still IN PROGRESS (${lastRun.url})\n` +
        `  Cutting a new tag now will queue a second build — consider waiting.`,
    )
  }
  if (staleDrafts.length > 0) {
    warnings.push(
      `${staleDrafts.length} stale draft release(s) on origin:\n` +
        staleDrafts.map(d => `    ${d.tag}  ${d.url}`).join('\n') +
        `\n  Drafts hide failed publishes. Delete them ('gh release delete <tag>') before releasing.`,
    )
  }

  return {
    tag: args.tag,
    branch,
    headSha,
    headSubject,
    lastRun,
    staleDrafts,
    warnings,
  }
}

function printPlan(plan: Plan, dryRun: boolean): void {
  console.log('─── release plan ─────────────────────────────────────────')
  console.log(`  tag              ${plan.tag}`)
  console.log(`  branch           ${plan.branch}`)
  console.log(`  HEAD             ${plan.headSha}`)
  console.log(`  subject          ${plan.headSubject}`)
  console.log(
    `  last release.yml ${plan.lastRun.status}${plan.lastRun.tag ? ` (${plan.lastRun.tag})` : ''}`,
  )
  console.log(`  stale drafts     ${plan.staleDrafts.length}`)
  console.log('──────────────────────────────────────────────────────────')
  if (plan.warnings.length > 0) {
    for (const w of plan.warnings) warn(w)
    console.log('──────────────────────────────────────────────────────────')
  }
  if (dryRun) {
    info('--dry: would tag & push, then exit. Re-run without --dry to release.')
  } else if (plan.warnings.length > 0) {
    info(
      'warnings above — abort with Ctrl-C if any look wrong, or wait 3 s to continue.',
    )
  }
}

// ─── Commit / rollback ─────────────────────────────────────────────────────

async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms))
}

async function executeRelease(plan: Plan): Promise<void> {
  if (plan.warnings.length > 0) {
    // Visible pause after warnings so a human in the loop can Ctrl-C.
    // Short enough that --no-warnings releases (the common case) feel
    // instant, long enough that "oh wait, drafts" is actionable.
    await sleep(3000)
  }

  info(`creating annotated tag ${plan.tag} at ${plan.headSha}`)
  const tagRes = run('git', [
    'tag',
    '-a',
    plan.tag,
    '-m',
    `Release ${plan.tag}`,
  ])
  if (tagRes.code !== 0) {
    fatal(`git tag failed: ${tagRes.err}`)
  }

  info(`pushing tag to origin (release.yml will build + publish)`)
  const push = run('git', ['push', 'origin', plan.tag])
  if (push.code !== 0) {
    // Roll back the local tag so the next release attempt doesn't see
    // "tag exists locally" and ask the user to retry-push manually.
    run('git', ['tag', '-d', plan.tag])
    fatal(
      `git push tag failed (local tag rolled back): ${push.err}\n` +
        `  Retry: bun run release ${plan.tag}\n` +
        `  If this keeps failing, check GitHub status (gh api /status) and your network.`,
    )
  }

  ok(`tag ${plan.tag} pushed`)
  console.log('')
  console.log(`  build progress`)
  console.log(`    https://github.com/Icarus603/claude-code/actions`)
  console.log(`  release page (published when build completes)`)
  console.log(
    `    https://github.com/Icarus603/claude-code/releases/tag/${plan.tag}`,
  )
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = parseArgs()
  const plan = buildPlan(args)
  printPlan(plan, args.dryRun)
  if (args.dryRun) return
  await executeRelease(plan)
}

void main()
