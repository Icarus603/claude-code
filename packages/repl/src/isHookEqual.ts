// Leaf module: pure isHookEqual helper. Extracted from hooksSettings.ts
// to break the agent/sessionHooks ↔ repl/hooksSettings cycle:
// hooksSettings imports getSessionHooks from sessionHooks; sessionHooks
// only needed isHookEqual back. Both now depend on this leaf.

import type { HookCommand } from '@claude-code/config/types'
import { DEFAULT_HOOK_SHELL } from '@claude-code/shell/legacy/shellProvider.js'

export function isHookEqual(
  a: HookCommand | { type: 'function'; timeout?: number },
  b: HookCommand | { type: 'function'; timeout?: number },
): boolean {
  if (a.type !== b.type) return false

  // Compare command/prompt content; `if` is part of identity (same
  // command with different conditions are distinct hooks).
  const sameIf = (x: { if?: string }, y: { if?: string }) =>
    (x.if ?? '') === (y.if ?? '')
  switch (a.type) {
    case 'command':
      // shell is part of identity. Default 'bash' so undefined === 'bash'.
      return (
        b.type === 'command' &&
        a.command === b.command &&
        (a.shell ?? DEFAULT_HOOK_SHELL) === (b.shell ?? DEFAULT_HOOK_SHELL) &&
        sameIf(a, b)
      )
    case 'prompt':
      return b.type === 'prompt' && a.prompt === b.prompt && sameIf(a, b)
    case 'agent':
      return b.type === 'agent' && a.prompt === b.prompt && sameIf(a, b)
    case 'http':
      return b.type === 'http' && a.url === b.url && sameIf(a, b)
    case 'function':
      // Function hooks can't be compared (no stable identifier)
      return false
  }
}
