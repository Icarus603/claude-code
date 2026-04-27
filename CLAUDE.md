# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a **reverse-engineered / decompiled** version of Anthropic's official Claude Code CLI tool. The goal is to restore core functionality while trimming secondary capabilities. Many modules are stubbed or feature-flagged off. The codebase has ~1341 tsc errors from decompilation (mostly `unknown`/`never`/`{}` types) — these do **not** block Bun runtime execution.

## Commands

```bash
# Install dependencies
bun install

# Dev mode (runs cli.tsx with MACRO defines injected via -d flags)
bun run dev

# Dev mode with debugger (set BUN_INSPECT=9229 to pick port)
bun run dev:inspect

# Pipe mode
echo "say hello" | bun run src/entrypoints/cli.tsx -p

# Build (code splitting, outputs dist/cli.js + ~450 chunk files)
bun run build

# Test
bun test                  # run all tests
bun test src/utils/__tests__/hash.test.ts   # run single file
bun test --coverage       # with coverage report

# Lint & Format (Biome)
bun run lint              # check only
bun run lint:fix          # auto-fix
bun run format            # format all src/

# Health check
bun run health

# Check unused exports
bun run check:unused

# Docs dev server (Mintlify)
bun run docs:dev
```

詳細的測試規範、覆蓋狀態和改進計劃見 `docs/testing-spec.md`。

## Architecture

### Runtime & Build

- **Runtime**: Bun (not Node.js). All imports, builds, and execution use Bun APIs.
- **Build**: `build.ts` 執行 `Bun.build()` with `splitting: true`，入口 `src/entrypoints/cli.tsx`，輸出 `dist/cli.js` + chunk files。默認啓用 `AGENT_TRIGGERS_REMOTE`、`CHICAGO_MCP`、`VOICE_MODE` feature。構建後自動替換 `import.meta.require` 爲 Node.js 兼容版本（產物 bun/node 都可運行）。
- **Dev mode**: `scripts/dev.ts` 通過 Bun `-d` flag 注入 `MACRO.*` defines，運行 `src/entrypoints/cli.tsx`。默認啓用 `TRANSCRIPT_CLASSIFIER`、`BRIDGE_MODE`、`AGENT_TRIGGERS_REMOTE`、`CHICAGO_MCP`、`VOICE_MODE` 等 feature。
- **Module system**: ESM (`"type": "module"`), TSX with `react-jsx` transform.
- **Monorepo**: Bun workspaces — internal packages live in `packages/` resolved via `workspace:*`.
- **Lint/Format**: Biome (`biome.json`)。`bun run lint` / `bun run lint:fix` / `bun run format`。
- **Defines**: 集中管理在 `scripts/defines.ts`。當前版本 `2.1.888`。

### Entry & Bootstrap

1. **`src/entrypoints/cli.tsx`** — True entrypoint。`main()` 函數按優先級處理多條快速路徑：
   - `--version` / `-v` — 零模塊加載
   - `--dump-system-prompt` — feature-gated (DUMP_SYSTEM_PROMPT)
   - `--claude-in-chrome-mcp` / `--chrome-native-host`
   - `--daemon-worker=<kind>` — feature-gated (DAEMON)
   - `remote-control` / `rc` / `bridge` — feature-gated (BRIDGE_MODE)
   - `daemon` — feature-gated (DAEMON)
   - `ps` / `logs` / `attach` / `kill` / `--bg` — feature-gated (BG_SESSIONS)
   - `--tmux` + `--worktree` 組合
   - 默認路徑：加載 `main.tsx` 啓動完整 CLI
2. **`src/main.tsx`** (~4680 行) — Commander.js CLI definition。註冊大量 subcommands：`mcp` (serve/add/remove/list...)、`server`、`ssh`、`open`、`auth`、`plugin`、`agents`、`auto-mode`、`doctor`、`update` 等。主 `.action()` 處理器負責權限、MCP、會話恢復、REPL/Headless 模式分發。
3. **`src/entrypoints/init.ts`** — One-time initialization (telemetry, config, trust dialog)。

### Core Loop

- **`src/query.ts`** — The main API query function. Sends messages to Claude API, handles streaming responses, processes tool calls, and manages the conversation turn loop.
- **`src/QueryEngine.ts`** — Higher-level orchestrator wrapping `query()`. Manages conversation state, compaction, file history snapshots, attribution, and turn-level bookkeeping. Used by the REPL screen.
- **`src/screens/REPL.tsx`** — The interactive REPL screen (React/Ink component). Handles user input, message display, tool permission prompts, and keyboard shortcuts.

### API Layer

- **`src/services/api/claude.ts`** — Core API client. Builds request params (system prompt, messages, tools, betas), calls the Anthropic SDK streaming endpoint, and processes `BetaRawMessageStreamEvent` events.
- Supports multiple providers: Anthropic direct, AWS Bedrock, Google Vertex, Azure.
- Provider selection in `src/utils/model/providers.ts`.

### Tool System

- **`src/Tool.ts`** — Tool interface definition (`Tool` type) and utilities (`findToolByName`, `toolMatchesName`).
- **`src/tools.ts`** — Tool registry. Assembles the tool list; some tools are conditionally loaded via `feature()` flags or `process.env.USER_TYPE`.
- **`src/tools/<ToolName>/`** — 61 個 tool 目錄（如 BashTool, FileEditTool, GrepTool, AgentTool, WebFetchTool, LSPTool, MCPTool 等）。每個 tool 包含 `name`、`description`、`inputSchema`、`call()` 及可選的 React 渲染組件。
- **`src/tools/shared/`** — Tool 共享工具函數。

### UI Layer (Ink)

- **`src/ink.ts`** — Ink render wrapper with ThemeProvider injection.
- **`src/ink/`** — Custom Ink framework (forked/internal): custom reconciler, hooks (`useInput`, `useTerminalSize`, `useSearchHighlight`), virtual list rendering.
- **`src/components/`** — 大量 React 組件（170+ 項），渲染於終端 Ink 環境中。關鍵組件：
  - `App.tsx` — Root provider (AppState, Stats, FpsMetrics)
  - `Messages.tsx` / `MessageRow.tsx` — Conversation message rendering
  - `PromptInput/` — User input handling
  - `permissions/` — Tool permission approval UI
  - `design-system/` — 複用 UI 組件（Dialog, FuzzyPicker, ProgressBar, ThemeProvider 等）
- Components use React Compiler runtime (`react/compiler-runtime`) — decompiled output has `_c()` memoization calls throughout.

### State Management

- **`src/state/AppState.tsx`** — Central app state type and context provider. Contains messages, tools, permissions, MCP connections, etc.
- **`src/state/AppStateStore.ts`** — Default state and store factory.
- **`src/state/store.ts`** — Zustand-style store for AppState (`createStore`).
- **`src/state/selectors.ts`** — State selectors.
- **`src/bootstrap/state.ts`** — Module-level singletons for session-global state (session ID, CWD, project root, token counts, model overrides, client type, permission mode).

### Bridge / Remote Control

- **`src/bridge/`** (~35 files) — Remote Control / Bridge 模式。feature-gated by `BRIDGE_MODE`。包含 bridge API、會話管理、JWT 認證、消息傳輸、權限回調等。Entry: `bridgeMain.ts`。
- CLI 快速路徑: `claude remote-control` / `claude rc` / `claude bridge`。

### Daemon Mode

- **`src/daemon/`** — Daemon 模式（長駐 supervisor）。feature-gated by `DAEMON`。包含 `main.ts`（entry）和 `workerRegistry.ts`（worker 管理）。

### Context & System Prompt

- **`src/context.ts`** — Builds system/user context for the API call (git status, date, CLAUDE.md contents, memory files).
- **`src/utils/claudemd.ts`** — Discovers and loads CLAUDE.md files from project hierarchy.

### Feature Flag System

Feature flags control which functionality is enabled at runtime:

- **在代碼中使用**: 統一通過 `import { feature } from 'bun:bundle'` 導入，調用 `feature('FLAG_NAME')` 返回 `boolean`。**不要**在 `cli.tsx` 或其他文件裏自己定義 `feature` 函數或覆蓋這個 import。
- **啓用方式**: 通過環境變量 `FEATURE_<FLAG_NAME>=1`。例如 `FEATURE_FORK_SUBAGENT=1 bun run dev` 啓用對應功能。
- **Dev 默認 features**: `TRANSCRIPT_CLASSIFIER`、`BRIDGE_MODE`、`AGENT_TRIGGERS_REMOTE`、`CHICAGO_MCP`、`VOICE_MODE`（見 `scripts/dev.ts`）。
- **Build 默認 features**: `AGENT_TRIGGERS_REMOTE`、`CHICAGO_MCP`、`VOICE_MODE`（見 `build.ts`）。
- **常見 flag**: `DAEMON`, `BRIDGE_MODE`, `BG_SESSIONS`, `PROACTIVE`, `KAIROS`, `VOICE_MODE`, `FORK_SUBAGENT`, `SSH_REMOTE`, `DIRECT_CONNECT`, `TEMPLATES`, `CHICAGO_MCP`, `BYOC_ENVIRONMENT_RUNNER`, `SELF_HOSTED_RUNNER`, `COORDINATOR_MODE`, `UDS_INBOX`, `LODESTONE`, `ABLATION_BASELINE` 等。
- **類型聲明**: `src/types/internal-modules.d.ts` 中聲明瞭 `bun:bundle` 模塊的 `feature` 函數簽名。

**新增功能的正確做法**: 保留 `import { feature } from 'bun:bundle'` + `feature('FLAG_NAME')` 的標準模式，在運行時通過環境變量或配置控制，不要繞過 feature flag 直接 import。

### Stubbed/Deleted Modules

| Module | Status |
|--------|--------|
| Computer Use (`@ant/*`) | Restored — `computer-use-swift`, `computer-use-input`, `computer-use-mcp`, `claude-for-chrome-mcp` 均有完整實現，macOS + Windows 可用，Linux 後端待完成 |
| `*-napi` packages | `audio-capture-napi`、`image-processor-napi` 已恢復實現；`color-diff-napi` 完整實現；`url-handler-napi`、`modifiers-napi` 仍爲 stub |
| Voice Mode | Restored — `src/voice/`、`src/hooks/useVoiceIntegration.tsx`、`src/services/voiceStreamSTT.ts` 等，Push-to-Talk 語音輸入（需 Anthropic OAuth） |
| OpenAI 兼容層 | Restored — `src/services/api/openai/`，支持 Ollama/DeepSeek/vLLM 等任意 OpenAI 協議端點，通過 `CLAUDE_CODE_USE_OPENAI=1` 啓用 |
| Analytics / GrowthBook / Sentry | Empty implementations |
| Magic Docs / LSP Server | Removed |
| Plugins / Marketplace | Removed |
| MCP OAuth | Simplified |

### Computer Use

Feature flag `CHICAGO_MCP`，dev/build 默認啓用。實現跨平臺屏幕操控（macOS + Windows 可用，Linux 待完成）。

- **`packages/@ant/computer-use-mcp/`** — MCP server，註冊截圖/鍵鼠/剪貼板/應用管理工具
- **`packages/@ant/computer-use-input/`** — 鍵鼠模擬，dispatcher + per-platform backend（`backends/darwin.ts`、`win32.ts`、`linux.ts`）
- **`packages/@ant/computer-use-swift/`** — 截圖 + 應用管理，同樣 dispatcher + per-platform backend
- **`packages/@ant/claude-for-chrome-mcp/`** — Chrome 瀏覽器控制（獨立於 Computer Use，通過 `--chrome` CLI 參數啓用）

詳見 `docs/features/computer-use.md`。

### Voice Mode

Feature flag `VOICE_MODE`，dev/build 默認啓用。Push-to-Talk 語音輸入，音頻通過 WebSocket 流式傳輸到 Anthropic STT（Nova 3）。需要 Anthropic OAuth（非 API key）。

- **`src/voice/voiceModeEnabled.ts`** — 三層門控（feature flag + GrowthBook + OAuth auth）
- **`src/hooks/useVoice.ts`** — React hook 管理錄音狀態和 WebSocket 連接
- **`src/services/voiceStreamSTT.ts`** — STT WebSocket 流式傳輸

詳見 `docs/features/voice-mode.md`。

### OpenAI 兼容層

通過 `CLAUDE_CODE_USE_OPENAI=1` 環境變量啓用，支持任意 OpenAI Chat Completions 協議端點（Ollama、DeepSeek、vLLM 等）。流適配器模式：在 `queryModel()` 中將 Anthropic 格式請求轉爲 OpenAI 格式，再將 SSE 流轉換回 `BetaRawMessageStreamEvent`，下游代碼完全不改。

- **`src/services/api/openai/`** — client、消息/工具轉換、流適配、模型映射
- **`src/utils/model/providers.ts`** — 添加 `'openai'` provider 類型（最高優先級）

關鍵環境變量：`CLAUDE_CODE_USE_OPENAI`、`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`OPENAI_MODEL`、`OPENAI_DEFAULT_OPUS_MODEL`、`OPENAI_DEFAULT_SONNET_MODEL`、`OPENAI_DEFAULT_HAIKU_MODEL`。詳見 `docs/plans/openai-compatibility.md`。

### Gemini 兼容層

通過 `CLAUDE_CODE_USE_GEMINI=1` 環境變量或 `modelType: "gemini"` 設置啓用，支持 Google Gemini API。獨立的環境變量體系，不與 OpenAI 或 Anthropic 配置混雜。

- **`src/services/api/gemini/`** — client、模型映射、類型定義
- **`src/utils/model/providers.ts`** — 添加 `'gemini'` provider 類型
- **`src/utils/managedEnvConstants.ts`** — Gemini 專用的 managed env vars

關鍵環境變量：
- `CLAUDE_CODE_USE_GEMINI` - 啓用 Gemini provider
- `GEMINI_API_KEY` - API 密鑰（必填）
- `GEMINI_BASE_URL` - API 端點（可選，默認 `https://generativelanguage.googleapis.com/v1beta`）
- `GEMINI_MODEL` - 直接指定模型（最高優先級）
- `GEMINI_DEFAULT_HAIKU_MODEL` / `GEMINI_DEFAULT_SONNET_MODEL` / `GEMINI_DEFAULT_OPUS_MODEL` - 按能力級別映射
- `GEMINI_DEFAULT_HAIKU_MODEL_NAME` / `DESCRIPTION` / `SUPPORTED_CAPABILITIES` - 顯示名稱和描述
- `GEMINI_SMALL_FAST_MODEL` - 快速任務使用的模型（可選）

模型映射優先級（`src/services/api/gemini/modelMapping.ts`）：
1. `GEMINI_MODEL` - 直接覆蓋
2. `GEMINI_DEFAULT_*_MODEL` - 獨立配置（推薦）
3. `ANTHROPIC_DEFAULT_*_MODEL` - 向後兼容 fallback（已廢棄）
4. 原樣返回 Anthropic 模型名

使用示例：
```bash
export CLAUDE_CODE_USE_GEMINI=1
export GEMINI_API_KEY="your-api-key"
export GEMINI_DEFAULT_SONNET_MODEL="gemini-2.5-flash"
export GEMINI_DEFAULT_OPUS_MODEL="gemini-2.5-pro"
```

### Key Type Files

- **`src/types/global.d.ts`** — Declares `MACRO`, `BUILD_TARGET`, `BUILD_ENV` and internal Anthropic-only identifiers.
- **`src/types/internal-modules.d.ts`** — Type declarations for `bun:bundle`, `bun:ffi`, `@anthropic-ai/mcpb`.
- **`src/types/message.ts`** — Message type hierarchy (UserMessage, AssistantMessage, SystemMessage, etc.).
- **`src/types/permissions.ts`** — Permission mode and result types.

## Testing

- **框架**: `bun:test`（內置斷言 + mock）
- **單元測試**: 就近放置於 `src/**/__tests__/`，文件名 `<module>.test.ts`
- **集成測試**: `tests/integration/` — 4 個文件（cli-arguments, context-build, message-pipeline, tool-chain）
- **共享 mock/fixture**: `tests/mocks/`（api-responses, file-system, fixtures/）
- **命名**: `describe("functionName")` + `test("behavior description")`，英文
- **Mock 模式**: 對重依賴模塊使用 `mock.module()` + `await import()` 解鎖（必須內聯在測試文件中，不能從共享 helper 導入）
- **當前狀態**: ~1623 tests / 114 files (110 unit + 4 integration) / 0 fail（詳見 `docs/testing-spec.md`）

## Architecture Doctor

- **Run**: `bun run scripts/doctor-architecture.ts` — 46 rules covering owner-over-shim, encapsulation, ratchets, and feature flag boundaries. All must pass before merging.
- **Pre-commit**: `.githooks/pre-commit` runs the fast subset (~8 rules, <2s). Set up via `bun install` (the `prepare` script wires `core.hooksPath`).
- **Bypass**: `PRE_COMMIT_SKIP=1 git commit ...` only when you truly understand why the rule mis-flags your change.
- **Ratchets**: many rules count something (LOC, tsc errors, cycles, coupling) and lock the current value. They can shrink but not grow. To bump downward: do the work, run the verifier, update the constant.

## Versioning & Releases

**Tag scheme**: `v<年>.<月>.<月內第N次>` (CalVer)。例:
```
v26.4.1   ← 2026 年 4 月第 1 次發版
v26.4.2   ← 同一天再發也用這個格式
v26.5.1   ← 進入 5 月,計數歸零
```

**為什麼這樣設計**:
- 嚴格 3-segment 純數字 → semver 工具 (`isVersionNewer`、npm `semver`、GitHub release 排序) 全部原生支援,零改動
- `26.4.99 < 26.5.1` 自然成立,不會發生比較反轉
- 一個月最多幾十次發版,patch 段不會爆位
- 跟 ant 官方的 `v2.1.NNN` 視覺/語義都明確區隔
- **不要再把 "carus" 之類的識別字串塞進版本號** —— 那破壞排序,而且印記應該放在 `--version` 輸出 / banner / README 裡,版本號本質是給機器排序用的

**歷史版本**: `v1.carus.NNN` 系列 (001 ~ 009) 是舊命名,保留不刪當作歷史。`26.x.x > 1.x.x` 數值上成立,auto-update 會自然把使用者升上去。

**發版流程**:
```bash
bun run release v26.4.1   # 自動 tag + push;CI 跑 release.yml 構建 + 上傳 binary
```
詳見 `scripts/release.ts`。`MACRO.VERSION` 從 git tag 推出來 (`scripts/defines.ts`),沒有任何版本號要手動同步。

## Working with This Codebase

- **Don't try to fix all tsc errors** — they're from decompilation and don't affect runtime.
- **Feature flags** — 默認全部關閉（`feature()` 返回 `false`）。Dev/build 各有自己的默認啓用列表。不要在 `cli.tsx` 中重定義 `feature` 函數。
- **React Compiler output** — Components have decompiled memoization boilerplate (`const $ = _c(N)`). This is normal.
- **`bun:bundle` import** — `import { feature } from 'bun:bundle'` 是 Bun 內置模塊，由運行時/構建器解析。不要用自定義函數替代它。
- **`src/` path alias** — tsconfig maps `src/*` to `./src/*`. Imports like `import { ... } from 'src/utils/...'` are valid.
- **MACRO defines** — 集中管理在 `scripts/defines.ts`。Dev mode 通過 `bun -d` 注入，build 通過 `Bun.build({ define })` 注入。修改版本號等常量只改這個文件。
- **構建產物兼容 Node.js** — `build.ts` 會自動後處理 `import.meta.require`，產物可直接用 `node dist/cli.js` 運行。
- **Biome 配置** — 大量 lint 規則被關閉（decompiled 代碼不適合嚴格 lint）。`.tsx` 文件用 120 行寬 + 強制分號；其他文件 80 行寬 + 按需分號。
