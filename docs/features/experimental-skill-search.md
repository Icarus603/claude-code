# EXPERIMENTAL_SKILL_SEARCH — 技能語義搜索

> Feature Flag: `FEATURE_EXPERIMENTAL_SKILL_SEARCH=1`
> 實現狀態：全部 Stub（8 個文件），佈線完整
> 引用數：21

## 一、功能概述

EXPERIMENTAL_SKILL_SEARCH 提供 DiscoverSkills 工具，根據當前任務語義搜索可用技能。目標是讓模型在執行任務時自動發現和推薦相關的技能（包括本地和遠程），無需用戶手動查找。

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 狀態 | 說明 |
|------|------|------|------|
| DiscoverSkillsTool | `src/tools/DiscoverSkillsTool/prompt.ts` | **Stub** | 空工具名 |
| 預取 | `src/services/skillSearch/prefetch.ts` | **Stub** | 3 個函數全部空操作 |
| 遠程加載 | `src/services/skillSearch/remoteSkillLoader.ts` | **Stub** | 返回空結果 |
| 遠程狀態 | `src/services/skillSearch/remoteSkillState.ts` | **Stub** | 返回 null/undefined |
| 信號 | `src/services/skillSearch/signals.ts` | **Stub** | `DiscoverySignal = any` |
| 遙測 | `src/services/skillSearch/telemetry.ts` | **Stub** | 空操作日誌 |
| 本地搜索 | `src/services/skillSearch/localSearch.ts` | **Stub** | 空操作快取 |
| 功能檢查 | `src/services/skillSearch/featureCheck.ts` | **Stub** | `isSkillSearchEnabled => false` |
| SkillTool 集成 | `src/tools/SkillTool/SkillTool.ts` | **佈線** | 動態加載所有遠程技能模組 |
| 提示集成 | `src/constants/prompts.ts` | **佈線** | DiscoverSkills schema 注入 |

### 2.2 預期資料流

```
模型處理用戶任務
      │
      ▼
DiscoverSkills 工具觸發 [需要實現]
      │
      ├── 本地搜索：索引已安裝技能元資料
      │   └── localSearch.ts → 技能名稱/描述/關鍵字匹配
      │
      └── 遠程搜索：查詢技能市場/註冊表
          └── remoteSkillLoader.ts → fetch + 解析
      │
      ▼
結果排序和過濾
      │
      ▼
返回推薦技能列表
      │
      ▼
模型使用 SkillTool 呼叫推薦技能
```

### 2.3 預取機制

`prefetch.ts` 預期在用戶提交輸入前分析訊息內容，提前搜索相關技能：

- `startSkillDiscoveryPrefetch()` — 開始預取
- `collectSkillDiscoveryPrefetch()` — 收集預取結果
- `getTurnZeroSkillDiscovery()` — 取得 turn 0 的技能發現結果

## 三、需要補全的內容

| 優先級 | 模組 | 工作量 | 說明 |
|--------|------|--------|------|
| 1 | `DiscoverSkillsTool` | 大 | 語義搜索工具 schema + 執行 |
| 2 | `skillSearch/prefetch.ts` | 中 | 用戶輸入分析和預取邏輯 |
| 3 | `skillSearch/remoteSkillLoader.ts` | 大 | 遠程市場/註冊表取得 |
| 4 | `skillSearch/remoteSkillState.ts` | 小 | 已發現技能狀態管理 |
| 5 | `skillSearch/localSearch.ts` | 中 | 本地索引構建/查詢 |
| 6 | `skillSearch/featureCheck.ts` | 小 | GrowthBook/設定門控 |
| 7 | `skillSearch/signals.ts` | 小 | `DiscoverySignal` 類型定義 |

## 四、關鍵設計決策

1. **預取優化**：在用戶提交前就開始搜索，減少首次響應延遲
2. **本地+遠程雙搜索**：本地索引快速匹配 + 遠程市場深度搜索
3. **SkillTool 集成**：發現的技能通過 SkillTool 呼叫，不需要新的呼叫機制
4. **獨立於 MCP_SKILLS**：MCP_SKILLS 從 MCP 服務器發現，EXPERIMENTAL_SKILL_SEARCH 從技能市場發現

## 五、使用方式

```bash
# 啓用 feature（需要補全後才能真正使用）
FEATURE_EXPERIMENTAL_SKILL_SEARCH=1 bun run dev
```

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/tools/DiscoverSkillsTool/prompt.ts` | 工具 schema（stub） |
| `src/services/skillSearch/prefetch.ts` | 預取邏輯（stub） |
| `src/services/skillSearch/remoteSkillLoader.ts` | 遠程加載（stub） |
| `src/services/skillSearch/remoteSkillState.ts` | 遠程狀態（stub） |
| `src/services/skillSearch/signals.ts` | 信號類型（stub） |
| `src/services/skillSearch/telemetry.ts` | 遙測（stub） |
| `src/services/skillSearch/localSearch.ts` | 本地搜索（stub） |
| `src/services/skillSearch/featureCheck.ts` | 功能檢查（stub） |
| `src/tools/SkillTool/SkillTool.ts` | SkillTool 集成點 |
| `src/constants/prompts.ts:95,335,778` | 提示增強 |
