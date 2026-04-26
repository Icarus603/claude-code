# @claude-code/shell

Bash AST, sandbox-aware execution, PowerShell parser, portable
`execFileNoThrow`, and the Shell.ts wrapper.

V7 §8.9 — every shell-out path in the codebase routes through this
package so sandbox policy, env scrubbing, and cancellation are
enforced uniformly.
