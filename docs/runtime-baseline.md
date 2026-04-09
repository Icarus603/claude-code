# Runtime Skeleton Baseline (RT-00)

Date: 2026-04-10

## Scope

This baseline locks the runtime-skeleton refactor scope before RT-05+ cutover:

- Host composition and binding install path
- New runtime packages (`app-host`, `storage`, `output`, `local-observability`)
- Entry seams (`main.tsx`, `src/cli/print.ts`)
- Architecture verification commands and fail-fast gates

## Baseline Snapshot

### Workspace runtime packages present

- `packages/app-host`
- `packages/storage`
- `packages/output`
- `packages/local-observability`

### Entry seams

- `src/main.tsx` consumes `./runtime/bootstrap.js` and `@claude-code/app-host`
- `src/cli/print.ts` consumes `src/runtime/bootstrap.js`

### Legacy import debt snapshot (for tracking)

- `packages/agent`: 51 legacy `@cc-app/*` imports before compat cutover
- `packages/config`: 116 legacy `@cc-app/*` imports before compat cutover
- `packages/permission`: 88 legacy `@cc-app/*` imports before compat cutover
- `packages/memory`: 83 legacy `@cc-app/*` imports before compat cutover
- `packages/cli`: 26 legacy `@cc-app/*` imports before compat cutover

## Verification Command Lock

Run in repo root:

```bash
bun run build
bun test
bun run health
bun run scripts/check-transition-stubs.ts
bun run scripts/verify-entry-thin-host.ts
bun run scripts/verify-provider-adapter.ts
bun run scripts/verify-command-registry.ts
bun run scripts/verify-mcp-runtime.ts
bun run scripts/verify-shell-package.ts
bun run scripts/verify-cli-package.ts
bun run scripts/verify-appstate-domain-api.ts
bun run scripts/verify-swarm-e2e.ts
bun run verify:runtime-boundaries
bun run verify:app-host-composition
bun run verify:output-targets
bun run verify:storage-contracts
```

## Risk Guardrails

- External surfaces are frozen:
  - CLI behavior, flags, and command semantics
  - SDK types and protocol shape
  - session/config file formats
- Compat facades are allowed, but owner logic must converge into packages.
- Any failed command above blocks RT completion.
