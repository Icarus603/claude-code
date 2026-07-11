# Runtime + Contract Baseline (T00)

Date: 2026-04-10

## External Contract Freeze

External behavior that must remain unchanged during V6 refactor:

- CLI flags / command semantics / exit behavior
- SDK type surface (`packages/headless-sdk/src/agentSdkTypes.ts` + `packages/headless-sdk/src/*`)
- session / transcript / metadata / config file formats
- permission flow semantics (allow/deny/ask + mode behavior)
- MCP config surface and runtime behavior

## Entrypoint Hash Snapshot

```text
cbb0d46f220fd5181ad09575b3c26ca22747bbfa8465c5036eb734bde2614c51  packages/headless-sdk/src/agentSdkTypes.ts
9d3c91a0d262e93bab0895eb48059b4d32f20065c71e73fe178b5133110afc45  packages/app-host/src/init.ts
cc0db4548b156b8dbceeb5d5dc2f4343d05cffdc751288eb0dcadfe5635f2d25  packages/cli/src/entry/mcp.ts
e15167a170952be204091d6808b0ee9ed7ccc114e34e9396eb060789aac33f4b  packages/headless-sdk/src/sandboxTypes.ts
83dc941b9765c6d72f6255ae0ad686c5b09e1f863cae514de678b7ac9c49f07d  packages/headless-sdk/src/controlSchemas.ts
d3918b6119e629f2a17967bc217d730b16fe5a9dd9f1673341364dbfe2c2a774  packages/headless-sdk/src/controlTypes.ts
7bf55bf55b5840111e0e36b3214c1b244e7b8615e9f564510b417e9f2b584925  packages/headless-sdk/src/coreSchemas.ts
8b3d2628ea3fcc0eed180f017cf85e34972457578ba55ecf096f57afe4be6c61  packages/headless-sdk/src/coreTypes.generated.ts
39c32609be5131d5f5d2bb1f4b8d9ca733945994e7cb39cd908c352c6cd270c4  packages/headless-sdk/src/coreTypes.ts
713f4286114bbc97e37e6665b8d63932f319689b89a14102cb4be5e7206d742c  packages/headless-sdk/src/runtimeTypes.ts
19e48ec29a8af5feedcef36df153f9c5334b80f8c15094e44d4c82f8373b4dfe  packages/headless-sdk/src/sdkUtilityTypes.ts
```

## CLI Surface Snapshot

Reference output captured from:

```bash
bun dist/cli.js --help
```

Snapshot includes command list and option set for compatibility comparison.

## Structural Debt Snapshot

```text
packages/agent app-compat=158 src-import=0
packages/provider app-compat=0 src-import=0
packages/config app-compat=117 src-import=0
packages/permission app-compat=89 src-import=0
packages/memory app-compat=83 src-import=0
packages/cli app-compat=0 src-import=0
packages/tool-registry app-compat=0 src-import=0
packages/command-registry app-compat=0 src-import=0
packages/mcp-runtime app-compat=58 src-import=0
```

## Mega-file Snapshot (post-V7)

V7 migrated all source under `packages/`. The src/ tree no longer
exists. Monolithic files surviving the migration are tracked in
`scripts/file-size-baseline.json` (one-way ratchet — files may shrink
but never grow). Top 5 by line count:

```text
packages/repl/src/screens/REPLView.tsx: 5641 lines
packages/agent/messages.ts: 5626 lines
packages/agent/hooks.ts: 5178 lines
packages/storage/src/sessionStorage.ts: 4721 lines
packages/cli/src/entry/mode-dispatch.ts: 4376 lines
```

Decomposition of these (P7.2-P7.7) is tracked in TaskList.

## Verification Lock

```bash
bun run build
bun run health
bun run scripts/verify-runtime-boundaries.ts
bun run scripts/verify-entry-thin-host.ts
bun run scripts/verify-agent-owner.ts
bun run scripts/verify-provider-owner.ts
bun run scripts/verify-app-state-boundaries.ts
bun run scripts/verify-repl-owner.ts
bun run scripts/verify-headless-host.ts
bun run scripts/verify-app-host-composition.ts
bun run scripts/verify-session-format-compat.ts
bun run scripts/verify-provider-adapter.ts
bun run scripts/verify-mcp-runtime.ts
bun run scripts/verify-shell-package.ts
bun run scripts/verify-swarm-e2e.ts
bun test
```
