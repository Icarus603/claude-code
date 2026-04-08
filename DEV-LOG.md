# DEV-LOG

## Daemon + Remote Control Server 還原 (2026-04-07)

**分支**: `feat/daemon-remote-control-server`

### 背景

`src/commands.ts` 註冊了 `remoteControlServer` 命令（雙重門控 `feature('DAEMON') && feature('BRIDGE_MODE')`），但 `src/commands/remoteControlServer/` 目錄缺失，`src/daemon/main.ts` 和 `src/daemon/workerRegistry.ts` 均爲 stub。官方 CLI 2.1.92 中情況一致——Anthropic 已預留註冊點和底層 `runBridgeHeadless()` 實現，但中間層（daemon supervisor + command 入口）未發佈。

通過逐級反向追蹤呼叫鏈還原完整實現：
```
/remote-control-server (slash command)
  → spawn: claude daemon start
    → daemonMain() (supervisor，管理 worker 生命週期)
      → spawn: claude --daemon-worker=remoteControl
        → runDaemonWorker('remoteControl')
          → runBridgeHeadless(opts, signal)  ← 已有完整實現
            → runBridgeLoop() → 接受遠程會話
```

### 實現

#### 1. Worker Registry（`src/daemon/workerRegistry.ts`）

從 stub 還原爲 worker 分發器：
- `runDaemonWorker(kind)` 按 `kind` 分發到不同 worker 實現
- `runRemoteControlWorker()` 從環境變量（`DAEMON_WORKER_*`）讀取設定，構造 `HeadlessBridgeOpts`，呼叫 `runBridgeHeadless()`
- 區分 permanent（`EXIT_CODE_PERMANENT = 78`）和 transient 錯誤，supervisor 據此決定重試或 park
- SIGTERM/SIGINT 信號處理，通過 `AbortController` 傳遞給 bridge loop

#### 2. Daemon Supervisor（`src/daemon/main.ts`）

從 stub 還原爲完整 supervisor 進程：
- `daemonMain(args)` 支援子命令：`start`（啓動）、`status`、`stop`、`--help`
- `runSupervisor()` spawn `remoteControl` worker 子進程，通過環境變量傳遞設定
- 指數退避重啓（2s → 120s），10s 內連續崩潰 5 次則 park worker
- permanent exit code（78）直接 park，不重試
- graceful shutdown：SIGTERM → 轉發給 worker → 30s grace → SIGKILL
- CLI 參數支援：`--dir`、`--spawn-mode`、`--capacity`、`--permission-mode`、`--sandbox`、`--name`

#### 3. Remote Control Server 命令（`src/commands/remoteControlServer/`）

**`index.ts`** — Command 註冊：
- 類型 `local-jsx`，名稱 `/remote-control-server`，別名 `/rcs`
- 雙 feature 門控：`feature('DAEMON') && feature('BRIDGE_MODE')` + `isBridgeEnabled()`
- lazy load `remoteControlServer.tsx`

**`remoteControlServer.tsx`** — REPL 內 UI：
- 首次呼叫：前置檢查（bridge 可用性 + OAuth token）→ spawn daemon 子進程
- 再次呼叫：彈出管理對話框（停止/重啓/繼續），顯示 PID 和最近 5 行日誌
- 模組級 state 跨呼叫保持 daemon 進程引用
- graceful stop：SIGTERM → 10s grace → SIGKILL

#### 4. Feature Flag 啓用

`build.ts` / `scripts/dev.ts`：`DEFAULT_BUILD_FEATURES` / `DEFAULT_FEATURES` 新增 `DAEMON`

DAEMON 僅有編譯時 feature flag 門控，無 GrowthBook gate。

### 與 `/remote-control` 的區別

| | `/remote-control` | `/remote-control-server` (daemon) |
|---|---|---|
| 模式 | 單會話，REPL 內交互式 bridge | 多會話，daemon 持久化服務器 |
| 生命週期 | 跟 REPL 會話綁定 | 獨立後臺進程，崩潰自動重啓 |
| 併發 | 1 個遠程連接 | 預設 4 個，可設定 `--capacity` |
| 隔離 | 共享當前目錄 | 支援 `worktree` 模式隔離 |
| 底層 | `initReplBridge()` | `runBridgeHeadless()` → `runBridgeLoop()` |

### 修改文件

| 文件 | 變更 |
|------|------|
| `build.ts` | `DEFAULT_BUILD_FEATURES` 新增 `DAEMON` |
| `scripts/dev.ts` | `DEFAULT_FEATURES` 新增 `DAEMON` |
| `src/daemon/main.ts` | 從 stub 還原爲 supervisor 實現 |
| `src/daemon/workerRegistry.ts` | 從 stub 還原爲 worker 分發器 |
| `src/commands/remoteControlServer/index.ts` | **新增** command 註冊 |
| `src/commands/remoteControlServer/remoteControlServer.tsx` | **新增** REPL UI |

### 驗證

| 專案 | 結果 |
|------|------|
| `bun run build` | ✅ 成功 (490 files) |
| tsc 新文件檢查 | ✅ 無新增類型錯誤 |

### 使用方式

```bash
# CLI 直接啓動 daemon
bun run dev daemon start
bun run dev daemon start --spawn-mode=worktree --capacity=8

# REPL 內
/remote-control-server   # 或 /rcs
```

前提：需要 Anthropic OAuth 登錄（`claude login`）。

---

## /ultraplan 啓用 + GrowthBook Fallback 加固 + Away Summary 改進 (2026-04-06)

**分支**: `feat/ultraplan-enablement`
**Commit**: `feat: enable /ultraplan and harden GrowthBook fallback chain`

### 背景

`/ultraplan` 是 Claude Code 的高級多代理規劃功能：將任務發送到 Claude Code on the web（CCR），由 Opus 進行深度規劃，計劃完成後返回終端供用戶審批和執行。此功能被 3 層門控鎖定：`feature('ULTRAPLAN')` 編譯 flag + `isEnabled: () => USER_TYPE === 'ant'` + `INTERNAL_ONLY_COMMANDS` 列表。

另外發現 GrowthBook fallback 鏈在 config 未初始化時會拋異常跳過 `LOCAL_GATE_DEFAULTS`，以及 Away Summary 在不支援 DECSET 1004 focus 事件的終端（CMD/PowerShell）上不工作。

### 實現

#### 1. Ultraplan 啓用

- `build.ts` / `scripts/dev.ts`: 添加 `ULTRAPLAN` 到預設編譯 flag
- `src/commands.ts`: 將 ultraplan 從 `INTERNAL_ONLY_COMMANDS` 移入公開 `COMMANDS` 列表
- `src/commands/ultraplan.tsx`: `isEnabled` 改爲 `() => true`
- `src/screens/REPL.tsx`: 添加 `UltraplanChoiceDialog`、`UltraplanLaunchDialog`、`launchUltraplan` 的 import（HEAD 版使用但未 import，構建報 `not defined`）

#### 2. 反編譯 UltraplanChoiceDialog / UltraplanLaunchDialog

REPL.tsx 引用這兩個組件但程式碼庫中不存在。從官方 CLI 2.1.92 的 `cli.js` 中定位 minified 函數 `M15`（UltraplanChoiceDialog）和 `P15`（UltraplanLaunchDialog），通過符號映射表反編譯爲可讀 TSX。

**`src/components/ultraplan/UltraplanChoiceDialog.tsx`** — 遠程計劃批准後的選擇對話框：
- 3 個選項：Implement here（注入當前會話）/ Start new session（清空會話重開）/ Cancel（保存到 .md 文件）
- 可滾動計劃預覽（ctrl+u/d 翻頁，鼠標滾輪），自適應終端高度
- 選擇後標記遠程 task 完成、清除 `ultraplanPendingChoice` 狀態、歸檔遠程 CCR session

**`src/components/ultraplan/UltraplanLaunchDialog.tsx`** — 啓動確認對話框：
- 顯示功能說明、時間估計（~10–30 min）、服務條款連結
- 處理 Remote Control bridge 衝突（選擇 run 時自動斷開 bridge）
- 首次使用時持久化 `hasSeenUltraplanTerms` 到全局設定

反編譯要點：剝離 React Compiler `_c(N)` 快取數組，還原爲標準 `useMemo`/`useCallback`；`useFocusedInputDialog()` 註冊 hook 省略（REPL 內部計算 `focusedInputDialog`）；GrowthBook 設定查詢替換爲本地預設值。

#### 3. GrowthBook Fallback 加固

`src/services/analytics/growthbook.ts`:
- `getFeatureValue_CACHED_MAY_BE_STALE`: 將 `getLocalGateDefault()` 查找移到 try/catch 外層
- `checkStatsigFeatureGate_CACHED_MAY_BE_STALE`: 同上，config 讀取包裹在 try/catch 中

修復前：config 未初始化 → `getGlobalConfig()` 拋異常 → catch 直接返回 `defaultValue` → 跳過 `LOCAL_GATE_DEFAULTS`
修復後：config 未初始化 → catch 靜默 → 繼續查 `LOCAL_GATE_DEFAULTS` → 有預設值就用，沒有才 fallback

#### 4. Away Summary 改進（Windows 終端相容）

**問題**：Away Summary（`feature('AWAY_SUMMARY')` + `tengu_sedge_lantern` gate，上一輪已啓用）依賴 DECSET 1004 終端 focus 事件檢測用戶是否離開。但 Windows 的 CMD 和 PowerShell 不支援此協議，`getTerminalFocusState()` 始終返回 `'unknown'`，原邏輯對 `'unknown'` 狀態執行 no-op，導致 Windows 用戶永遠無法觸發離開摘要。

**修改**：`src/hooks/useAwaySummary.ts`

1. **focus 狀態處理**：`'unknown'` 現在視同 `'blurred'`（可能已離開），訂閱時即啓動 idle timer（5 分鐘）
2. **idle-based 在場檢測**：新增 `isLoading` 轉換監聽作爲用戶活躍信號替代 focus 事件：
   - 用戶發起新 turn（`isLoading` → `true`）→ 說明在場，取消 idle timer + abort 進行中的生成
   - turn 結束（`isLoading` → `false`）→ 重啓 idle timer
   - timer 到期且無進行中 turn → 觸發 away summary 生成
3. **相容性**：僅在 `getTerminalFocusState() === 'unknown'` 時激活 idle 邏輯，支援 DECSET 1004 的終端（iTerm2、Windows Terminal、kitty 等）仍走原有 blur/focus 路徑

**效果**：Windows CMD/PowerShell 用戶離開終端 5 分鐘後，系統自動呼叫 API 生成摘要並作爲 `away_summary` 類型的系統訊息追加到對話流中，用戶回來時直接在 UI 中看到，無需執行任何命令

#### 5. Cron 定時任務管理技能

`src/skills/bundled/cronManage.ts`（**新增**）+ `src/skills/bundled/index.ts`：

KAIROS 定時任務系統（`tengu_kairos_cron` gate，已在上一輪 GrowthBook 啓用中開啓）提供了 `ScheduleCronTool` 來建立定時任務，但缺少用戶可呼叫的 list/delete 技能。新增兩個 bundled skill 補全管理閉環：

| 技能 | 用法 | 功能 |
|------|------|------|
| `/cron-list` | `/cron-list` | 呼叫 `CronListTool` 列出所有定時任務，表格顯示 ID、Schedule、Prompt、Recurring、Durable |
| `/cron-delete` | `/cron-delete <job-id>` | 呼叫 `CronDeleteTool` 按 ID 取消指定定時任務 |

兩個技能均受 `isKairosCronEnabled()` 門控（`feature('AGENT_TRIGGERS') && tengu_kairos_cron` gate），與 `ScheduleCronTool` 保持一致。

#### 6. Fullscreen 門控修復

- `src/utils/fullscreen.ts`: `isFullscreenEnvEnabled()` 從無條件返回 `true` 改爲 `process.env.USER_TYPE === 'ant'`，避免非 ant 用戶意外觸發全屏模式

### 修改文件

| 文件 | 變更 |
|------|------|
| `build.ts` | `DEFAULT_BUILD_FEATURES` 新增 `ULTRAPLAN` |
| `scripts/dev.ts` | `DEFAULT_FEATURES` 新增 `ULTRAPLAN` |
| `src/commands.ts` | ultraplan 移入公開命令列表 |
| `src/commands/ultraplan.tsx` | `isEnabled` 移除 ant-only 限制 |
| `src/components/ultraplan/UltraplanChoiceDialog.tsx` | **新增** 從 2.1.92 反編譯 |
| `src/components/ultraplan/UltraplanLaunchDialog.tsx` | **新增** 從 2.1.92 反編譯 |
| `src/screens/REPL.tsx` | 添加 3 個 import |
| `src/services/analytics/growthbook.ts` | fallback 鏈加固 |
| `src/hooks/useAwaySummary.ts` | idle-based 離開檢測 |
| `src/skills/bundled/index.ts` | 註冊 cron 技能 |
| `src/skills/bundled/cronManage.ts` | **新增** cron list/delete 技能 |
| `src/utils/fullscreen.ts` | fullscreen 門控修復 |

### 驗證

| 專案 | 結果 |
|------|------|
| `bun run build` | ✅ 成功 (480 files) |
| `bun run lint` | ✅ 僅已有 biome-ignore 警告 |
| `/ultraplan` 手動測試 | ✅ 命令註冊可見、能啓動遠程會話、能接收回傳計劃並顯示 ChoiceDialog |

### Ultraplan 工作流

```
/ultraplan <prompt>
  → UltraplanLaunchDialog 確認
  → teleportToRemote 建立 CCR 遠程會話
  → pollForApprovedExitPlanMode 輪詢（3s 間隔，30min 超時）
  → ExitPlanModeScanner 解析事件流
  → 計劃 approved → UltraplanChoiceDialog 顯示選擇
  → Implement here / Start new session / Cancel
```

需要 Anthropic OAuth（`/login`）。遠程會話在 claude.ai/code 上執行。

---

## GrowthBook Local Gate Defaults + P0/P1 Feature Enablement (2026-04-06)

**分支**: `feat/growthbook-enablement`

### 背景

Claude Code 使用 GrowthBook（Anthropic 自建 proxy at api.anthropic.com）進行遠程功能開關控制，程式碼中使用 `tengu_*` 前綴命名。在反編譯版本中 GrowthBook 不啓動（analytics 空實現），導致 70+ 個功能被 gate 攔截。

經 4 個並行研究代理深度分析，確認**所有被 gate 控制的功能程式碼都是真實現**（非 stub）。

### 實現方案

**Commit 1** (`feat`): 在 `growthbook.ts` 中添加 `LOCAL_GATE_DEFAULTS` 映射表（25+ boolean gates + 2 object config gates），修改 4 個 getter 函數在 `isGrowthBookEnabled() === false` 時查找本地預設值。

**Commit 2** (`fix`): 發現 `LOCAL_GATE_DEFAULTS` 在有 API key 的用戶環境下無效——因爲 `isGrowthBookEnabled()` 返回 `true`（analytics 未禁用），程式碼走 GrowthBook 路徑但快取爲空，直接返回 `defaultValue` 跳過了本地預設值。修復：在 3 個 getter 函數的快取 miss 路徑中插入 `LOCAL_GATE_DEFAULTS` 查找。同時修復 `tengu_onyx_plover` 值類型（`JSON.stringify` → 直接對象）和新增 `tengu_kairos_brief_config` 對象型 gate。

修復後的 fallback 鏈：
```
env overrides → config overrides → [GrowthBook 啓用?]
  → 內存快取 → 磁盤快取 → LOCAL_GATE_DEFAULTS → defaultValue
```

可通過 `CLAUDE_CODE_DISABLE_LOCAL_GATES=1` 環境變量一鍵禁用。

### 啓用的功能

**P0 — 純本地功能（7 個 gate）：**

| Gate | 功能 |
|------|------|
| `tengu_keybinding_customization_release` | 自定義快捷鍵（~/.claude/keybindings.json） |
| `tengu_streaming_tool_execution2` | 流式工具執行（邊收邊執行） |
| `tengu_kairos_cron` | 定時任務系統 |
| `tengu_amber_json_tools` | Token 高效 JSON 工具格式（省 ~4.5%） |
| `tengu_immediate_model_command` | 執行中即時切換模型 |
| `tengu_basalt_3kr` | MCP 指令增量傳輸 |
| `tengu_pebble_leaf_prune` | 會話存儲葉剪枝優化 |

**P1 — API 依賴功能（8 個 gate）：**

| Gate | 功能 |
|------|------|
| `tengu_session_memory` | 會話記憶（跨會話上下文持久化） |
| `tengu_passport_quail` | 自動記憶提取 |
| `tengu_chomp_inflection` | 提示建議 |
| `tengu_hive_evidence` | 驗證代理（對抗性驗證） |
| `tengu_kairos_brief` | Brief 精簡輸出模式 |
| `tengu_sedge_lantern` | 離開摘要 |
| `tengu_onyx_plover` | 自動夢境（記憶鞏固） |
| `tengu_willow_mode` | 空閒返回提示 |

**Kill Switch（10 個 gate 保持 true）：**

`tengu_turtle_carbon`、`tengu_amber_stoat`、`tengu_amber_flint`、`tengu_slim_subagent_claudemd`、`tengu_birch_trellis`、`tengu_collage_kaleidoscope`、`tengu_compact_cache_prefix`、`tengu_kairos_cron_durable`、`tengu_attribution_header`、`tengu_slate_prism`

**新增編譯 flag：**

| Flag | build.ts | dev.ts | 用途 |
|------|:--------:|:------:|------|
| `AGENT_TRIGGERS` | ON | ON | 定時任務系統 |
| `EXTRACT_MEMORIES` | ON | ON | 自動記憶提取 |
| `VERIFICATION_AGENT` | ON | ON | 對抗性驗證代理 |
| `KAIROS_BRIEF` | ON | ON | Brief 精簡模式 |
| `AWAY_SUMMARY` | ON | ON | 離開摘要 |
| `ULTRATHINK` | ON | ON | Ultrathink 擴展思考（雙重門控修復） |
| `BUILTIN_EXPLORE_PLAN_AGENTS` | ON | ON | 內置 Explore/Plan agents（雙重門控修復） |
| `LODESTONE` | ON | ON | Deep link 協議註冊（雙重門控修復） |

**排除的編譯 flag：**
- `KAIROS` — 拉入 `useProactive.js`（缺失文件），`KAIROS_BRIEF` 足夠
- `TERMINAL_PANEL` — 拉入 `TerminalCaptureTool`（缺失文件）

**雙重門控修復說明：**
部分功能同時被編譯 flag 和 GrowthBook gate 控制（雙重門控），僅開 GrowthBook gate 不夠。
審計發現 3 個被卡住的：`ULTRATHINK`、`BUILTIN_EXPLORE_PLAN_AGENTS`、`LODESTONE`。

### 修改文件

| 文件 | 變更 |
|------|------|
| `build.ts` | `DEFAULT_BUILD_FEATURES` 新增 8 個編譯 flag |
| `scripts/dev.ts` | `DEFAULT_FEATURES` 新增 8 個編譯 flag |
| `src/services/analytics/growthbook.ts` | 新增 `LOCAL_GATE_DEFAULTS` 映射（27 gates）+ `getLocalGateDefault()` + 修改 4 個 getter 的 fallback 鏈 |
| `scripts/verify-gates.ts` | 新增 gate 驗證腳本（30 gates） |
| `docs/features/growthbook-enablement-plan.md` | 完整研究報告和啓用計劃 |
| `docs/features/feature-flags-audit-complete.md` | 更新啓用狀態表 |

### 驗證

| 專案 | 結果 |
|------|------|
| `bun run build` | ✅ 成功 (481 files) |
| `bun test` | ✅ 2106 pass / 23 fail（均爲已有問題）/ 0 新增失敗 |
| `verify-gates.ts` | ✅ 30/30 PASS |
| `/brief` 手動測試 | ✅ 可用（fallback 修復後） |

---

## Enable SHOT_STATS, TOKEN_BUDGET, PROMPT_CACHE_BREAK_DETECTION (2026-04-05)

**PR**: [Icarus603/claude-code#140](https://github.com/Icarus603/claude-code/pull/140)
**分支**: `feat/enable-safe-feature-flags`

對 22 個被標記爲 "COMPLETE" 的編譯時 feature flag 進行實際源碼驗證（6 個並行子代理 + Codex CLI 獨立複覈），發現審計報告存在大量誤判。最終確認僅 3 個 flag 爲真正 compile-only，安全啓用。

**驗證流程：**

1. 6 個並行子代理分別檢查每個 flag 的 `feature('FLAG_NAME')` 引用點、依賴模組完整性、外部服務依賴
2. Codex CLI (v0.118.0, 240K tokens) 獨立複覈，將原 7 個 "compile-only" 進一步縮減爲 3 個
3. 3 個專項代理逐一驗證程式碼路徑完整性和執行時安全性

**新啓用的 3 個 flag：**

| Flag | 功能 | 用戶可感知效果 |
|------|------|---------------|
| `SHOT_STATS` | shot 分佈統計 | `/stats` 面板顯示 shot 分佈和 one-shot rate |
| `TOKEN_BUDGET` | token 預算目標 | 支援 `+500k` / `spend 2M tokens` 語法，自動續寫直到達標，帶進度條 |
| `PROMPT_CACHE_BREAK_DETECTION` | cache key 變化檢測 | 內部診斷，`--debug` 模式可見，寫 diff 到臨時目錄 |

**修改文件：**

| 文件 | 變更 |
|------|------|
| `build.ts` | `DEFAULT_BUILD_FEATURES` 新增 3 個 flag |
| `scripts/dev.ts` | `DEFAULT_FEATURES` 新增 3 個 flag |
| `package.json` / `bun.lock` | 新增 `openai` 依賴（OpenAI 相容層需要） |

**新增文件：**

| 文件 | 說明 |
|------|------|
| `docs/features/feature-flags-codex-review.md` | Codex 獨立複覈報告：修正後的 5 類分類、恢復優先級、三軸分類標準建議 |
| `docs/features/feature-flags-audit-complete.md` | 標記所有已啓用 flag 的狀態（`[build: ON]` / `[dev: ON]`） |

**Codex 複覈關鍵發現：**

- 原 22 個 "COMPLETE" flag 中，8 個核心模組是 stub，3 個依賴遠程服務
- `TEAMMEM`、`AGENT_TRIGGERS`、`EXTRACT_MEMORIES`、`KAIROS_BRIEF` 被降級爲"有條件可用"（受 GrowthBook 門控）
- 建議審計分類標準改爲三軸：實現完整度 × 激活條件 × 執行風險
- 恢復優先級：REACTIVE_COMPACT > BG_SESSIONS > PROACTIVE > CONTEXT_COLLAPSE

**驗證結果：**

- `bun run build` → 475 files ✅
- `bun test` → 零新增失敗 ✅
- 3 個 flag 程式碼路徑全部完整，無缺失依賴，無 crash 風險 ✅

---

## /dream 手動觸發 + DreamTask 類型補全 (2026-04-04)

將 `/dream` 命令從 KAIROS feature gate 中解耦，作爲 bundled skill 無條件註冊；補全 DreamTask 類型存根。

**新增文件：**

| 文件 | 說明 |
|------|------|
| `src/skills/bundled/dream.ts` | `/dream` skill 註冊，呼叫 `buildConsolidationPrompt()` 生成整理提示詞 |

**修改文件：**

| 文件 | 變更 |
|------|------|
| `src/skills/bundled/index.ts` | 導入並註冊 `registerDreamSkill()` |
| `src/components/tasks/src/tasks/DreamTask/DreamTask.ts` | `any` 存根 → 從 `src/tasks/DreamTask/DreamTask.js` 重新導出完整類型 |

**新增文件：**

| 文件 | 說明 |
|------|------|
| `docs/features/auto-dream.md` | Auto Dream 原理、觸發機制、使用場景完整說明 |

---

## Computer Use macOS 適配修復 (2026-04-04)

**分支**: `feature/computer-use/mac-support`

- **darwin.ts** — 應用枚舉改用 Spotlight `mdfind` + `mdls`，取得真實 bundleId（舊方案合成 `com.app.xxx`），覆蓋 `/Applications` + `/System/Applications` + CoreServices
- **index.ts** — 新增 `hotkey` backend fallback，非原生模組不崩潰
- **toolCalls.ts** — `resolveRequestedApps()` 新增子串模糊匹配（`"Chrome"` → `"Google Chrome"`）
- **hostAdapter.ts** — `ensureOsPermissions()` 檢查 `cu.tcc` 存在性，跨平臺 JS backend 安全降級
- **測試**: 17 個 MCP 工具中 10 個完全通過，6 個在 full tier 應用上通過（IDE click tier 受限爲預期行爲），`screenshot` 未返回圖片（疑似屏幕錄製權限問題）

---

## Computer Use Windows 增強：窗口綁定截圖 + UI Automation + OCR (2026-04-03)


在三平臺基礎實現之上，利用 Windows 原生 API 增強 Computer Use 的 Windows 專屬能力。

**新增文件：**

| 文件 | 行數 | 說明 |
|------|------|------|
| `src/utils/computerUse/win32/windowCapture.ts` | — | `PrintWindow` 窗口綁定截圖，支援被遮擋/後臺窗口 |
| `src/utils/computerUse/win32/windowEnum.ts` | — | `EnumWindows` 精確窗口枚舉（HWND + PID + 標題） |
| `src/utils/computerUse/win32/uiAutomation.ts` | — | `IUIAutomation` UI 元素樹讀取、按鈕點擊、文本寫入、座標識別 |
| `src/utils/computerUse/win32/ocr.ts` | — | `Windows.Media.Ocr` 截圖+文字識別（英語+中文） |

**修改文件：**

| 文件 | 變更 |
|------|------|
| `packages/@ant/computer-use-swift/src/backends/win32.ts` | `listRunning` 改用 EnumWindows；新增 `captureWindowTarget` 窗口級截圖 |

**驗證結果（Windows x64）：**
- 窗口枚舉：38 個可見窗口 ✅
- 窗口截圖：VS Code 2575x1415, 444KB ✅（PrintWindow, 即使被遮擋）
- UI Automation：座標元素識別 ✅
- OCR：識別 VS Code 界面文字，34 行 ✅

---

## Enable Computer Use — macOS + Windows + Linux (2026-04-03)

恢復 Computer Use 屏幕操控功能。參考專案僅 macOS，本次擴展爲三平臺支援。

**Phase 1 — MCP server stub 替換：**
從參考專案複製 `@ant/computer-use-mcp` 完整實現（12 文件，6517 行）。

**Phase 2 — 移除 src/ 中 8 處 macOS 硬編碼：**

| 文件 | 改動 |
|------|------|
| `src/main.tsx:1605` | 去掉 `getPlatform() === 'macos'` |
| `src/utils/computerUse/swiftLoader.ts` | 移除 darwin-only throw |
| `src/utils/computerUse/executor.ts` | 平臺守衛擴展爲 darwin+win32+linux；剪貼板按平臺分發（pbcopy→PowerShell→xclip）；paste 快捷鍵 command→ctrl |
| `src/utils/computerUse/drainRunLoop.ts` | 非 darwin 直接執行 fn() |
| `src/utils/computerUse/escHotkey.ts` | 非 darwin 返回 false（Ctrl+C fallback） |
| `src/utils/computerUse/hostAdapter.ts` | 非 darwin 權限檢查返回 granted |
| `src/utils/computerUse/common.ts` | platform + screenshotFiltering 動態化 |
| `src/utils/computerUse/gates.ts` | enabled:true + hasRequiredSubscription→true |

**Phase 3 — input/swift 包 dispatcher + backends 三平臺架構：**

```
packages/@ant/computer-use-{input,swift}/src/
├── index.ts          ← dispatcher
├── types.ts          ← 共享介面
└── backends/
    ├── darwin.ts      ← macOS AppleScript（原樣拆出，不改邏輯）
    ├── win32.ts       ← Windows PowerShell
    └── linux.ts       ← Linux xdotool/scrot/xrandr/wmctrl
```

**編譯開關：** `CHICAGO_MCP` 加入 DEFAULT_FEATURES + DEFAULT_BUILD_FEATURES

**驗證結果（Windows x64）：**
- `isSupported: true` ✅
- 鼠標定位 + 前臺窗口信息 ✅
- 雙顯示器檢測 2560x1440 × 2 ✅
- 全屏截圖 3MB base64 ✅
- `bun run build` 463 files ✅

---

## Enable Voice Mode / VOICE_MODE (2026-04-03)

恢復 `/voice` 語音輸入功能。`src/` 下所有 voice 相關源碼已與官方一致（0 行差異），問題出在：① `VOICE_MODE` 編譯開關未開，命令不顯示；② `audio-capture-napi` 是 SoX 子進程 stub（Windows 不支援），缺少官方原生 `.node` 二進制。

**新增文件：**

| 文件 | 說明 |
|------|------|
| `vendor/audio-capture/{platform}/audio-capture.node` | 6 個平臺的原生音頻二進制（cpal，來自參考專案） |
| `vendor/audio-capture-src/index.ts` | 原生模組加載器（按 `${arch}-${platform}` 動態 require `.node`） |

---

## Enable Claude in Chrome MCP (2026-04-03)

恢復 Chrome 瀏覽器控制功能。`src/` 下所有 claudeInChrome 相關源碼已與官方一致（0 行差異），問題出在 `@ant/claude-for-chrome-mcp` 包是 6 行 stub（返回空工具列表和 null server）。

**替換文件：**

| 文件 | 變更 |
|------|------|
| `packages/@ant/claude-for-chrome-mcp/src/index.ts` | 6 行 stub → 15 行完整導出 |

**新增文件：**

| 文件 | 行數 | 說明 |
|------|------|------|
| `packages/@ant/claude-for-chrome-mcp/src/types.ts` | 134 | 類型定義 |
| `packages/@ant/claude-for-chrome-mcp/src/browserTools.ts` | 546 | 17 個瀏覽器工具定義 |
| `packages/@ant/claude-for-chrome-mcp/src/mcpServer.ts` | 96 | MCP Server |
| `packages/@ant/claude-for-chrome-mcp/src/mcpSocketClient.ts` | 493 | Unix Socket 客戶端 |
| `packages/@ant/claude-for-chrome-mcp/src/mcpSocketPool.ts` | 327 | 多 Profile 連接池 |
| `packages/@ant/claude-for-chrome-mcp/src/bridgeClient.ts` | 1126 | Bridge WebSocket 客戶端 |
| `packages/@ant/claude-for-chrome-mcp/src/toolCalls.ts` | 301 | 工具呼叫路由 |

**不需要 feature flag，不需要改 dev.ts/build.ts，不改 src/ 下任何文件。**

**執行時依賴：** Chrome 瀏覽器 + Claude in Chrome 擴展（https://claude.ai/chrome）

---

## OpenAI 介面相容 (2026-04-03)

**分支**: `feature/openai`

在 `/login` 流程中新增 "OpenAI Compatible" 選項，支援 Ollama、DeepSeek、vLLM、One API 等相容 OpenAI Chat Completions API 的第三方服務。用戶通過 `/login` 設定後，所有 API 請求自動走 OpenAI 路徑。

**改動文件（10 個，+384 / -134）：**

| 文件 | 變更 |
|------|------|
| `.github/workflows/ci.yml` | CI runner 從 `ubuntu-latest` 改爲 `macos-latest` |
| `README.md` | TODO 列表新增 "OpenAI 介面相容" 條目 |
| `src/components/ConsoleOAuthFlow.tsx` | 新增 `openai_chat_api` OAuth state（含 Base URL / API Key / 3 個模型映射字段）；idle 選擇列表新增 "OpenAI Compatible" 選項；完整表單 UI（Tab 切換、Enter 保存）；保存時寫入 `modelType: 'openai'` + env 到 settings.json；OAuth 登錄時重置 `modelType` 爲 `anthropic` |
| `src/services/api/openai/index.ts` | 從直接 `yield* adaptOpenAIStreamToAnthropic()` 改爲完整流處理循環：累積 content blocks（text/tool_use/thinking）、按 `content_block_stop` yield `AssistantMessage`、同時 yield `StreamEvent` 用於實時顯示；錯誤處理改用新簽名 `createAssistantAPIErrorMessage({ content, apiError, error })` |
| `src/services/api/openai/convertMessages.ts` | 輸入類型從 Anthropic SDK `BetaMessageParam[]` 改爲內部 `(UserMessage \| AssistantMessage)[]`；通過 `msg.type` 而非 `msg.role` 判斷角色；從 `msg.message.content` 讀取內容；跳過 `cache_edits` / `server_tool_use` 等內部 block 類型 |
| `src/services/api/openai/modelMapping.ts` | 移除 `OPENAI_MODEL_MAP` JSON 環境變量 + 快取機制；新增 `getModelFamily()` 按 haiku/sonnet/opus 分類；解析優先級改爲：`OPENAI_MODEL` → `ANTHROPIC_DEFAULT_{FAMILY}_MODEL` → `DEFAULT_MODEL_MAP` → 原名透傳 |
| `src/services/api/openai/__tests__/convertMessages.test.ts` | 測試輸入從裸 `{ role, content }` 改爲 `makeUserMsg()` / `makeAssistantMsg()` 包裝的內部格式 |
| `src/services/api/openai/__tests__/modelMapping.test.ts` | 測試從 `OPENAI_MODEL_MAP` 改爲 `ANTHROPIC_DEFAULT_{HAIKU,SONNET,OPUS}_MODEL`；新增 3 個 env var override 測試 |
| `src/utils/model/providers.ts` | `getAPIProvider()` 新增最高優先級：從 settings.json `modelType` 字段判斷；環境變量 `CLAUDE_CODE_USE_OPENAI` 降爲次優先 |
| `src/utils/settings/types.ts` | `SettingsSchema` 新增 `modelType` 字段：`z.enum(['anthropic', 'openai']).optional()` |

**關鍵設計決策：**

1. **`modelType` 存入 settings.json** — 而非純環境變量，使 `/login` 設定持久化，重啓後仍然生效
2. **複用 `ANTHROPIC_DEFAULT_*_MODEL` 環境變量** — 而非新增 `OPENAI_MODEL_MAP`，與 Custom Platform 共用同一套模型映射設定，減少用戶認知負擔
3. **流處理雙 yield** — 同時 yield `AssistantMessage`（給消費方處理工具呼叫）和 `StreamEvent`（給 REPL 實時渲染），與 Anthropic 路徑行爲對齊
4. **OAuth 登錄重置 modelType** — 用戶切換回官方 Anthropic 登錄時自動重置爲 `anthropic`，避免殘留設定導致請求走錯誤路徑

**設定方式：**

```
/login → 選擇 "OpenAI Compatible" → 填寫 Base URL / API Key / 模型名稱
```

或手動編輯 `~/.claude/settings.json`：

```json
{
  "modelType": "openai",
  "env": {
    "OPENAI_BASE_URL": "http://localhost:11434/v1",
    "OPENAI_API_KEY": "ollama",
    "ANTHROPIC_DEFAULT_SONNET_MODEL": "qwen3:32b"
  }
}
```

---

## Enable Remote Control / BRIDGE_MODE (2026-04-03)

**PR**: [Icarus603/claude-code#60](https://github.com/Icarus603/claude-code/pull/60)

Remote Control 功能將本地 CLI 註冊爲 bridge 環境，生成可分享的 URL（`https://claude.ai/code/session_xxx`），允許從瀏覽器、手機或其他設備遠程查看輸出、發送訊息、審批工具呼叫。

**改動文件：**

| 文件 | 變更 |
|------|------|
| `scripts/dev.ts` | `DEFAULT_FEATURES` 加入 `"BRIDGE_MODE"`，dev 模式預設啓用 |
| `src/bridge/peerSessions.ts` | stub → 完整實現：通過 bridge API 發送跨會話訊息，含三層安全防護（trim + validateBridgeId 白名單 + encodeURIComponent） |
| `src/bridge/webhookSanitizer.ts` | stub → 完整實現：正則 redact 8 類 secret（GitHub/Anthropic/AWS/npm/Slack token），先 redact 再截斷，失敗返回安全佔位符 |
| `src/entrypoints/sdk/controlTypes.ts` | 12 個 `any` stub → `z.infer<ReturnType<typeof XxxSchema>>` 從現有 Zod schema 推導類型 |
| `src/hooks/useReplBridge.tsx` | `tengu_bridge_system_init` 預設值 `false` → `true`，使 app 端顯示 "active" 而非卡在 "connecting" |

**關鍵設計決策：**

1. **不改現有程式碼邏輯** — 只補全 stub、修正預設值、開啓編譯開關
2. **`tengu_bridge_system_init`** — Anthropic 通過 GrowthBook 給訂閱用戶推送 `true`，但我們的 build 收不到推送；改預設值是唯一不侵入其他程式碼的方案
3. **`peerSessions.ts` 認證** — 使用 `getBridgeAccessToken()` 取得 OAuth Bearer token，與 `bridgeApi.ts`/`codeSessionApi.ts` 認證模式一致
4. **`webhookSanitizer.ts` 安全** — fail-closed（出錯返回 `[webhook content redacted due to sanitization error]`），不泄露原始內容

**驗證結果：**

- `/remote-control` 命令可見且可用
- CLI 連接 Anthropic CCR，生成可分享 URL
- App 端（claude.ai/code）顯示 "Remote Control active"
- 手機端（Claude iOS app）通過 URL 連接，雙向訊息正常

![Remote Control on Mobile](docs/images/remote-control-mobile.png)

---

## GrowthBook 自定義服務器適配器 (2026-04-03)

GrowthBook 功能開關係統原爲 Anthropic 內部構建設計，硬編碼 SDK key 和 API 地址，外部構建因 `is1PEventLoggingEnabled()` 門控始終禁用。新增適配器模式，通過環境變量連接自定義 GrowthBook 服務器，無設定時所有 feature 讀取返回程式碼預設值。

**修改文件：**

| 文件 | 變更 |
|------|------|
| `src/constants/keys.ts` | `getGrowthBookClientKey()` 優先讀取 `CLAUDE_GB_ADAPTER_KEY` 環境變量 |
| `src/services/analytics/growthbook.ts` | `isGrowthBookEnabled()` 適配器模式下直接返回 `true`，繞過 1P event logging 門控 |
| `src/services/analytics/growthbook.ts` | `getGrowthBookClient()` base URL 優先使用 `CLAUDE_GB_ADAPTER_URL` |
| `docs/internals/growthbook-adapter.mdx` | 新增適配器設定文件，含全部 ~58 個 feature key 列表 |

**用法：** `CLAUDE_GB_ADAPTER_URL=https://gb.example.com/ CLAUDE_GB_ADAPTER_KEY=sdk-xxx bun run dev`

---

## Datadog 日誌端點可設定化 (2026-04-03)

將 Datadog 硬編碼的 Anthropic 內部端點改爲環境變量驅動，預設禁用。

**修改文件：**

| 文件 | 變更 |
|------|------|
| `src/services/analytics/datadog.ts` | `DATADOG_LOGS_ENDPOINT` 和 `DATADOG_CLIENT_TOKEN` 從硬編碼常量改爲讀取 `process.env.DATADOG_LOGS_ENDPOINT` / `process.env.DATADOG_API_KEY`，預設空字符串；`initializeDatadog()` 增加守衛：端點或 Token 未設定時直接返回 `false` |
| `docs/telemetry-remote-config-audit.md` | 更新第 1 節，反映新的環境變量設定方式 |

**效果：** 預設不向任何外部發送資料；設置兩個環境變量即可接入自己的 Datadog 實例。原有 `DISABLE_TELEMETRY`、privacy level、sink killswitch 等防線保留。

**用法：** `DATADOG_LOGS_ENDPOINT=https://http-intake.logs.datadoghq.com/api/v2/logs DATADOG_API_KEY=xxx bun run dev`

---

## Sentry 錯誤上報集成 (2026-04-03)

恢復反編譯過程中被移除的 Sentry 集成。通過 `SENTRY_DSN` 環境變量控制，未設置時所有函數爲 no-op，不影響正常執行。

**新增文件：**

| 文件 | 說明 |
|------|------|
| `src/utils/sentry.ts` | 核心模組：`initSentry()`、`captureException()`、`setTag()`、`setUser()`、`closeSentry()`；`beforeSend` 過濾 auth headers 等敏感信息；忽略 ECONNREFUSED/AbortError 等非 actionable 錯誤 |

**修改文件：**

| 文件 | 變更 |
|------|------|
| `src/utils/errorLogSink.ts` | `logErrorImpl` 末尾呼叫 `captureException()`，所有經 `logError()` 的錯誤自動上報 |
| `src/components/SentryErrorBoundary.ts` | 添加 `componentDidCatch`，React 組件渲染錯誤上報到 Sentry（含 componentStack） |
| `src/entrypoints/init.ts` | 網絡設定後呼叫 `initSentry()` |
| `src/utils/gracefulShutdown.ts` | 優雅關閉時 flush Sentry 事件 |
| `src/screens/REPL.tsx:2809` | `fireCompanionObserver` 呼叫增加 `typeof` 防護，BUDDY feature 啓用時不報錯（TODO: 待實現） |
| `package.json` | devDependencies 新增 `@sentry/node` |

**用法：** `SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx bun run dev`

---

## 預設關閉自動更新 (2026-04-03)

修改 `src/utils/config.ts` — `getAutoUpdaterDisabledReason()`，在原有檢查邏輯前插入預設關閉邏輯。未設置 `ENABLE_AUTOUPDATER=1` 時，自動更新始終返回 `{ type: 'config' }` 被禁用。

**啓用方式：** `ENABLE_AUTOUPDATER=1 bun run dev`

**原因：** 本專案爲逆向工程/反編譯版本，自動更新會覆蓋本地修改的程式碼。

**同時新增文件：** `docs/auto-updater.md` — 自動更新機制完整審計，涵蓋三種安裝類型的更新策略、後臺輪詢、版本門控、原生安裝器架構、檔案鎖、設定項等。

---

## WebSearch Bing 適配器補全 (2026-04-03)

原始 `WebSearchTool` 僅支援 Anthropic API 服務端搜索（`web_search_20250305` server tool），在非官方 API 端點（第三方代理）下搜索功能不可用。本次改動引入適配器架構，新增 Bing 搜索頁面解析作爲 fallback。

**新增文件：**

| 文件 | 說明 |
|------|------|
| `src/tools/WebSearchTool/adapters/types.ts` | 適配器介面定義：`WebSearchAdapter`、`SearchResult`、`SearchOptions`、`SearchProgress` |
| `src/tools/WebSearchTool/adapters/apiAdapter.ts` | API 適配器 — 將原有 `queryModelWithStreaming` 邏輯封裝爲 `ApiSearchAdapter` |
| `src/tools/WebSearchTool/adapters/bingAdapter.ts` | Bing 適配器 — 直接抓取 Bing HTML，正則提取搜索結果 |
| `src/tools/WebSearchTool/adapters/index.ts` | 適配器工廠 — 根據環境變量 / API Base URL 選擇後端 |
| `src/tools/WebSearchTool/__tests__/bingAdapter.test.ts` | Bing 適配器單元測試（32 cases：decodeHtmlEntities、extractBingResults、search mock） |
| `src/tools/WebSearchTool/__tests__/bingAdapter.integration.ts` | Bing 適配器集成測試 — 真實網絡請求驗證 |

**重構文件：**

| 文件 | 變更 |
|------|------|
| `src/tools/WebSearchTool/WebSearchTool.ts` | 從直接呼叫 API 改爲 `createAdapter()` 工廠模式；`isEnabled()` 始終返回 true；刪除 ~200 行內聯 API 呼叫邏輯 |
| `src/tools/WebFetchTool/utils.ts` | `skipWebFetchPreflight` 預設值從 `!undefined`（即 true）改爲顯式 `=== false`，使域名預檢預設啓用 |

**Bing 適配器關鍵技術細節：**

1. **反爬繞過**：使用完整 Edge 瀏覽器請求頭（含 `Sec-Ch-Ua`、`Sec-Fetch-*` 等 13 個標頭），避免 Bing 返回 JS 渲染的空頁面；`setmkt=en-US` 參數強制美式英語市場，避免 IP 地理定位導致的區域化結果（德語論壇、新加坡金價等不相關內容）
2. **URL 解碼**（`resolveBingUrl()`）：Bing 返回的重定向 URL（`bing.com/ck/a?...&u=a1aHR0cHM6Ly9...`）中 `u` 參數爲 base64 編碼的真實 URL，需解碼後使用
3. **摘要提取**（`extractSnippet()`）：三級降級策略 — `b_lineclamp` → `b_caption <p>` → `b_caption` 直接文本
4. **HTML 實體解碼**（`decodeHtmlEntities()`）：處理 7 種常見 HTML 實體
5. **域過濾**：客戶端側 `allowedDomains` / `blockedDomains` 過濾，支援子域名匹配

**當前狀態**：`adapters/index.ts` 中 `createAdapter()` 硬編碼返回 `BingSearchAdapter`，跳過了 API/Bing 自動選擇邏輯（原邏輯被註釋保留）。未來可通過取消註釋恢復自動選擇。

---

## 移除反蒸餾機制 (2026-04-02)

專案中發現三處 anti-distillation 相關程式碼，全部移除。

**移除內容：**
- `src/services/api/claude.ts` — 刪除 fake_tools 注入邏輯（原第 302-314 行），該程式碼通過 `ANTI_DISTILLATION_CC` feature flag 在 API 請求中注入 `anti_distillation: ['fake_tools']`，使服務端在響應中混入虛假工具呼叫以污染蒸餾資料
- `src/utils/betas.ts` — 刪除 connector-text summarization beta 注入塊及 `SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER` 導入，該機制讓服務端緩衝工具呼叫間的 assistant 文本並摘要化返回
- `src/constants/betas.ts` — 刪除 `SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER` 常量定義（原第 23-25 行）
- `src/utils/streamlinedTransform.ts` — 註釋從 "distillation-resistant" 改爲 "compact"，streamlined 模式本身是有效的輸出壓縮功能，僅修正描述

---

## Buddy 命令合入 + Feature Flag 規範修正 (2026-04-02)

合入 `pr/smallflyingpig/36` 分支（支援 buddy 命令 + 修復 rehatch），並修正 feature flag 使用方式。

**合入內容（來自 PR）：**
- `src/commands/buddy/buddy.ts` — 新增 `/buddy` 命令，支援 hatch / rehatch / pet / mute / unmute 子命令
- `src/commands/buddy/index.ts` — 從 stub 改爲正確的 `Command` 類型導出
- `src/buddy/companion.ts` — 新增 `generateSeed()`，`getCompanion()` 支援 seed 驅動的可復現 rolling
- `src/buddy/types.ts` — `CompanionSoul` 增加 `seed?` 字段

**合併後修正：**
- `src/entrypoints/cli.tsx` — PR 硬編碼了 `const feature = (name) => name === "BUDDY"`，違反 feature flag 規範，恢復爲標準 `import { feature } from 'bun:bundle'`
- `src/commands.ts` — PR 用靜態 `import buddy` 繞過了 feature gate，恢復爲 `feature('BUDDY') ? require(...) : null` + 條件展開
- `src/commands/buddy/buddy.ts` — 刪除未使用的 `companionInfoText` 函數和多餘的 `Roll`/`SPECIES` import
- `CLAUDE.md` — 重寫 Feature Flag System 章節，明確規範：程式碼中統一用 `import { feature } from 'bun:bundle'`，啓用走環境變量 `FEATURE_<NAME>=1`

**用法：** `FEATURE_BUDDY=1 bun run dev`

---

## Auto Mode 補全 (2026-04-02)

反編譯丟失了 auto mode 分類器的三個 prompt 模板文件，程式碼邏輯完整但無法執行。

**新增：**
- `yolo-classifier-prompts/auto_mode_system_prompt.txt` — 主系統提示詞
- `yolo-classifier-prompts/permissions_external.txt` — 外部權限模板（用戶規則替換預設值）
- `yolo-classifier-prompts/permissions_anthropic.txt` — 內部權限模板（用戶規則追加）

**改動：**
- `scripts/dev.ts` + `build.ts` — 掃描 `FEATURE_*` 環境變量注入 Bun `--feature`
- `cli.tsx` — 啓動時打印已啓用的 feature
- `permissionSetup.ts` — `AUTO_MODE_ENABLED_DEFAULT` 由 `feature('TRANSCRIPT_CLASSIFIER')` 決定，開 feature 即開 auto mode
- `docs/safety/auto-mode.mdx` — 補充 prompt 模板章節

**用法：** `FEATURE_TRANSCRIPT_CLASSIFIER=1 bun run dev`

**注意：** prompt 模板爲重建產物。

---

## USER_TYPE=ant TUI 修復 (2026-04-02)

`global.d.ts` 聲明的全局函數在反編譯版本執行時未定義，導致 `USER_TYPE=ant` 時 TUI 崩潰。

修復方式：顯式 import / 本地 stub / 全局 stub / 新建 stub 文件。涉及文件：
`cli.tsx`, `model.ts`, `context.ts`, `effort.ts`, `thinking.ts`, `undercover.ts`, `Spinner.tsx`, `AntModelSwitchCallout.tsx`(新建), `UndercoverAutoCallout.tsx`(新建)

注意：
- `USER_TYPE=ant` 啓用 alt-screen 全屏模式，中心區域滿屏是預期行爲
- `global.d.ts` 中剩餘未 stub 的全局函數（`getAntModels` 等）遇到 `X is not defined` 時按同樣模式處理

---

## /login 添加 Custom Platform 選項 (2026-04-03)

在 `/login` 命令的登錄方式選擇列表中新增 "Custom Platform" 選項（位於第一位），允許用戶直接在終端設定第三方 API 相容服務的 Base URL、API Key 和三種模型映射，保存到 `~/.claude/settings.json`。

**修改文件：**

| 文件 | 變更 |
|------|------|
| `src/components/ConsoleOAuthFlow.tsx` | `OAuthStatus` 類型新增 `custom_platform` state（含 `baseUrl`、`apiKey`、`haikuModel`、`sonnetModel`、`opusModel`、`activeField`）；`idle` case Select 選項新增 Custom Platform 並排第一位；新增 `custom_platform` case 渲染 5 字段表單（Tab/Shift+Tab 切換、focus 高亮、Enter 跳轉/保存）；Select onChange 處理 `custom_platform` 初始狀態（從 `process.env` 預填當前值）；`OAuthStatusMessageProps` 類型及呼叫處新增 `onDone` prop |
| `src/components/ConsoleOAuthFlow.tsx` | 新增 `updateSettingsForSource` import |

**UI 交互：**
- 5 個字段同屏：Base URL、API Key、Haiku Model、Sonnet Model、Opus Model
- 當前活動字段的標籤用 `suggestion` 背景色 + `inverseText` 反色高亮
- Tab / Shift+Tab 在字段間切換，各自保留輸入值
- 每個字段按 Enter 跳到下一個，最後一個字段 (Opus) 按 Enter 保存
- 模型字段自動從 `process.env` 讀取當前設定作爲預填值，無值則空
- 保存時呼叫 `updateSettingsForSource('userSettings', { env })` 寫入 settings.json，同時更新 `process.env`

**保存的 settings.json env 字段：**
```json
{
  "ANTHROPIC_BASE_URL": "...",
  "ANTHROPIC_AUTH_TOKEN": "...",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "...",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "...",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "..."
}
```

非空字段才寫入，保存後立即生效（`onDone()` 觸發 `onChangeAPIKey()` 刷新 API 客戶端）。
