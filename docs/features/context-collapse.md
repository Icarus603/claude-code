# CONTEXT_COLLAPSE — 上下文摺疊

> Feature Flag: `FEATURE_CONTEXT_COLLAPSE=1`
> 子 Feature: `FEATURE_HISTORY_SNIP=1`
> 實現狀態：核心邏輯全部 Stub，佈線完整
> 引用數：CONTEXT_COLLAPSE 20 + HISTORY_SNIP 16 = 36

## 一、功能概述

CONTEXT_COLLAPSE 讓模型內省上下文窗口使用情況，並智能壓縮舊訊息。當對話接近上下文限制時，自動將舊訊息摺疊爲壓縮摘要，保留關鍵信息的同時釋放 token 空間。

### 子 Feature

| Feature | 功能 |
|---------|------|
| `CONTEXT_COLLAPSE` | 上下文摺疊引擎（後臺 LLM 呼叫壓縮舊訊息） |
| `HISTORY_SNIP` | SnipTool — 標記訊息進行摺疊/修剪 |

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 狀態 |
|------|------|------|
| 摺疊核心 | `src/services/contextCollapse/index.ts` | **Stub** — 介面完整（`ContextCollapseStats`、`CollapseResult`、`DrainResult`），函數全部空操作 |
| 摺疊操作 | `src/services/contextCollapse/operations.ts` | **Stub** — `projectView` 爲恆等函數 |
| 摺疊持久化 | `src/services/contextCollapse/persist.ts` | **Stub** — `restoreFromEntries` 爲空操作 |
| CtxInspectTool | `src/tools/CtxInspectTool/` | **缺失** — 目錄不存在 |
| SnipTool 提示 | `src/tools/SnipTool/prompt.ts` | **Stub** — 空工具名 |
| SnipTool 實現 | `src/tools/SnipTool/SnipTool.ts` | **缺失** |
| force-snip 命令 | `src/commands/force-snip.js` | **缺失** |
| 摺疊讀取搜索 | `src/utils/collapseReadSearch.ts` | **完整** — Snip 作爲靜默吸收操作 |
| QueryEngine 集成 | `src/QueryEngine.ts` | **佈線** — 導入並使用 snip 投影 |
| Token 警告 UI | `src/components/TokenWarning.tsx` | **佈線** — 摺疊進度標籤 |

### 2.2 核心介面（已定義，待實現）

```ts
// contextCollapse/index.ts
interface ContextCollapseStats {
  // 上下文使用統計
}
interface CollapseResult {
  // 摺疊操作結果
}
interface DrainResult {
  // 緊急釋放結果
}

// 關鍵函數（全部 stub）：
isContextCollapseEnabled()          // → false
applyCollapsesIfNeeded(messages)    // 透傳
recoverFromOverflow(messages)       // 透傳（413 恢復）
initContextCollapse()               // 空操作
```

### 2.3 預期資料流

```
對話持續增長
      │
      ▼
上下文接近限制（由 query.ts 檢測）
      │
      ├── 溢出檢測 (query.ts:440,616,802)
      │
      ▼
applyCollapsesIfNeeded(messages) [需要實現]
      │
      ├── 後臺 LLM 呼叫壓縮舊訊息
      ├── 保留關鍵信息（決策、檔案路徑、錯誤）
      └── 替換舊訊息爲壓縮摘要
      │
      ├── 413 恢復 (query.ts:1093,1179)
      │   └── recoverFromOverflow() 緊急摺疊
      │
      ▼
projectView() 過濾摺疊後的訊息視圖
      │
      ▼
模型繼續工作（在壓縮後的上下文中）
```

### 2.4 HISTORY_SNIP 子功能

SnipTool 提供手動摺疊能力：

- `/force-snip` 命令 — 強制執行摺疊
- SnipTool — 標記特定訊息進行摺疊/修剪
- `collapseReadSearch.ts` 已完整實現，將 Snip 作爲靜默吸收操作處理

### 2.5 集成點

| 文件 | 位置 | 說明 |
|------|------|------|
| `src/query.ts` | 18,440,616,802,1093,1179 | 溢出檢測、413 恢復、摺疊應用 |
| `src/QueryEngine.ts` | 124,127,1301 | Snip 投影使用 |
| `src/utils/analyzeContext.ts` | 1122 | 跳過保留緩衝區顯示 |
| `src/utils/sessionRestore.ts` | 127,494 | 恢復摺疊狀態 |
| `src/services/compact/autoCompact.ts` | 179,215 | 自動壓縮時考慮摺疊 |

## 三、需要補全的內容

| 優先級 | 模組 | 工作量 | 說明 |
|--------|------|--------|------|
| 1 | `services/contextCollapse/index.ts` | 大 | 摺疊狀態機、LLM 呼叫、訊息壓縮 |
| 2 | `services/contextCollapse/operations.ts` | 中 | `projectView()` 訊息過濾 |
| 3 | `services/contextCollapse/persist.ts` | 小 | `restoreFromEntries()` 磁盤持久化 |
| 4 | `tools/CtxInspectTool/` | 中 | 上下文內省工具（token 計數、已摺疊範圍） |
| 5 | `tools/SnipTool/SnipTool.ts` | 中 | Snip 工具實現 |
| 6 | `commands/force-snip.js` | 小 | `/force-snip` 命令 |

## 四、關鍵設計決策

1. **後臺 LLM 壓縮**：摺疊不是簡單截斷，而是用 LLM 生成壓縮摘要保留關鍵信息
2. **413 恢復**：當 API 返回 413（請求過大）時，緊急摺疊是最重要的恢復手段
3. **與 autoCompact 協作**：摺疊和自動壓縮（compact）是不同的機制，摺疊在訊息級別，壓縮在對話級別
4. **持久化**：摺疊狀態持久化到磁盤，會話恢復時重載

## 五、使用方式

```bash
# 啓用 context collapse
FEATURE_CONTEXT_COLLAPSE=1 bun run dev

# 啓用 snip 子功能
FEATURE_CONTEXT_COLLAPSE=1 FEATURE_HISTORY_SNIP=1 bun run dev
```

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/services/contextCollapse/index.ts` | 摺疊核心（stub，介面已定義） |
| `src/services/contextCollapse/operations.ts` | 投影操作（stub） |
| `src/services/contextCollapse/persist.ts` | 持久化（stub） |
| `src/utils/collapseReadSearch.ts` | Snip 吸收操作（完整） |
| `src/query.ts` | 溢出檢測和 413 恢復集成 |
| `src/QueryEngine.ts` | Snip 投影使用 |
| `src/components/TokenWarning.tsx` | 摺疊進度 UI |
