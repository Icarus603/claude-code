# Runtime + Contract Baseline (T00)

Date: 2026-04-10

## External Contract Freeze

External behavior that must remain unchanged during V6 refactor:

- CLI flags / command semantics / exit behavior
- SDK type surface (`src/entrypoints/agentSdkTypes.ts` + `src/entrypoints/sdk/*`)
- session / transcript / metadata / config file formats
- permission flow semantics (allow/deny/ask + mode behavior)
- MCP config surface and runtime behavior

## Entrypoint Hash Snapshot

```text
17be8cd67fc72e5e495a841381b0fd829dff18d190dd36201c0e00add1ed80c5  packages/headless-sdk/src/agentSdkTypes.ts
47f0f759a57724cae741023419b1c86ed680d06ac325741836423bd141cd55e6  packages/app-host/src/init.ts
fca81a0d4fc34e818699aa737ccd18e3fd0ed1141efa7d4317968539f765c065  src/entrypoints/mcp.ts
e15167a170952be204091d6808b0ee9ed7ccc114e34e9396eb060789aac33f4b  packages/headless-sdk/src/sandboxTypes.ts
f6371808ab47f2f57cd75d6f6ac7926ebb8a8d2b818a8871b8f7cf1d099f8baf  src/entrypoints/sdk/controlSchemas.ts
d3918b6119e629f2a17967bc217d730b16fe5a9dd9f1673341364dbfe2c2a774  src/entrypoints/sdk/controlTypes.ts
7c4e83756565d421d6d338a2b8356147d95b30132e555c68012ea2551fb3ea9e  src/entrypoints/sdk/coreSchemas.ts
b4d2efdaa82872990c6244afc6e85db73b48279185792a3ee38811eeceea02b7  src/entrypoints/sdk/coreTypes.generated.ts
1ffd4643759f1e2342b07d6fe0d6627463b1d39ffa1775a11f10aab17dae2bcd  src/entrypoints/sdk/coreTypes.ts
b86bd365fbcacfbf3d93eeb8a5680b98b8e2db3bd90473dca316a3dce07255d5  src/entrypoints/sdk/runtimeTypes.ts
19e48ec29a8af5feedcef36df153f9c5334b80f8c15094e44d4c82f8373b4dfe  src/entrypoints/sdk/sdkUtilityTypes.ts
83829b32f2292b6492fac186b20762a0c448e01c40f8105f3eed2bc3fcfccaf2  src/entrypoints/sdk/settingsTypes.generated.ts
6feda2402a88aefc1b23993e493dd3356e525881fe86e5e490d4aa08b74c223d  src/entrypoints/sdk/toolTypes.ts
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

## Host Monolith Snapshot

```text
src/main.tsx: 6583 lines
src/screens/REPL.tsx: 6142 lines
src/cli/print.ts: 5600 lines
```

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
