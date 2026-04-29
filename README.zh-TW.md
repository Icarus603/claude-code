# Claude Code Best

[English](./README.md) | [简体中文](./README.zh-CN.md)

[![Release](https://img.shields.io/github/v/release/Icarus603/claude-code?style=flat-square&color=blue&label=release)](https://github.com/Icarus603/claude-code/releases)
[![Stars](https://img.shields.io/github/stars/Icarus603/claude-code?style=flat-square&logo=github&color=yellow)](https://github.com/Icarus603/claude-code/stargazers)
[![Last Commit](https://img.shields.io/github/last-commit/Icarus603/claude-code?style=flat-square&color=green)](https://github.com/Icarus603/claude-code/commits/main)
[![Issues](https://img.shields.io/github/issues/Icarus603/claude-code?style=flat-square&color=orange)](https://github.com/Icarus603/claude-code/issues)
[![Bun](https://img.shields.io/badge/runtime-Bun%20%E2%89%A51.3-black?style=flat-square&logo=bun&logoColor=white)](https://bun.sh/)
[![Platforms](https://img.shields.io/badge/platforms-macOS%20%7C%20Linux%20%7C%20Windows-lightgrey?style=flat-square)](https://github.com/Icarus603/claude-code/releases/latest)

終端編程智慧體。單一 binary,命令為 `ccb`。Claude Code 的社群維護衍生版 — 詳見 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。與 Anthropic 無關;如需官方工具請見 <https://docs.anthropic.com/en/docs/claude-code/overview>。本 repo 不附獨立 LICENSE 檔 — 二次散佈前請先確認來源。

---

## 📦 安裝

**macOS / Linux**(Windows 的 Git Bash / WSL 也適用):

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

裝在 `~/.local/share/ccb/versions/<version>`,並在 `~/.local/bin/ccb` 建立 symlink。

**Windows**(PowerShell):

```powershell
irm https://raw.githubusercontent.com/Icarus603/claude-code/main/install.ps1 | iex
```

裝在 `%LOCALAPPDATA%\Programs\ccb\versions\<version>.exe`,並在 `%LOCALAPPDATA%\Programs\ccb\bin\ccb.exe` 放一份副本,同時自動把 bin 目錄加進 user `PATH`。不需要管理員權限。

兩種方式都不需要 Node、Bun 或任何套件管理器。

| 變數 | 預設(sh / ps1) | 用途 |
|------|------|------|
| `CCB_VERSION` | `latest` | 鎖定特定 tag,例如 `v26.4.24` |
| `CCB_PREFIX`  | `~/.local` / `%LOCALAPPDATA%\Programs\ccb` | 安裝根目錄 |

**升級**:不用動手。`ccb` 每次啟動 REPL(以及執行中每 30 分鐘)會去 GitHub Releases 檢查,有新版就在背景下載安裝 —— 完成時 footer 會顯示 `✓ Update installed · Restart to update`。如果要鎖特定版本,重跑那條 install 指令並透過 `CCB_VERSION=…` 指定即可。

解除安裝:
- macOS / Linux:`rm -rf ~/.local/share/ccb ~/.local/bin/ccb`
- Windows:`Remove-Item -Recurse -Force "$env:LOCALAPPDATA\Programs\ccb"`

> 不支援 Windows ARM64(Bun 沒有 `windows-arm64` compile target)。請在 x64 模擬下使用 x64 binary,或改走 WSL。

---

## 🚀 使用

```bash
ccb              # 互動式 REPL
ccb --version
ccb --help
```

第一次執行會提示 `/login`。對話框讓你選 provider:

- **Anthropic Console account** — claude.ai 的 OAuth 登入(Pro / Max / Team / Enterprise)
- **ChatGPT Codex** — ChatGPT 的 OAuth 登入(Plus / Pro / Business / Edu / Enterprise);走你 ChatGPT 訂閱額度,不是 API key 計費。模型來自 `chatgpt.com/backend-api/codex/responses`(gpt-5.5 / 5.4 / 5.4-mini / 5.3-codex / 5.2,支援 `low|medium|high|xhigh` reasoning effort)
- **Anthropic Compatible** — 任何 Anthropic 格式端點(Anthropic 本身、第三方 proxy、自架)
- **OpenAI Compatible** — OpenAI 本身 + 所有相容 protocol(DeepSeek、Ollama、vLLM、...)
- **Gemini API** — Google Gemini 原生 REST/SSE

多個 connection 可以同時存在 —— 同時登入 Claude Account 和 ChatGPT Codex,然後用 `/model` 在每個請求之間切換。Picker 每行對應一個 connection × 一個模型。`/effort` 會給每個模型帶他自己 tier 真實支援的 effort 階梯;`/status` 同時顯示每個已連線 provider 的用量。

Base URL、API key、模型 ID 都在對話框裡填(用得到的話),shell 不用 export。要換 provider 再敲 `/login`。

架構總覽見 [`CLAUDE.md`](CLAUDE.md)，feature flag 清單見 [`docs/feature-flags.md`](docs/feature-flags.md)。

### 🤖 Headless / 腳本用法

CI 或 `--print` 模式下沒 REPL 可以開 `/login`,env vars 也支援:

| 變數 | 用途 |
|------|------|
| `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` | Anthropic 認證 + 端點 |
| `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_DEFAULT_*_MODEL` | OpenAI 相容端點 |
| `GEMINI_API_KEY`、`GEMINI_BASE_URL`、`GEMINI_DEFAULT_*_MODEL` | Gemini 端點 |
| `FEATURE_<FLAG>=1` | runtime 啟用 build-time feature flag |

---

## 🛠️ 從原始碼建構

唯一需求是 [Bun](https://bun.sh) ≥ 1.3.0。

```bash
git clone https://github.com/Icarus603/claude-code.git
cd claude-code
bun install

bun run dev               # hot-reload,沒有 build 步驟
bun run build:standalone  # → dist/ccb(當前平臺)
bun run build:platforms   # → dist/binaries/ccb-{darwin,linux,windows}-{arm64,x64}[.exe]
bun test
bun run doctor:arch       # 架構不變式 — 必須通過
```

`bun build --compile --target=bun-<os>-<arch>` cross-compile 每個平臺約 0.4 秒。Release workflow([`.github/workflows/release.yml`](.github/workflows/release.yml))在 tag push 時跑。

---

## 🤝 貢獻

歡迎 PR。

- `bun run doctor:arch` 必須通過。不准 `--no-verify`。
- `bun test` 必須通過。為新行為加測試。
- `tsc-errors` ratchet 只允許數字下降。
- Commit message 解釋 *為什麼*;diff 已經顯示 *做了什麼*。
- 不要把 npm 發布加回來。本專案設計就是 binary-only。

```bash
gh repo fork Icarus603/claude-code
git checkout -b feat/your-thing
# ...
bun run doctor:arch && bun test
gh pr create
```

架構慣例見 [`docs/lazy-require-pattern.md`](docs/lazy-require-pattern.md) 與 [`scripts/`](scripts/) 下的 doctor 腳本。

---

## 🏷️ 發版

只給維護者。

```bash
bun run release v26.4.25
```

完事。Script 自己驗證 tag、建立、push。剩下交給 GitHub Actions 跑 — `MACRO.VERSION` 從 tag 推出來，沒有任何版本號要手動同步。

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [`docs/`](docs/) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
