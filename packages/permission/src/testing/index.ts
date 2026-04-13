/**
 * @claude-code/permission/testing
 *
 * V7 §9.11 — in-memory fakes for the permission package.
 *
 * AllowAllPermission : always allows — use when tests don't care about permission checks.
 * DenyAllPermission  : always denies — use when testing denial paths.
 * ScriptedPermission : returns decisions in order — use for precise permission flow tests.
 *
 * Must NOT import from ../internal/ (V7 §9.11 hard rule).
 */

export type PermissionDecision = {
  behavior: 'allow' | 'deny' | 'ask'
  updatedInput?: unknown
}

/**
 * AllowAllPermission — always returns allow for any tool/input.
 */
export class AllowAllPermission {
  check(_tool: string, _input: unknown): PermissionDecision {
    return { behavior: 'allow' }
  }
}

/**
 * DenyAllPermission — always returns deny for any tool/input.
 */
export class DenyAllPermission {
  check(_tool: string, _input: unknown): PermissionDecision {
    return { behavior: 'deny' }
  }
}

/**
 * ScriptedPermission — returns decisions in the order they were provided.
 * Throws if more checks are made than decisions provided.
 *
 * ```ts
 * const perm = new ScriptedPermission([
 *   { behavior: 'allow' },
 *   { behavior: 'deny' },
 *   { behavior: 'ask' },
 * ])
 * perm.check('Bash', {})   // → allow
 * perm.check('FileEdit', {}) // → deny
 * perm.check('Bash', {})   // → ask
 * ```
 */
export class ScriptedPermission {
  private readonly _decisions: PermissionDecision[]
  private _index = 0

  constructor(decisions: PermissionDecision[]) {
    this._decisions = decisions
  }

  check(_tool: string, _input: unknown): PermissionDecision {
    if (this._index >= this._decisions.length) {
      throw new Error(
        `ScriptedPermission: no more decisions (used ${this._index}, had ${this._decisions.length})`,
      )
    }
    return this._decisions[this._index++]!
  }

  /** Number of decisions consumed so far. */
  get consumed(): number {
    return this._index
  }

  /** Reset to replay from the beginning. */
  reset(): void {
    this._index = 0
  }
}
