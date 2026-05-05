#!/usr/bin/env bun
/**
 * One-command release: push the branch, tag the current HEAD, and push the tag.
 * GitHub Actions release.yml takes it from there (builds 5 binaries,
 * generates SHA256 sidecars, publishes to Releases).
 *
 * Usage:
 *   bun run release v1.carus.001
 *
 * Pre-flight checks (all fatal):
 *   - working tree must be clean (no uncommitted changes)
 *   - tag must match v* and not already exist locally or on origin
 *   - current branch must be main (override with --force-branch)
 *   - current branch must have an upstream (set once with `git push -u origin <branch>`)
 *
 * Order matters: branch first, then tag. If we tagged before pushing the branch,
 * a tag-push success with a branch-push failure would leave the tag pointing at
 * a SHA that GHA's actions/checkout can't fetch.
 */

import { spawnSync } from 'node:child_process'

function run(cmd: string, args: string[]): { code: number; out: string; err: string } {
  const r = spawnSync(cmd, args, { encoding: 'utf8' })
  return { code: r.status ?? 1, out: r.stdout?.trim() ?? '', err: r.stderr?.trim() ?? '' }
}

function fatal(msg: string): never {
  console.error(`✗ ${msg}`)
  process.exit(1)
}

function main(): void {
  const args = process.argv.slice(2)
  const tag = args.find(a => !a.startsWith('--'))
  const forceBranch = args.includes('--force-branch')

  if (!tag) {
    fatal('Usage: bun run release <tag>   (e.g. bun run release v1.carus.001)')
  }
  if (!/^v[0-9].*/.test(tag)) {
    fatal(`tag "${tag}" must start with v + digit (e.g. v1.carus.001)`)
  }

  const status = run('git', ['status', '--porcelain'])
  if (status.out) {
    fatal(`working tree dirty — commit or stash first:\n${status.out}`)
  }

  const branch = run('git', ['rev-parse', '--abbrev-ref', 'HEAD']).out
  if (branch !== 'main' && !forceBranch) {
    fatal(`current branch is "${branch}", not main. Use --force-branch to override.`)
  }

  const localTag = run('git', ['tag', '-l', tag]).out
  if (localTag) fatal(`tag ${tag} already exists locally`)

  const remoteTag = run('git', ['ls-remote', '--tags', 'origin', tag]).out
  if (remoteTag) fatal(`tag ${tag} already exists on origin`)

  const upstream = run('git', ['rev-parse', '--abbrev-ref', `${branch}@{upstream}`])
  if (upstream.code !== 0) {
    fatal(
      `branch "${branch}" has no upstream. Set one once:\n  git push -u origin ${branch}`,
    )
  }

  const head = run('git', ['rev-parse', '--short', 'HEAD']).out
  console.log(`→ pushing ${branch} to origin (so the tag points at a fetchable SHA)`)
  const branchPush = run('git', ['push', 'origin', branch])
  if (branchPush.code !== 0) {
    fatal(`git push ${branch} failed (no tag created): ${branchPush.err}`)
  }

  console.log(`→ tagging ${tag} at ${branch}@${head}`)
  const tagResult = run('git', ['tag', '-a', tag, '-m', `Release ${tag}`])
  if (tagResult.code !== 0) fatal(`git tag failed: ${tagResult.err}`)

  console.log(`→ pushing tag to origin (release.yml will build + publish)`)
  const push = run('git', ['push', 'origin', tag])
  if (push.code !== 0) {
    run('git', ['tag', '-d', tag])
    fatal(`git push tag failed (tag rolled back; branch already on origin): ${push.err}`)
  }

  console.log(`✓ tag ${tag} pushed. Track build:`)
  console.log(`  https://github.com/Icarus603/claude-code/actions`)
  console.log(`✓ release will appear at:`)
  console.log(`  https://github.com/Icarus603/claude-code/releases/tag/${tag}`)
}

main()
