import { execFileNoThrow } from '@claude-code/shell/execFileNoThrow.js'
import { getBranch, getDefaultBranch, getIsGit } from '@claude-code/storage/git.js'
import { jsonParse } from '@claude-code/local-observability/slowOperations.js'
import {
  fetchPrStatusViaRest,
  isHarborPrismEnabled,
} from './ghPrStatusRest.js'

export type PrReviewState =
  | 'approved'
  | 'pending'
  | 'changes_requested'
  | 'draft'
  | 'merged'
  | 'closed'

type PrStatus = {
  number: number
  url: string
  reviewState: PrReviewState
}

const GH_TIMEOUT_MS = 5000

/**
 * Derive review state from GitHub API values.
 * Draft PRs always show as 'draft' regardless of reviewDecision.
 * reviewDecision can be: APPROVED, CHANGES_REQUESTED, REVIEW_REQUIRED, or empty string.
 */
function deriveReviewState(
  isDraft: boolean,
  reviewDecision: string,
): PrReviewState {
  if (isDraft) return 'draft'
  switch (reviewDecision) {
    case 'APPROVED':
      return 'approved'
    case 'CHANGES_REQUESTED':
      return 'changes_requested'
    default:
      return 'pending'
  }
}

/**
 * Fetch PR status for the current branch using `gh pr view`.
 * Returns null on any failure (gh not installed, no PR, not in git repo, etc).
 * Also returns null if the PR's head branch is the default branch (e.g., main/master).
 */
export async function fetchPrStatus(): Promise<PrStatus | null> {
  const isGit = await getIsGit()
  if (!isGit) return null

  // Skip on the default branch — `gh pr view` returns the most recently
  // merged PR there, which is misleading.
  const [branch, defaultBranch] = await Promise.all([
    getBranch(),
    getDefaultBranch(),
  ])
  if (branch === defaultBranch) return null

  // Port of ant v2.1.128 gZ7 (3672.js) — when `tengu_harbor_prism` is
  // on, prefer REST + ETag caching over spawning `gh pr view`. Saves
  // ~40ms per poll, supports GitHub Enterprise via GH_HOST.
  try {
    if (isHarborPrismEnabled() && branch) {
      // Need owner/repo — derive from git remote.
      const remote = await execFileNoThrow('git', [
        'remote',
        'get-url',
        'origin',
      ])
      const ownerRepo = remote.stdout
        ? /[:/]([^/:]+)\/([^/]+?)(?:\.git)?$/.exec(remote.stdout.trim())
        : null
      if (ownerRepo) {
        const rest = await fetchPrStatusViaRest({
          owner: ownerRepo[1]!,
          repo: ownerRepo[2]!,
          branch,
        })
        if (rest) {
          return {
            number: rest.number,
            url: rest.url,
            reviewState:
              rest.reviewDecision === 'APPROVED'
                ? 'approved'
                : rest.reviewDecision === 'CHANGES_REQUESTED'
                  ? 'changes_requested'
                  : 'pending',
          }
        }
      }
    }
  } catch {
    // REST path failure — fall through to spawn-gh path below.
  }

  const { stdout, code } = await execFileNoThrow(
    'gh',
    [
      'pr',
      'view',
      '--json',
      'number,url,reviewDecision,isDraft,headRefName,state',
    ],
    { timeout: GH_TIMEOUT_MS, preserveOutputOnError: false },
  )

  if (code !== 0 || !stdout.trim()) return null

  try {
    const data = jsonParse(stdout) as {
      number: number
      url: string
      reviewDecision: string
      isDraft: boolean
      headRefName: string
      state: string
    }

    // Don't show PR status for PRs from the default branch (e.g., main, master)
    // This can happen when someone opens a PR from main to another branch
    if (
      data.headRefName === defaultBranch ||
      data.headRefName === 'main' ||
      data.headRefName === 'master'
    ) {
      return null
    }

    // Don't show PR status for merged or closed PRs — `gh pr view` returns
    // the most recently associated PR for a branch, which may be merged/closed.
    // The status line should only display open PRs.
    if (data.state === 'MERGED' || data.state === 'CLOSED') {
      return null
    }

    return {
      number: data.number,
      url: data.url,
      reviewState: deriveReviewState(data.isDraft, data.reviewDecision),
    }
  } catch {
    return null
  }
}
