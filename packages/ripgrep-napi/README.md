# @claude-code/ripgrep-napi

In-process ripgrep for ccb. Provides three primitives — `findFiles`,
`searchContent`, `searchStream` — backed by the rust ripgrep crates
(`grep-searcher`, `grep-regex`, `ignore`, `globset`) statically compiled
into a per-platform `.node` (NAPI) binary. Bun's bundler embeds the
`.node` into the standalone executable and `dlopen`s it from the
`__BUN` segment without writing the binary to disk.

## Why

The previous spawn-based `ripgrep.ts` relied on Anthropic's forked bun
runtime (`bun-internal`) for argv[0]-dispatch into a built-in ripgrep.
ccb uses vanilla bun, so the dispatch silently failed in standalone
binaries — all 10 ripgrep-dependent features (commands loader, agents
loader, GrepTool, Glob, fileSuggestions, GlobalSearchDialog, output
styles loader, orphanedPluginFilter, sandbox dependency check, file
count telemetry) returned silently empty. Replacing the spawn with an
in-process NAPI call restores correctness and removes the spawn
overhead (~10–50 ms per call → ~1 ms NAPI overhead).

## Layout

```
src/             Thin TS wrapper that platform-resolves + types
native/          Rust crate (cargo workspace member)
  src/lib.rs     #[napi] surface; cancel handle, sink impls
  Cargo.toml     Pinned to ripgrep 14.1.1's grep-* + ignore versions
vendor/<plat>/   Prebuilt .node binaries (built by GHA, committed)
```

## Rebuilding the native module

```bash
cd packages/ripgrep-napi/native
cargo build --release
# output goes to <repo>/target/ripgrep-napi/release/libripgrep_napi.dylib
# copy to vendor/<arch>-<plat>/ripgrep.node
```

CI cross-compiles all 5 platforms via
`.github/workflows/build-ripgrep-napi.yml`.

## API

```ts
import { findFiles, searchContent, searchStream } from 'ripgrep-napi'

// File enumeration
const paths: string[] = findFiles({
  root: '/some/dir',
  globs: ['*.md', '!.git/**'],
  hidden: true,
  noIgnore: true,
})

// Buffered regex search
const matches = searchContent({
  root: '/some/dir',
  pattern: 'export function',
  caseInsensitive: true,
})
// matches: { path, lineNumber, content }[]

// Streaming with cancel handle
const handle = searchStream(
  { root: '/some/dir', pattern: 'TODO' },
  line => console.log(line),  // path:line:content
  () => console.log('done'),
)
handle.cancel()  // safe at any time
```

## Sandbox note

ccb's `@anthropic-ai/sandbox-runtime` integration on Linux still spawns
`rg` as an external helper for filesystem deny-path enforcement (it's a
separate process from ccb, so NAPI doesn't help). That single edge —
opt-in, Linux-only — extracts the platform's vendored `rg` binary on
demand. See `packages/tool-registry/src/embeddedRgExtractor.ts`.
