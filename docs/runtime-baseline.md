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
32fac612b3eb829471144a79449b617ac55d2f71d0355e7e88278500e5ad4157  packages/headless-sdk/src/agentSdkTypes.ts
b24508ad060b7bd04e7e874b671aef618c525ad1a20dc9bc19fcaeeb4da329be  packages/app-host/src/init.ts
fca81a0d4fc34e818699aa737ccd18e3fd0ed1141efa7d4317968539f765c065  src/entrypoints/mcp.ts
e15167a170952be204091d6808b0ee9ed7ccc114e34e9396eb060789aac33f4b  packages/headless-sdk/src/sandboxTypes.ts
f6371808ab47f2f57cd75d6f6ac7926ebb8a8d2b818a8871b8f7cf1d099f8baf  src/entrypoints/sdk/controlSchemas.ts
d3918b6119e629f2a17967bc217d730b16fe5a9dd9f1673341364dbfe2c2a774  src/entrypoints/sdk/controlTypes.ts
7c4e83756565d421d6d338a2b8356147d95b30132e555c68012ea2551fb3ea9e  src/entrypoints/sdk/coreSchemas.ts
b4d2efdaa82872990c6244afc6e85db73b48279185792a3ee38811eeceea02b7  src/entrypoints/sdk/coreTypes.generated.ts
1ffd4643759f1e2342b07d6fe0d6627463b1d39ffa1775a11f10aab17dae2bcd  src/entrypoints/sdk/coreTypes.ts
995677acf16256c3844da39768c8d0851df42a9be403f650d86191161cef1803  src/entrypoints/sdk/runtimeTypes.ts
15b2e94fa97ca2774d343364c6d4abefbee878060fa1d2ca7634c9f2d1b0c7b8  src/entrypoints/sdk/sdkUtilityTypes.ts
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
