# Claude Code V5 by Icarus603

[English](./README.md) | [繁體中文](./README.zh-TW.md)

[![GitHub Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/Icarus603/claude-code?style=flat-square&color=orange)](https://github.com/Icarus603/claude-code/issues)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=blue)](https://github.com/Icarus603/claude-code/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)

> Which Claude do you like? The one we can actually maintain.

这个项目目前由 **Icarus603** 独立维护，定位为一条可持续演进的 Claude Code 衍生主线。

它最初来自公开的 Claude Code 社区分支演化，我们保留必要的来源说明与授权信息，但后续 roadmap、重构方向与质量标准将以本仓库为准。

- ✅ V4：测试补强、Buddy、Auto Mode、Feature Flags
- ✅ V5：Sentry / GrowthBook、自定义登录、OpenAI 相容、Web Search、Computer Use、Voice Mode、Bridge Mode
- 🔮 V6：全面分包重构、模块边界重整、建立独立维护主线

## 快速开始

### 环境需求

- [Bun](https://bun.sh/) >= 1.3.11
- 可用的 Claude / Anthropic 相容 API 提供商設定

### 安装

```bash
bun install
```

### 运行

```bash
bun run dev
bun run build
```

构建采用 code splitting（[`build.ts`](build.ts)），产物输出到 `dist/`，入口为 `dist/cli.js`。

### 首次登录设置

首次运行后，在 REPL 中输入 `/login` 进入设置界面。选择 **Anthropic Compatible** 可接入第三方 Anthropic API 相容服务，不需要 Anthropic 官方账号。

常见字段如下：

| 字段 | 说明 | 示例 |
|------|------|------|
| Base URL | API 服务地址 | `https://api.example.com/v1` |
| API Key | 认证密钥 | `sk-xxx` |
| Haiku Model | 快速模型 ID | `claude-haiku-4-5-20251001` |
| Sonnet Model | 平衡模型 ID | `claude-sonnet-4-6` |
| Opus Model | 高性能模型 ID | `claude-opus-4-6` |

## Feature Flags

所有功能开关都可以通过 `FEATURE_<FLAG_NAME>=1` 环境变量启用，例如：

```bash
FEATURE_BUDDY=1 FEATURE_FORK_SUBAGENT=1 bun run dev
```

更完整的功能说明可参考 [`docs/features/`](docs/features/)。

## VS Code 调试

TUI（REPL）模式需要真实终端，因此无法直接用普通 launch config 启动；建议使用 attach 模式：

1. 在终端启动 inspect：
   ```bash
   bun run dev:inspect
   ```
2. 在 VS Code 中附加 debugger：
   - 在 `src/` 设置断点
   - 按 `F5`
   - 选择 **Attach to Bun (TUI debug)**

## 文档

- [`docs/`](docs/) 中包含架构、功能、安全模型与测试规划文档
- 英文首页请见 [`README.md`](./README.md)
- 繁体中文版请见 [`README.zh-TW.md`](./README.zh-TW.md)

## 项目状态

当前这个 repo 的方向是：

- 建立 Icarus603 自主维护的主线
- 逐步把对外文案与中文文档整理成清晰的多语版本
- 为 V6 的分包式重构预先整理边界与治理方式

## Contributors

<a href="https://github.com/Icarus603/claude-code/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## 授权与来源

本项目保留必要的来源脉络与 attribution。它已经演化为 **Icarus603** 维护的独立主线，但并非从零开始的新作。

本仓库目前没有单独声明的开源授权文件。若要再分发、再发布或下游复用，请先自行确认来源权利与授权风险。
