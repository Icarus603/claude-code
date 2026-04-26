# Claude Code Best

[English](./README.md) | [簡體中文](./README.zh-CN.md)

終端編程智慧體。單一 binary,命令為 `ccb`。Claude Code 的社群維護衍生版。

與 Anthropic 無關。如需官方工具請見 <https://docs.anthropic.com/en/docs/claude-code/overview>。

---

## 安裝

```bash
curl -fsSL https://raw.githubusercontent.com/Icarus603/claude-code/main/install.sh | bash
```

裝在 `~/.local/share/ccb/versions/<version>`,並在 `~/.local/bin/ccb` 建立 symlink。不需要 Node、不需要 Bun、不需要任何套件管理器。

| 變數 | 預設 | 用途 |
|------|------|------|
| `CCB_VERSION` | `latest` | 鎖定特定 tag,例如 `v1.carus.000` |
| `CCB_PREFIX`  | `~/.local` | 安裝根目錄(`/usr/local` 為系統範圍) |

升級：重跑同一個 `curl ... | bash`。解除安裝：`rm -rf ~/.local/share/ccb ~/.local/bin/ccb`。

---

## 使用

```bash
ccb              # 互動式 REPL
ccb --version
ccb --help
```

第一次執行會提示 `/login`。對話框讓你選 provider:

- **Anthropic Compatible** — 任何 Anthropic 格式端點(Anthropic 本身、第三方 proxy、自架)
- **OpenAI Compatible** — OpenAI 本身 + 所有相容 protocol(DeepSeek、Ollama、vLLM、...)
- **Gemini API** — Google Gemini 原生 REST/SSE
- **Anthropic Console account** — claude.ai 的 OAuth 登入

Base URL、API key、模型 ID 都在對話框裡填,shell 不用 export。要換 provider 再敲 `/login`。

各功能深入文檔見 [`docs/`](docs/)。

### Headless / 腳本用法

CI 或 `--print` 模式下沒 REPL 可以開 `/login`,env vars 也支援:

| 變數 | 用途 |
|------|------|
| `ANTHROPIC_API_KEY`、`ANTHROPIC_BASE_URL` | Anthropic 認證 + 端點 |
| `OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_DEFAULT_*_MODEL` | OpenAI 相容端點 |
| `GEMINI_API_KEY`、`GEMINI_BASE_URL`、`GEMINI_DEFAULT_*_MODEL` | Gemini 端點 |
| `FEATURE_<FLAG>=1` | runtime 啟用 build-time feature flag |

---

## 從原始碼建構

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

### 結構

```
packages/                 ← 所有原始碼(沒有 src/)
├── agent/                  agent loop、hooks、messages、tools dispatch
├── app-host/               runtime 組裝 + bootstrap
├── cli/src/entry/          binary 入口
├── command-runtime/        slash 命令 + skills
├── config/                 settings、env、feature flags、plugin loader
├── headless-sdk/           公開 TypeScript SDK 介面
├── permission/             工具權限 UX + 分類器
├── provider/               Anthropic / OpenAI 相容 / Gemini / Grok 適配器
├── repl/                   Ink-based TUI
├── shell/                  bash/powershell parser + sandbox
├── storage/                JSONL session 檔案、檔案快取
├── tool-registry/          工具定義
└── ...                     mcp-runtime、voice、swarm、bridge、daemon、...

scripts/
└── doctor-architecture.ts  CI 通過與否的真實依據
```

---

## 貢獻

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

## 發版

只給維護者。

```bash
git tag v1.carus.001
git push --tags
```

GitHub Actions 會建構 5 個 binary 並上傳到 Releases。

---

## 沿革

`ccb` 衍生自公開的 Claude Code 社群 fork。見 [`ATTRIBUTION.md`](./ATTRIBUTION.md)。本專案未附獨立授權檔 — 重新發布前請審核 provenance。

---

[Issues](https://github.com/Icarus603/claude-code/issues) · [`docs/`](docs/) · [Anthropic 官方 Claude Code](https://docs.anthropic.com/en/docs/claude-code/overview)
