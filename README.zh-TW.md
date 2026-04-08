# Claude Code V5 by Icarus603

[English](./README.md) | [簡體中文](./README.zh-CN.md)

[![GitHub Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![GitHub Contributors](https://img.shields.io/github/contributors/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/graphs/contributors)
[![GitHub Issues](https://img.shields.io/github/issues/Icarus603/claude-code?style=flat-square&color=orange)](https://github.com/Icarus603/claude-code/issues)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=blue)](https://github.com/Icarus603/claude-code/commits/main)
[![Bun](https://img.shields.io/badge/runtime-Bun-black?style=flat-square&logo=bun)](https://bun.sh/)

> Which Claude do you like? The one we can actually maintain.

這個專案目前由 **Icarus603** 獨立維護，定位為一條可持續演進的 Claude Code 衍生主線。

它最初來自公開的 Claude Code 社群分支演化，我們保留必要的來源說明與授權資訊，但後續 roadmap、重構方向與品質標準將以本倉庫為準。

- ✅ V4：測試補強、Buddy、Auto Mode、Feature Flags
- ✅ V5：Sentry / GrowthBook、自訂登入、OpenAI 相容、Web Search、Computer Use、Voice Mode、Bridge Mode
- 🔮 V6：全面分包重構、模組邊界重整、建立獨立維護主線

## 快速開始

### 環境需求

- [Bun](https://bun.sh/) >= 1.3.11
- 可用的 Claude / Anthropic 相容 API 供應商設定

### 安裝

```bash
bun install
```

### 執行

```bash
bun run dev
bun run build
```

建置採用 code splitting（[`build.ts`](build.ts)），產物輸出到 `dist/`，入口為 `dist/cli.js`。

### 首次登入設定

首次執行後，在 REPL 中輸入 `/login` 進入設定畫面。選擇 **Anthropic Compatible** 可接上第三方 Anthropic API 相容服務，不需要 Anthropic 官方帳號。

常見欄位如下：

| 欄位 | 說明 | 範例 |
|------|------|------|
| Base URL | API 服務位址 | `https://api.example.com/v1` |
| API Key | 驗證金鑰 | `sk-xxx` |
| Haiku Model | 快速模型 ID | `claude-haiku-4-5-20251001` |
| Sonnet Model | 平衡模型 ID | `claude-sonnet-4-6` |
| Opus Model | 高效能模型 ID | `claude-opus-4-6` |

## Feature Flags

所有功能旗標皆可透過 `FEATURE_<FLAG_NAME>=1` 環境變數啟用，例如：

```bash
FEATURE_BUDDY=1 FEATURE_FORK_SUBAGENT=1 bun run dev
```

更完整的功能說明可參考 [`docs/features/`](docs/features/)。

## VS Code 偵錯

TUI（REPL）模式需要真實終端，因此無法直接用一般 launch config 啟動；建議使用 attach 模式：

1. 在終端啟動 inspect：
   ```bash
   bun run dev:inspect
   ```
2. 在 VS Code 中附加 debugger：
   - 在 `src/` 設定中斷點
   - 按 `F5`
   - 選擇 **Attach to Bun (TUI debug)**

## 文件

- [`docs/`](docs/) 內包含架構、功能、安全模型與測試規劃文件
- 英文首頁請見 [`README.md`](./README.md)
- 簡體中文版請見 [`README.zh-CN.md`](./README.zh-CN.md)

## 專案狀態

目前這個 repo 的方向是：

- 建立 Icarus603 自主維護的主線
- 逐步把對外文案與中文文件整理成清楚的多語版本
- 為 V6 的分包式重構預先整理邊界與治理方式

## Contributors

<a href="https://github.com/Icarus603/claude-code/graphs/contributors">
  <img src="contributors.svg" alt="Contributors" />
</a>

## Star History

<a href="https://www.star-history.com/?repos=Icarus603%2Fclaude-code&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=Icarus603/claude-code&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=Icarus603/claude-code&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=Icarus603/claude-code&type=date&legend=top-left" />
 </picture>
</a>

## 授權與來源

本專案保留必要的來源脈絡與 attribution。它已演化為 **Icarus603** 維護的獨立主線，但並非從零開始的新作。

本倉庫目前沒有單獨宣告的開源授權檔案。若要再散布、再發布或下游轉用，請先自行確認來源權利與授權風險。
