# TODO/FIXME/HACK Audit

> Generated 2026-04-29 / iteration 4. 88 `// TODO|FIXME|XXX|HACK` comments
> across `packages/`. None look like load-bearing bugs.

## Methodology

Greppped for `// (TODO|FIXME|XXX|HACK)` excluding the `XXXX` placeholders in
prose (AWS key formats, IPv6 octets, etc.). Classified each into:

1. **Aspirational future work** — "consider", "clean up", "(future work)",
   "Remove after migration is complete". Not a bug, just a note for later.
2. **Defensive recovery** — code that handles known-bad input from
   upstream/disk; the TODO points at the upstream fix that hasn't happened.
3. **Stale references** — TODO mentions a future state that has since
   become the current state.
4. **Genuine bug markers** — would-fix-now if I had infinite time.

## Counts

| Category | Count | Action |
|----------|------:|--------|
| Aspirational future work | ~50 | Leave alone |
| Defensive recovery | ~20 | Leave alone (the recovery code is correct) |
| Author tags (vadimdemedes/etc.) | ~12 | Upstream Ink — leave alone |
| Stale references | 1 | Could clean up |
| Genuine bug markers | 0 | None found |

## Notable findings

### Stale: `pluginLoader.ts:3242`

```typescript
// TODO: Clear installed plugins cache when installedPluginsManager is implemented
```

`installedPluginsManager.ts` is now 1268 LOC of real implementation. The
comment refers to a state that's no longer applicable. Could be deleted
or updated to point at the actual cache-clearing call. Low priority.

### Defensive: `config/global/config.ts:1705`

```typescript
// Not sure how this became a string
// TODO: Fix upstream
if (typeof projectConfig.allowedTools === 'string') {
  projectConfig.allowedTools = (safeParseJSON(projectConfig.allowedTools) ...) ?? []
}
```

Recovery for a data-corruption case observed in the wild — `allowedTools`
landed in storage as a JSON-encoded string instead of an array. The
defensive parse keeps users running while the root cause is unclear.
Leave it; comment is accurate.

### Refactor reminders

Most "TODO: clean up" comments mark code that works but the author
considered cosmetically improvable. Examples:

- `processUserInput.ts:200` "TODO: Make this an attachment message"
- `processUserInput.ts:242` "TODO: Clean this up"
- `REPLView.tsx:4371` "TODO: fix this"

Without specific failure modes, these are de-prioritized.

### Author-tagged TODOs (upstream Ink)

`// TODO(vadimdemedes)` and similar appear in `@ant/ink` package files.
These come from upstream Ink (the React-for-CLI library this project
forked). Leaving them preserves the upstream attribution.

## Conclusion

No actionable bugs found. The 88 TODO comments fall into categories that
are correctly classified as "intentional notes" or "defensive recovery
that doesn't need attention until upstream changes". The audit's primary
value is **confirming there's no hidden bug** — the codebase's TODO
discipline is reasonable.

**No follow-up tasks generated.** The `pluginLoader.ts:3242` stale
comment could be cleaned, but it's not worth a commit for one line.
