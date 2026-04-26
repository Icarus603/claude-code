# Claude Code Best

[繁體中文](./README.zh-TW.md) | [簡體中文](./README.zh-CN.md)

Terminal coding agent. Single binary, installed as `ccb`. Community-maintained derivative of Claude Code.

Not affiliated with Anthropic. For the official tool, see <https://docs.anthropic.com/en/docs/claude-code/overview>.

---

## Install

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

Installs to `~/.local/share/ccb/versions/<version>` with a symlink at `~/.local/bin/ccb`. No Node, no Bun, no package manager required.

| Variable | Default | Effect |
|----------|---------|--------|
| `CCB_VERSION` | `latest` | Pin a specific tag, e.g. `v1.carus.000` |
| `CCB_PREFIX`  | `~/.local` | Install root (`/usr/local` for system-wide) |

Upgrade: re-run the same `curl ... | bash`. Uninstall: `rm -rf ~/.local/share/ccb ~/.local/bin/ccb`.

---

## Usage

```bash
ccb              # interactive REPL
ccb --version
ccb --help
```

First run prompts `/login`. See [`docs/`](docs/) for feature reference.

### Provider config

```bash
# OpenAI-compatible (DeepSeek, Ollama, vLLM, ...)
export CLAUDE_CODE_USE_OPENAI=1
export OPENAI_API_KEY=...
export OPENAI_BASE_URL=...
export OPENAI_DEFAULT_SONNET_MODEL=...

# Google Gemini
export CLAUDE_CODE_USE_GEMINI=1
export GEMINI_API_KEY=...
export GEMINI_DEFAULT_SONNET_MODEL=...
```

| Variable | Purpose |
|----------|---------|
| `ANTHROPIC_API_KEY`, `ANTHROPIC_BASE_URL` | Anthropic auth + endpoint |
| `CLAUDE_CODE_USE_OPENAI=1` | OpenAI-compat provider |
| `CLAUDE_CODE_USE_GEMINI=1` | Gemini provider |
| `FEATURE_<FLAG>=1` | Enable a build-time feature gate at runtime |

---

## Build from source

[Bun](https://bun.sh) ≥ 1.3.0 is the only requirement.

```bash
git clone https://github.com/Icarus603/claude-code.git
cd claude-code
bun install

bun run dev               # hot-reload, no build step
bun run build:standalone  # → dist/ccb (current platform)
bun run build:platforms   # → dist/binaries/ccb-{darwin,linux,windows}-{arm64,x64}[.exe]
bun test
bun run doctor:arch       # architectural invariants — must pass
```

`bun build --compile --target=bun-<os>-<arch>` cross-compiles in ~0.4s per platform. The release workflow ([`.github/workflows/release.yml`](.github/workflows/release.yml)) does this on tag push.

### Layout

```
packages/                 ← all source (there is no src/)
├── agent/                  agent loop, hooks, messages, tools dispatch
├── app-host/               runtime composition + bootstrap
├── cli/src/entry/          binary entry points
├── command-runtime/        slash commands + skills
├── config/                 settings, env, feature flags, plugin loader
├── headless-sdk/           public TypeScript SDK surface
├── permission/             tool-permission UX + classifier
├── provider/               Anthropic / OpenAI-compat / Gemini / Grok adapters
├── repl/                   Ink-based TUI
├── shell/                  bash/powershell parser + sandbox
├── storage/                JSONL session files, file cache
├── tool-registry/          tool definitions
└── ...                     mcp-runtime, voice, swarm, bridge, daemon, ...

scripts/
└── doctor-architecture.ts  source of truth for what passes CI
```

---

## Contributing

PRs welcome.

- `bun run doctor:arch` must pass. No `--no-verify`.
- `bun test` must pass. Add tests for new behavior.
- `tsc-errors` ratchet only allows the count to decrease.
- Commit messages explain *why*; the diff already shows *what*.
- Don't add npm distribution back. This is binary-only by design.

```bash
gh repo fork Icarus603/claude-code
git checkout -b feat/your-thing
# ...
bun run doctor:arch && bun test
gh pr create
```

Architectural conventions live in [`docs/lazy-require-pattern.md`](docs/lazy-require-pattern.md) and the doctor scripts under [`scripts/`](scripts/).

---

## Releasing

Maintainer only.

```bash
git tag v1.carus.001
git push --tags
```

GitHub Actions builds 5 binaries and uploads them to Releases.

---

## Lineage

`ccb` derives from a public Claude Code community fork. See [`ATTRIBUTION.md`](./ATTRIBUTION.md). No standalone license file is shipped — review provenance before redistribution.

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [`docs/`](docs/) · [Anthropic's official Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
