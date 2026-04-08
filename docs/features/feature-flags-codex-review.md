# Feature Flags 審查報告 — Codex 複覈

> 審查日期: 2026-04-05
> 審查工具: Codex CLI v0.118.0 (本地, full-auto mode)
> 消耗 tokens: 240,306
> 審查範圍: docs/feature-flags-audit-complete.md 中標記爲 COMPLETE 的 22 個編譯時 feature flag

---

## 審查背景

原始審計報告 (`docs/feature-flags-audit-complete.md`) 聲稱 22 個 feature flag 被標記爲 "COMPLETE"，只需在 `build.ts` / `scripts/dev.ts` 中啓用即可工作。

Claude Code 團隊通過 6 個並行子代理實際讀取源碼後初步發現大量誤判，隨後將分析結果傳遞給 Codex CLI 進行獨立二次驗證。

---

## Codex 發現摘要

### High 級發現

1. **`CONTEXT_COLLAPSE` 不是 COMPLETE**
   - `src/services/contextCollapse/index.ts:43` — `isContextCollapseEnabled()` 硬編碼爲 `false`
   - `src/services/contextCollapse/index.ts:47` — `applyCollapsesIfNeeded()` 只是原樣返回訊息
   - `src/services/contextCollapse/index.ts:59` — `recoverFromOverflow()` 也是 no-op
   - `src/services/contextCollapse/operations.ts:3` 和 `persist.ts:3` 同樣是 stub
   - 審計報告把 UI/命令文件算進去了，但真正被查詢循環消費的是 stub 後端

2. **原分類"真正只需編譯開關"的 7 個 flag，只有 3 個準確**
   - ✅ `SHOT_STATS` — 零額外門控，compile-only
   - ✅ `PROMPT_CACHE_BREAK_DETECTION` — 有 try-catch 兜底，compile-only
   - ✅ `TOKEN_BUDGET` — 純本地計算，compile-only
   - ❌ `TEAMMEM` — 還要求 AutoMem + GrowthBook `tengu_herring_clock` + GitHub repo (`teamMemPaths.ts:73`, `watcher.ts:256`, `watcher.ts:259`)
   - ❌ `AGENT_TRIGGERS` — 受 `isKairosCronEnabled()` GrowthBook 控制 (`useScheduledTasks.ts:61`, `useScheduledTasks.ts:119`)
   - ❌ `EXTRACT_MEMORIES` — 受 `tengu_passport_quail` + AutoMem + 非 remote 限制 (`extractMemories.ts:536`, `:545`, `:550`)
   - ❌ `KAIROS_BRIEF` — 受 `tengu_kairos_brief` + opt-in/kairosActive 限制 (`BriefTool.ts:95`, `:126`, `:132`)

### Medium 級發現

3. **`BG_SESSIONS` 和 `BASH_CLASSIFIER` 不適合簡單歸爲"全 stub"**
   - `BG_SESSIONS` — 會話註冊/清理是真實現 (`concurrentSessions.ts:44`, `:55`)，但任務摘要核心是 stub (`taskSummary.ts:2`)
   - `BASH_CLASSIFIER` — 權限編排很大一塊是真實現 (`bashPermissions.ts` 2621行)，但分類後端 `bashClassifier.ts:24` 永遠返回 disabled

4. **審計口徑問題**
   - 把"程式碼量/周邊 UI 很多"誤當成"可獨立啓用"
   - `PROACTIVE` — `index.ts:3` 只有 state stub，`commands.ts:64` 和 `REPL.tsx:415` 引用缺失文件
   - `REACTIVE_COMPACT` — `reactiveCompact.ts:13` 整塊是 stub
   - `CACHED_MICROCOMPACT` — `cachedMicrocompact.ts:22` 全部 stub

---

## Codex 修正後的分類

### 第一類：真正 compile-only（3 個）

| Flag | 說明 | Crash 風險 |
|------|------|-----------|
| **SHOT_STATS** | 純本地 shot 分佈統計，ant-only 資料路徑 | 低 |
| **PROMPT_CACHE_BREAK_DETECTION** | 本地 cache key 變化檢測，寫 diff 有兜底 | 低 |
| **TOKEN_BUDGET** | 本地 token 預算追蹤，純計算邏輯 | 低 |

### 第二類：compile + 執行時條件（7 個）

| Flag | 條件 | Crash 風險 |
|------|------|-----------|
| **TEAMMEM** | AutoMem + GrowthBook `tengu_herring_clock` + GitHub repo | 低 (clean no-op) |
| **AGENT_TRIGGERS** | GrowthBook `isKairosCronEnabled()` | 低 (clean no-op) |
| **EXTRACT_MEMORIES** | `tengu_passport_quail` + AutoMem + 非 remote | 低 (clean no-op) |
| **KAIROS_BRIEF** | `tengu_kairos_brief` + opt-in/kairosActive，可用 `CLAUDE_CODE_BRIEF=1` 繞過 | 低 |
| **COORDINATOR_MODE** | 需 `CLAUDE_CODE_COORDINATOR_MODE=1`，`workerAgent.ts` 是 stub 但不阻塞 | 低 |
| **COMMIT_ATTRIBUTION** | 僅對 `isInternal=true` 的 repo 生效 | 低 |
| **VERIFICATION_AGENT** | 受 GrowthBook `tengu_hive_evidence` 雙重門控 | 低 |

### 第三類：混合型 — 部分實現 + stub 核心（5 個）

| Flag | 真實現部分 | Stub 核心 |
|------|-----------|----------|
| **BG_SESSIONS** | 會話註冊/清理 (`concurrentSessions.ts`) | `bg.ts`/`taskSummary.ts`/`udsClient.ts` 全 stub + 依賴 tmux |
| **BASH_CLASSIFIER** | 權限編排 (`bashPermissions.ts` 2621行) | `bashClassifier.ts` 分類後端 stub + 需 API beta |
| **PROACTIVE** | REPL/命令註冊框架 | `index.ts` stub + 3 文件缺失 |
| **REACTIVE_COMPACT** | 呼叫點已在主查詢環路 | `reactiveCompact.ts` 22行全 no-op |
| **CACHED_MICROCOMPACT** | 呼叫點已佈線 | `cachedMicrocompact.ts` 全 stub + 需未公開 API |

### 第四類：純 stub（1 個）

| Flag | 問題 |
|------|------|
| **CONTEXT_COLLAPSE** | 3 核心文件全 stub + CtxInspectTool 目錄不存在 |

### 第五類：依賴遠程服務（3 個）

| Flag | 依賴 |
|------|------|
| **ULTRAPLAN** | CCR 遠程 agent 基礎設施 + OAuth |
| **CCR_REMOTE_SETUP** | claude.ai OAuth + GitHub CLI + CCR 後端 |
| **BRIDGE_MODE** (build端) | claude.ai 訂閱 + GrowthBook + WebSocket 後端 |

---

## 第三類恢復優先級建議

Codex 推薦的恢復順序：

1. **REACTIVE_COMPACT** — 收益最直接，呼叫點在主查詢環路，改完最容易立刻見效
2. **BG_SESSIONS** — 已有會話註冊基礎，補齊摘要和後臺執行鏈路的 ROI 高
3. **PROACTIVE** — 產品面大，但缺文件比 stub 更嚴重，範圍比前兩項大
4. **CONTEXT_COLLAPSE** — collapse engine 全 stub，恢復成本和設計不確定性都高
5. **BASH_CLASSIFIER** — 若無 API beta 能力不值得優先；若有則升到第 2
6. **CACHED_MICROCOMPACT** — 受未公開 API 約束，最後做

---

## 審計報告分類標準修正建議

Codex 建議將原來的單軸分類（COMPLETE/PARTIAL/STUB）改爲**三軸**：

| 軸 | 取值 | 說明 |
|----|------|------|
| **實現完整度** | `full` / `mixed` / `stub` | 活躍呼叫鏈上的核心模組是否有真實現 |
| **激活條件** | `compile-only` / `compile+env` / `compile+GrowthBook` / `compile+remote` / `compile+private API` | 啓用需要什麼 |
| **執行風險** | `safe no-op` / `background IO` / `startup critical` | 啓用後條件不滿足時的行爲 |

**COMPLETE 的最低標準應滿足：**
1. 活躍呼叫鏈上的核心模組不能是 stub
2. "可啓用"不能只看編譯 flag，還要單列執行時 gate

按此標準，`CONTEXT_COLLAPSE`、`BG_SESSIONS`、`BASH_CLASSIFIER`、`PROACTIVE`、`REACTIVE_COMPACT`、`CACHED_MICROCOMPACT` 都應從 COMPLETE 降級。

---

## 已採取的行動

基於審查結果，已將以下 3 個確認安全的 flag 加入預設構建：

**build.ts:**
```typescript
const DEFAULT_BUILD_FEATURES = [
  "AGENT_TRIGGERS_REMOTE", "CHICAGO_MCP", "VOICE_MODE",
  "SHOT_STATS", "PROMPT_CACHE_BREAK_DETECTION", "TOKEN_BUDGET"
];
```

**scripts/dev.ts:**
```typescript
const DEFAULT_FEATURES = [
  "BUDDY", "TRANSCRIPT_CLASSIFIER", "BRIDGE_MODE",
  "AGENT_TRIGGERS_REMOTE", "CHICAGO_MCP", "VOICE_MODE",
  "SHOT_STATS", "PROMPT_CACHE_BREAK_DETECTION", "TOKEN_BUDGET"
];
```

### 驗證結果

| 專案 | 結果 |
|------|------|
| `bun run build` | ✅ 成功 (475 files) |
| `bun test` | ✅ 無新增失敗 (23 fail 爲已有問題) |
| SHOT_STATS 程式碼路徑 | ✅ 完整 — stats 面板顯示 shot 分佈 |
| TOKEN_BUDGET 程式碼路徑 | ✅ 完整 — 支援 `+500k` 語法，帶進度條 |
| PROMPT_CACHE_BREAK_DETECTION 程式碼路徑 | ✅ 完整 — 內部診斷，debug 模式可見 |
