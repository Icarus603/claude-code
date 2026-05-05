# ripgrep-napi vendored binaries

The `*.node` files in `arm64-darwin/`, `x64-darwin/`, `arm64-linux/`,
`x64-linux/`, and `x64-win32/` are reproducible build artifacts of
`packages/ripgrep-napi/native/` (Rust source). They are produced by
`.github/workflows/build-ripgrep-napi.yml` cross-compiling for each
target triple. The Rust source — not these binaries — is the source
of truth.

Each `.node` statically links the following crates from
[BurntSushi/ripgrep](https://github.com/BurntSushi/ripgrep) at versions
matching ripgrep 14.1.1:

- `grep-searcher` — line-oriented search engine
- `grep-regex` — regex matcher built on the standard `regex` crate
- `grep-matcher` — matcher trait
- `grep-printer` — output formatting (unused at runtime; we collect
  results into Rust structs and let napi-rs handle JS conversion)
- `ignore` — directory walker with `.gitignore` / `.ignore` /
  `.rgignore` support
- `globset` — fast multi-pattern globbing

All upstream crates are dual-licensed **MIT OR Unlicense**.

The napi-rs framework (`napi`, `napi-derive`, `napi-build`) is
licensed **MIT**.

Full license texts are reproduced in
[../native/LICENSE-NOTICES](../native/LICENSE-NOTICES) (created at
crate-bump time).
