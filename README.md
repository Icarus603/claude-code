# Claude Code V5 by Icarus603

[繁體中文](./README.zh-TW.md) | [簡體中文](./README.zh-CN.md)

[![GitHub Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/Icarus603/claude-code?style=flat-square&color=orange)](https://github.com/Icarus603/claude-code/issues)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=blue)](https://github.com/Icarus603/claude-code/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)

> Which Claude do you like? The one we can actually maintain.

This repository is maintained by **Icarus603** as an independent derivative line of Claude Code.

It originated from a public Claude Code community fork. We keep the necessary attribution and licensing context, but the roadmap, refactoring direction, and quality bar now belong to this repository.

- V4: stronger tests, Buddy, Auto Mode, feature flags
- V5: Sentry / GrowthBook, custom login, OpenAI compatibility, Web Search, Computer Use, Voice Mode, Bridge Mode
- V6: full modular packaging and large-scale architecture cleanup

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) >= 1.3.11
- Access to a Claude / Anthropic-compatible API provider

### Install

```bash
bun install
```

### Run

```bash
bun run dev
bun run build
```

The build uses code splitting via [`build.ts`](build.ts) and writes output to `dist/`, with `dist/cli.js` as the main entry.

### First-time Login

After the first run, enter `/login` in the REPL. Choose **Anthropic Compatible** to connect to a third-party Anthropic-compatible endpoint.

Typical fields:

| Field | Description | Example |
|-------|-------------|---------|
| Base URL | API endpoint | `https://api.example.com/v1` |
| API Key | Auth token | `sk-xxx` |
| Haiku Model | Fast model ID | `claude-haiku-4-5-20251001` |
| Sonnet Model | Balanced model ID | `claude-sonnet-4-6` |
| Opus Model | High-performance model ID | `claude-opus-4-6` |

## Feature Flags

Enable features with `FEATURE_<FLAG_NAME>=1`, for example:

```bash
FEATURE_BUDDY=1 FEATURE_FORK_SUBAGENT=1 bun run dev
```

See [`docs/features/`](docs/features/) for details.

## VS Code Debugging

The TUI REPL needs a real terminal, so use attach mode:

1. Start inspect mode:
   ```bash
   bun run dev:inspect
   ```
2. In VS Code:
   - set breakpoints in `src/`
   - press `F5`
   - choose **Attach to Bun (TUI debug)**

## Documentation

- Architecture and feature docs live in [`docs/`](docs/)
- Traditional Chinese README: [`README.zh-TW.md`](./README.zh-TW.md)
- Simplified Chinese README: [`README.zh-CN.md`](./README.zh-CN.md)

## License and Lineage

This repository keeps the necessary lineage context and attribution. It is now maintained as an independent line by **Icarus603**, rather than as an upstream-tracking workflow.

This repository currently does not declare a standalone open-source license file. Review provenance and rights before redistribution or downstream republishing.
