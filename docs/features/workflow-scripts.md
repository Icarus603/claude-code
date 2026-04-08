# WORKFLOW_SCRIPTS — 工作流自動化

> Feature Flag: `FEATURE_WORKFLOW_SCRIPTS=1`
> 實現狀態：全部 Stub（7 個文件），佈線完整
> 引用數：10

## 一、功能概述

WORKFLOW_SCRIPTS 實現基於文件的多步自動化工作流。用戶可以定義 YAML/JSON 格式的工作流描述文件，系統將其解析爲可執行的多 agent 步驟序列。提供 `/workflows` 命令管理和觸發工作流。

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 狀態 |
|------|------|------|
| WorkflowTool | `src/tools/WorkflowTool/WorkflowTool.ts` | **Stub** — 空對象 |
| Workflow 權限 | `src/tools/WorkflowTool/WorkflowPermissionRequest.ts` | **Stub** — 返回 null |
| 常量 | `src/tools/WorkflowTool/constants.ts` | **Stub** — 空工具名 |
| 命令建立 | `src/tools/WorkflowTool/createWorkflowCommand.ts` | **Stub** — 空操作 |
| 捆綁工作流 | `src/tools/WorkflowTool/bundled/` | **缺失** — 目錄不存在 |
| 本地工作流任務 | `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts` | **Stub** — 類型 + 空操作 |
| UI 任務組件 | `src/components/tasks/src/tasks/LocalWorkflowTask/` | **Stub** — 空導出 |
| 詳情對話框 | `src/components/tasks/WorkflowDetailDialog.ts` | **Stub** — 返回 null |
| 任務註冊 | `src/tasks.ts` | **佈線** — 動態加載 |
| 工具註冊 | `src/tools.ts` | **佈線** — 包含 bundled 工作流初始化 |
| 命令註冊 | `src/commands.ts` | **佈線** — `/workflows` 命令 |

### 2.2 預期資料流

```
用戶定義工作流（YAML/JSON 文件）
         │
         ▼
/workflows 命令發現工作流文件
         │
         ▼
createWorkflowCommand() 解析爲 Command 對象 [需要實現]
         │
         ▼
WorkflowTool 執行工作流 [需要實現]
         │
         ├── 步驟 1: Agent({ task: "..." })
         ├── 步驟 2: Agent({ task: "..." })
         └── 步驟 N: Agent({ task: "..." })
         │
         ▼
LocalWorkflowTask 協調步驟執行 [需要實現]
         │
         ▼
WorkflowDetailDialog 顯示進度 [需要實現]
```

### 2.3 預期工作流 DSL

```
# workflow.yaml（預期格式，需要設計）
name: "程式碼審查工作流"
steps:
  - name: "靜態分析"
    agent: { type: "general-purpose", prompt: "執行 lint 和類型檢查" }
  - name: "測試"
    agent: { type: "general-purpose", prompt: "執行測試套件" }
  - name: "綜合報告"
    agent: { type: "general-purpose", prompt: "綜合分析結果寫報告" }
```

## 三、需要補全的內容

| 優先級 | 模組 | 工作量 | 說明 |
|--------|------|--------|------|
| 1 | `WorkflowTool.ts` | 大 | Schema 定義 + 多步執行引擎 |
| 2 | `bundled/index.js` | 中 | 內置工作流定義（initBundledWorkflows） |
| 3 | `createWorkflowCommand.ts` | 中 | 從文件解析建立命令對象 |
| 4 | `LocalWorkflowTask.ts` | 大 | 步驟協調、kill/skip/retry |
| 5 | `WorkflowDetailDialog.ts` | 中 | 進度詳情 UI |
| 6 | `WorkflowPermissionRequest.ts` | 小 | 權限對話框 |
| 7 | `constants.ts` | 小 | 工具名常量 |

## 四、關鍵設計決策

1. **基於文件的 DSL**：工作流定義爲文件（YAML/JSON），版本控制友好
2. **多 Agent 步驟**：每個步驟是獨立的 agent 任務，支援並行/串行
3. **內置工作流**：`bundled/` 目錄提供開箱即用的常用工作流
4. **/workflows 命令**：統一的發現和觸發入口

## 五、使用方式

```bash
# 啓用 feature（需要補全後才能真正使用）
FEATURE_WORKFLOW_SCRIPTS=1 bun run dev
```

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/tools/WorkflowTool/WorkflowTool.ts` | 工具定義（stub） |
| `src/tools/WorkflowTool/WorkflowPermissionRequest.ts` | 權限對話框（stub） |
| `src/tools/WorkflowTool/constants.ts` | 常量（stub） |
| `src/tools/WorkflowTool/createWorkflowCommand.ts` | 命令建立（stub） |
| `src/tasks/LocalWorkflowTask/LocalWorkflowTask.ts` | 任務協調（stub） |
| `src/components/tasks/WorkflowDetailDialog.ts` | 詳情對話框（stub） |
| `src/tools.ts:127-132` | 工具註冊 |
| `src/commands.ts:86-89` | 命令註冊 |
