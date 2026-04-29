# `_DEPRECATED` Suffix Audit (2026-04-29)

## Summary

12 unique symbols use the `_DEPRECATED` suffix across the codebase. **Zero have a parallel canonical replacement.** Every `_DEPRECATED` symbol IS the canonical — the suffix is an intent-to-replace marker that no one has acted on.

This means:

- `grep _DEPRECATED` is currently a useless search — it returns the things that ARE in production, not legacy that needs migration.
- Removing the suffix is a pure rename refactor with zero behavior change.
- The repo's deprecation discipline is broken: marking something deprecated in this codebase has not led to any actual migration in the V7 era.

## Per-symbol classification

| Symbol | Refs | Canonical exists? | Real reason for suffix |
|--------|-----:|-------------------|------------------------|
| `splitCommand_DEPRECATED` | 51 | No (parameter names + comments don't count) | `@deprecated Legacy regex/shell-quote path. Only used when tree-sitter is unavailable. The primary gate is parseForSecurity (ast.ts).` — but tree-sitter path is feature-gated and not on by default, so this IS the production path. |
| `bashCommandIsSafe_DEPRECATED` | 10 | No | Same as above — tree-sitter "primary gate" never replaces it because tree-sitter is opt-in. |
| `bashCommandIsSafeAsync_DEPRECATED` | 5 | No | Same. |
| `isUnsafeCompoundCommand_DEPRECATED` | 6 | No | Same. |
| `getSettings_DEPRECATED` | 139 | No (5 unrelated `getSettings` matches, all in different scopes) | Wave-1 _deps.ts setter intended to be replaced by per-source `getSettingsForSource(source)`, but 139 callers still use the unscoped form. |
| `writeFileSync_DEPRECATED` | 33 | No | Wave-1 _deps.ts setter intended to use the async `_fs().writeFile` host binding. Never replaced. |
| `writeFileSyncAndFlush_DEPRECATED` | 5 | The `_deps.ts` `writeFileSyncAndFlush()` setter wires TO this function — it's a redirect, not a replacement. | `@deprecated Use fs.promises.writeFile with flush option instead`. No one wrote the async path. |
| `execSync_DEPRECATED` | 15 | No | Same intent class — sync exec considered harmful, but no async migration. |
| `execSyncWithDefaults_DEPRECATED` | 20 | No | Same. |
| `RegexParsedCommand_DEPRECATED` | 2 | No | Same. |
| `renderPreviousOutput_DEPRECATED` | 2 | No | Same. |
| `getFeatureValue_DEPRECATED` | 4 | `getFeatureValue_CACHED_MAY_BE_STALE` (10 refs) — different name, different semantic | Two names for the same GrowthBook accessor. The DEPRECATED one is the sync version that could return stale data without flagging the staleness. |

Total: **12 symbols, all type B (canonical-but-suffixed).**

## Recommended action

### Don't do (per "Don't break userspace")

- ❌ Don't delete any `_DEPRECATED` symbol. Every one is in production.
- ❌ Don't add fake-canonical replacements just to satisfy the suffix.

### Do (cheap wins)

- ✅ **Rename, removing the suffix.** Pure mechanical refactor. Each rename is one commit. After all 12, `grep _DEPRECATED` returns 0 → the marker becomes meaningful again for future legitimate deprecations.
- ✅ **Replace `@deprecated` JSDoc with `@todo` or normal description prose.** The `@deprecated` tag triggers IDE strikethrough, which is misleading when the symbol is the only path.
- ✅ **Add a verifier rule** `verify-no-deprecated-suffix-without-canonical`: if a symbol ends in `_DEPRECATED`, a non-suffixed sibling with the same export name MUST exist somewhere in `packages/`. Lock the count at 0 (post-rename) so any new _DEPRECATED suffix must come with a real canonical.

### Don't do without owner approval

- The semantic of `getSettings_DEPRECATED` vs `getSettingsForSource` IS different (unscoped vs source-scoped). Renaming the suffix away should not paper over the missing migration to scoped. That's a separate piece of work.
- Same for `writeFileSync_DEPRECATED` vs the async `writeFile` host-binding. Keep the rename mechanical; don't bundle the async migration.

## Plan for follow-up tasks

After audit (this task) is complete:

1. New task: rename 12 symbols, removing `_DEPRECATED` suffix. One commit per symbol so reverts are surgical.
2. New task: add verifier rule to lock `_DEPRECATED` count at 0 going forward.
3. New tasks (one per symbol class) for the actual migrations the suffix was warning about — but only when the user explicitly schedules them.
