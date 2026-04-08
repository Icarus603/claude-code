# BASH_CLASSIFIER — Bash 命令分類器

> Feature Flag: `FEATURE_BASH_CLASSIFIER=1`
> 實現狀態：bashClassifier.ts 全部 Stub，yoloClassifier.ts 完整實現可參考
> 引用數：45

## 一、功能概述

BASH_CLASSIFIER 使用 LLM 對 bash 命令進行意圖分類（允許/拒絕/詢問），實現自動權限決策。用戶不需要逐個審批 bash 命令，分類器根據命令內容和上下文自動判斷安全性。

### 核心特性

- **LLM 驅動分類**：使用 Opus 模型評估命令安全性
- **兩階段分類**：快速阻止/允許 → 深度思考鏈
- **自動審批**：分類器判定安全的命令自動通過
- **UI 集成**：權限對話框顯示分類器狀態和審覈選項

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 狀態 | 說明 |
|------|------|------|------|
| Bash 分類器 | `src/utils/permissions/bashClassifier.ts` | **Stub** | 所有函數返回空操作。註釋："ANT-ONLY" |
| YOLO 分類器 | `src/utils/permissions/yoloClassifier.ts` | **完整** | 1496 行，兩階段 XML 分類器 |
| 審批信號 | `src/utils/classifierApprovals.ts` | **完整** | Map + 信號管理分類器決策 |
| 權限 UI | `src/components/permissions/BashPermissionRequest.tsx` | **佈線** | 分類器狀態顯示、審覈選項 |
| 權限管道 | `src/hooks/toolPermission/handlers/*.ts` | **佈線** | 分類器結果路由到決策 |
| API beta 標頭 | `src/services/api/withRetry.ts` | **佈線** | 啓用時發送 `bash_classifier` beta |

### 2.2 參考實現：yoloClassifier.ts

文件：`src/utils/permissions/yoloClassifier.ts`（1496 行）

這是已實現的完整分類器，可作爲 bashClassifier.ts 的參考：

```
兩階段分類：
1. 快速階段：構建對話記錄 → 呼叫 sideQuery（Opus）→ 快速阻止/允許
2. 深度階段：思考鏈分析 → 最終決策
```

特性：
- 構建完整對話記錄上下文
- 呼叫安全系統提示的 sideQuery
- GrowthBook 設定和指標
- 錯誤處理和降級

### 2.3 分類器在權限管道中的位置

```
bash 命令到達
      │
      ▼
bashPermissions.ts 權限檢查
      │
      ├── 傳統規則匹配（字符串級別）
      │
      └── [BASH_CLASSIFIER] LLM 分類
            │
            ├── allow → 自動通過
            ├── deny → 自動拒絕
            └── ask → 顯示權限對話框
                  │
                  ├── 分類器自動審批標記
                  └── 審覈選項（用戶可覆蓋）
```

## 三、需要補全的內容

| 函數 | 需要實現 | 說明 |
|------|---------|------|
| `classifyBashCommand()` | LLM 呼叫評估安全性 | 參考 yoloClassifier.ts 的兩階段模式 |
| `isClassifierPermissionsEnabled()` | GrowthBook/設定檢查 | 控制分類器是否激活 |
| `getBashPromptDenyDescriptions()` | 返回基於提示的拒絕規則 | 權限設置描述 |
| `getBashPromptAskDescriptions()` | 返回詢問規則 | 需要用戶確認的命令 |
| `getBashPromptAllowDescriptions()` | 返回允許規則 | 自動通過的命令 |
| `generateGenericDescription()` | LLM 生成命令描述 | 爲權限對話框提供說明 |
| `extractPromptDescription()` | 解析規則內容 | 從規則中提取描述 |

## 四、關鍵設計決策

1. **ANT-ONLY 標記**：bashClassifier.ts 標註爲 "ANT-ONLY"，可能是 Anthropic 內部服務端分類器的客戶端適配
2. **兩階段分類**：快速階段處理明確情況（減少延遲），深度階段處理模糊情況
3. **分類器結果可審覈**：權限 UI 顯示分類器決策，用戶可覆蓋
4. **YOLO 分類器參考**：yoloClassifier.ts 提供完整的分類器實現模式，可直接參考

## 五、使用方式

```bash
# 啓用 feature
FEATURE_BASH_CLASSIFIER=1 bun run dev

# 配合 TREE_SITTER_BASH 使用（AST + LLM 雙重安全）
FEATURE_BASH_CLASSIFIER=1 FEATURE_TREE_SITTER_BASH=1 bun run dev
```

## 六、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/utils/permissions/bashClassifier.ts` | — | Bash 分類器（stub，ANT-ONLY） |
| `src/utils/permissions/yoloClassifier.ts` | 1496 | YOLO 分類器（完整參考實現） |
| `src/utils/classifierApprovals.ts` | — | 分類器審批信號管理 |
| `src/components/permissions/BashPermissionRequest.tsx:261-469` | — | 分類器 UI |
| `src/hooks/toolPermission/handlers/interactiveHandler.ts` | — | 交互式權限處理 |
| `src/services/api/withRetry.ts:81` | — | API beta 標頭 |
