# image-processor.node — Source

## What

Native N-API module that wraps libvips (image format read/write/resize/compress
without depending on npm `sharp` and its platform-specific binaries).

V7's original `image-processor-napi` package was a pure-JS re-export of npm
`sharp`, which fails to load when ccb is shipped as a Bun standalone bundle —
the platform `.node` from `@img/sharp-darwin-arm64` does not get embedded by
`bun build --compile`. We replace it with the native module that ant ships,
which has a sharp-shaped chainable API that ccb's image-resizer code already
expects.

## Where it came from

Extracted from Anthropic's official Claude Code CLI binary version `2.1.121`
(per platform). Bun standalone binaries embed assets at `/$bunfs/root/`; we
extract the relevant `.node` blob from each platform-specific binary and ship
it under the matching subdirectory.

## Platforms covered

- `arm64-darwin` (~1.25 MB Mach-O arm64)
- `x64-darwin` (~1.35 MB Mach-O x86_64)
- `arm64-linux` (~1.29 MB ELF aarch64)
- `x64-linux` (~1.46 MB ELF x86_64)
- `x64-win32` (~1.50 MB PE32+ DLL)

Naming convention is `<arch>-<platform>` to mirror
`packages/audio-capture-napi/vendor/`. The runtime resolver in
`packages/image-processor-napi/src/index.ts` uses hardcoded
`require('../vendor/<arch>-<platform>/image-processor.node')` literals — Bun's
bundler scans these to embed the matching `.node` into standalone binaries
(visible as `/$bunfs/root/image-processor-<hash>.node`).

## Why ship it as-is

ccb is a personal, self-hosted, single-user fork of Claude Code. It is not
distributed as a public binary. Bundling Anthropic's compiled `.node` is the
shortest path to working image paste on a Bun standalone build, and avoids
the alternatives:

- Writing a Rust/N-API replacement (large engineering investment)
- Patching npm sharp's platform binaries into the Bun bundle (sharp's
  `dlopen` paths are fragile post-bundle)
- Falling back to `sips(1)` on macOS only (no cross-platform fix)

## To refresh from a new ant version

```bash
mkdir -p /tmp/ccb-fetch && cd /tmp/ccb-fetch
for plat in darwin-arm64 darwin-x64 linux-arm64 linux-x64 win32-x64; do
  npm pack "@anthropic-ai/claude-code-${plat}"
done
# Then run bun-demincer's extract.mjs (for darwin) and the binary blob
# scanner pattern (for linux/win32; see git history for the script that
# pulls embedded ELF/Mach-O/PE blobs by magic bytes + SizeOfImage).
# Place the extracted image-processor.node files into the per-platform
# directories under this folder.
```

## License & redistribution

The Anthropic Claude Code CLI is proprietary software. Re-distributing this
module would violate Anthropic's terms. ccb is **not** a public package and
**not** distributed via npm. Binary releases on the GitHub repo are intended
solely for the repo operator's personal install on personal machines.

If you are not the repo operator, you should not be running this fork.
