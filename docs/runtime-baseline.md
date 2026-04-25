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
cbb0d46f220fd5181ad09575b3c26ca22747bbfa8465c5036eb734bde2614c51  packages/headless-sdk/src/agentSdkTypes.ts
d08c6ea72c10a269752687d4ccfe1dca9bfa0a13d0670c86c7a005cb2c49f4ae  packages/app-host/src/init.ts
fca81a0d4fc34e818699aa737ccd18e3fd0ed1141efa7d4317968539f765c065  src/entrypoints/mcp.ts
e15167a170952be204091d6808b0ee9ed7ccc114e34e9396eb060789aac33f4b  packages/headless-sdk/src/sandboxTypes.ts
7898a3ae61119fa7a7cb45da99d5de86c45aaec8a568752d1cca8d3b59237e2b  packages/headless-sdk/src/controlSchemas.ts
34c7de450996dc379ff434f0034aa057c1b90dd73e740dd2ef9bbd185ae6b8b1  src/entrypoints/sdk/controlTypes.ts
0cb910c19419de3df0b3e0209aed1882d084160ad8f18c9b0ae0aa5ee8f7eac6  packages/headless-sdk/src/coreSchemas.ts
cf3324215ef656a763042cf0bd77e911d6ad5f66040d3665c8098a186561d3e6  src/entrypoints/sdk/coreTypes.generated.ts
28fc17b5a06daf4fe996312e0cbe2b37fd558a8e137a258e12a5e1f7798de9e4  src/entrypoints/sdk/coreTypes.ts
995677acf16256c3844da39768c8d0851df42a9be403f650d86191161cef1803  src/entrypoints/sdk/runtimeTypes.ts
15b2e94fa97ca2774d343364c6d4abefbee878060fa1d2ca7634c9f2d1b0c7b8  src/entrypoints/sdk/sdkUtilityTypes.ts
33bdde446aa849a498ea1bd5d2d0ffc2e20a0a01de68cd05eac67e658c3bac05  src/entrypoints/sdk/settingsTypes.generated.ts
5f7d2b6c417cadc74830535fef54959a00f08aa58afc8b2edf7872f0791bdaa8  src/entrypoints/sdk/toolTypes.ts
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
