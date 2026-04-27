# Claude Code Best

[English](./README.md) | [繁體中文](./README.zh-TW.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat-square&color=blue&label=release)](https://github.com/Icarus603/claude-code/releases)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/commits/main)
[![Issues](https://img.shields.io/github/issues/Icarus603/claude-code?style=flat-square&color=orange)](https://github.com/Icarus603/claude-code/issues)

[![Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A51.3-black?style=flat-square&logo=bun&logoColor=white)](https://bun.sh/)
[![TypeScript](https://img.shields.io/badge/lang-TypeScript-3178C6?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![React](https://img.shields.io/badge/TUI-React%20%2B%20Ink-61DAFB?style=flat-square&logo=react&logoColor=white)](https://github.com/vadimdemedes/ink)
[![Anthropic](https://img.shields.io/badge/Anthropic-CC785C?style=flat-square&logo=anthropic&logoColor=white)](https://www.anthropic.com/)
[![OpenAI](https://img.shields.io/badge/OpenAI-412991?style=flat-square&logo=openai&logoColor=white)](https://platform.openai.com/)
[![Gemini](https://img.shields.io/badge/Gemini-1F6FEB?style=flat-square&logo=googlegemini&logoColor=white)](https://ai.google.dev/)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/Icarus603/claude-code/releases/latest)

终端编程智能体。单一 binary,命令为 `ccb`。Claude Code 的社区维护衍生版。

与 Anthropic 无关。如需官方工具请见 <https://docs.anthropic.com/en/docs/claude-code/overview>。

---

## 📦 安装

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

装在 `~/.local/share/ccb/versions/<version>`,并在 `~/.local/bin/ccb` 建立 symlink。不需要 Node、不需要 Bun、不需要任何包管理器。

| 变量 | 默认 | 用途 |
|------|------|------|
| `CCB_VERSION` | `latest` | 锁定特定 tag,例如 `v1.carus.000` |
| `CCB_PREFIX`  | `~/.local` | 安装根目录(`/usr/local` 为系统范围) |

升级:重跑同一个 `curl ... | bash`。卸载:`rm -rf ~/.local/share/ccb ~/.local/bin/ccb`。

---

## 🚀 使用

```bash
ccb              # 交互式 REPL
ccb --version
ccb --help
```

第一次执行会提示 `/login`。对话框让你选 provider:

- **Anthropic Compatible** — 任何 Anthropic 格式端点(Anthropic 本身、第三方 proxy、自架)
- **OpenAI Compatible** — OpenAI 本身 + 所有兼容 protocol(DeepSeek、Ollama、vLLM、...)
- **Gemini API** — Google Gemini 原生 REST/SSE
- **Anthropic Console account** — claude.ai 的 OAuth 登录

Base URL、API key、模型 ID 都在对话框里填,shell 不用 export。要换 provider 再敲 `/login`。

各功能深入文档见 [`docs/`](docs/)。

### 🤖 Headless / 脚本用法

CI 或 `--print` 模式下没 REPL 可以开 `/login`,env vars 也支持:

| 变量 | 用途 |
|------|------|
| `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` | Anthropic 认证 + 端点 |
| `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_DEFAULT_*_MODEL` | OpenAI 兼容端点 |
| `GEMINI_API_KEY`、`GEMINI_BASE_URL`、`GEMINI_DEFAULT_*_MODEL` | Gemini 端点 |
| `FEATURE_<FLAG>=1` | runtime 启用 build-time feature flag |

---

## 🛠️ 从源码构建

唯一需求是 [Bun](https://bun.sh) ≥ 1.3.0。

```bash
git clone https://github.com/Icarus603/claude-code.git
cd claude-code
bun install

bun run dev               # hot-reload,无 build 步骤
bun run build:standalone  # → dist/ccb(当前平台)
bun run build:platforms   # → dist/binaries/ccb-{darwin,linux,windows}-{arm64,x64}[.exe]
bun test
bun run doctor:arch       # 架构不变式 — 必须通过
```

`bun build --compile --target=bun-<os>-<arch>` cross-compile 每个平台约 0.4 秒。Release workflow([`.github/workflows/release.yml`](.github/workflows/release.yml))在 tag push 时跑。

---

## 🤝 贡献

欢迎 PR。

- `bun run doctor:arch` 必须通过。不准 `--no-verify`。
- `bun test` 必须通过。为新行为加测试。
- `tsc-errors` ratchet 只允许数字下降。
- Commit message 解释 *为什么*;diff 已经显示 *做了什么*。
- 不要把 npm 发布加回来。本项目设计就是 binary-only。

```bash
gh repo fork Icarus603/claude-code
git checkout -b feat/your-thing
# ...
bun run doctor:arch && bun test
gh pr create
```

架构惯例见 [`docs/lazy-require-pattern.md`](docs/lazy-require-pattern.md) 与 [`scripts/`](scripts/) 下的 doctor 脚本。

---

## 🏷️ 发版

只给维护者。

```bash
git tag v1.carus.001
git push --tags
```

GitHub Actions 会构建 5 个 binary 并上传到 Releases。

---

## 🧬 沿革

`ccb` 衍生自公开的 Claude Code 社区 fork。见 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。本项目未附独立许可证文件 — 重新发布前请审核 provenance。

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [`docs/`](docs/) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
