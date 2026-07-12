const COMPLETION_POLICY = `

<background_worktree_completion>
If this task changes code in a git worktree, finish autonomously: verify the changes, commit them, push the branch to its configured push remote, and open a draft pull request. Return the pull-request URL. Do not stop merely to ask whether these routine completion steps should be performed.
</background_worktree_completion>`

export function appendFleetCompletionPolicy(intent: string): string {
  return intent ? intent + COMPLETION_POLICY : intent
}
