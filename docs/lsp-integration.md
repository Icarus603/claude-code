# LSP Integration

Claude Code 內置了 Language Server Protocol (LSP) 集成，提供程式碼智能功能（跳轉定義、查找引用、懸停信息、文件符號等）和被動的診斷反饋。

## 快速開始

### 1. 安裝 LSP 擴充功能

在 Claude Code REPL 中使用 `/plugin` 命令搜索並安裝 LSP 擴充功能：

```
/plugin
```

搜索 `lsp`，找到對應語言的插件（如 `typescript-lsp`），選擇安裝。

安裝後執行 `/reload-plugins` 使插件生效。

LSP 擴充功能安裝後，後臺的 LSP Server Manager 會自動加載並啓動對應的語言服務器，無需手動設定。

### 2. 啓用 LSP Tool

LSP Tool 需要通過環境變量顯式啓用，Claude 才能主動發起程式碼智能查詢：

```bash
ENABLE_LSP_TOOL=1 bun run dev
```

不啓用時，LSP 服務器仍然在後臺執行並推送被動的診斷反饋（類型錯誤等）。

## 自動推薦

除了手動 `/plugin` 搜索安裝外，Claude Code 會在編輯文件時自動檢測：

1. 監聽 `fileHistory.trackedFiles`，發現有新文件被編輯
2. 掃描已安裝的 marketplace，找到聲明支援該文件擴展名的 LSP 擴充功能
3. 檢查系統上是否已安裝對應的 LSP 二進制（如 `typescript-language-server`）
4. 滿足條件時彈出推薦對話框，可選擇安裝

```
┌───── LSP Plugin Recommendation ─────────────┐
│                                               │
│  LSP provides code intelligence like          │
│  go-to-definition and error checking          │
│                                               │
│  Plugin: typescript-lsp                       │
│  Triggered by: .ts files                     │
│                                               │
│  Would you like to install this LSP plugin?   │
│                                               │
│  > Yes, install typescript-lsp               │
│    No, not now                                │
│    Never for typescript-lsp                   │
│    Disable all LSP recommendations            │
└───────────────────────────────────────────────┘
```

- 30 秒不操作自動關閉（算作 "No"）
- 選 "Never" 不再推薦該擴充功能
- 選 "Disable" 關閉所有 LSP 推薦
- 連續忽略 5 次後自動禁用推薦

## 架構概覽

```
┌─────────────────────────────────────────────────────┐
│                    LSP Tool                         │
│  src/tools/LSPTool/LSPTool.ts                       │
│  (Claude 可呼叫的工具，9 種操作)                       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│              LSP Server Manager (Singleton)          │
│  src/services/lsp/manager.ts                        │
│  - initializeLspServerManager()                     │
│  - reinitializeLspServerManager()                   │
│  - shutdownLspServerManager()                       │
└──────────────────────┬──────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────┐
│           LSP Server Manager (實例)                   │
│  src/services/lsp/LSPServerManager.ts               │
│  - 管理多個 LSPServerInstance                        │
│  - 按文件擴展名路由請求                               │
│  - 文件同步 (didOpen/didChange/didSave/didClose)     │
└──────────────────────┬──────────────────────────────┘
                       │
         ┌─────────────┼─────────────┐
         ▼             ▼             ▼
┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│ LSPServer    │ │ LSPServer    │ │ LSPServer    │
│ Instance     │ │ Instance     │ │ Instance     │
│ (typescript) │ │ (python)     │ │ (rust...)    │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
┌──────▼───────┐ ┌──────▼───────┐ ┌──────▼───────┐
│ LSPClient    │ │ LSPClient    │ │ LSPClient    │
│ (JSON-RPC)   │ │ (JSON-RPC)   │ │ (JSON-RPC)   │
└──────┬───────┘ └──────┬───────┘ └──────┬───────┘
       │                │                │
  子進程 (stdio)    子進程 (stdio)    子進程 (stdio)
```

### 被動診斷反饋

```
LSP Server ──publishDiagnostics──▶ passiveFeedback.ts
                                          │
                                          ▼
                                   LSPDiagnosticRegistry
                                   (去重、容量限制)
                                          │
                                          ▼
                                   Attachment System
                                   (異步注入到對話)
```

LSP 服務器會異步推送 `textDocument/publishDiagnostics` 通知，經去重和容量限制後作爲 attachment 注入到 Claude 的對話上下文中。

## 核心模組

| 文件 | 職責 |
|------|------|
| `src/services/lsp/manager.ts` | 全局單例，初始化/重初始化/關閉生命週期管理 |
| `src/services/lsp/LSPServerManager.ts` | 多服務器管理，按文件擴展名路由，文件同步 |
| `src/services/lsp/LSPServerInstance.ts` | 單個 LSP 服務器實例生命週期（啓動/停止/重啓/健康檢查） |
| `src/services/lsp/LSPClient.ts` | JSON-RPC 通信層（基於 `vscode-jsonrpc`），子進程管理 |
| `src/services/lsp/config.ts` | 從擴充功能加載 LSP 服務器設定 |
| `src/services/lsp/LSPDiagnosticRegistry.ts` | 診斷信息註冊、去重、容量限制 |
| `src/services/lsp/passiveFeedback.ts` | 註冊 `publishDiagnostics` 通知處理器 |
| `src/tools/LSPTool/LSPTool.ts` | LSP Tool 實現（暴露給 Claude） |
| `src/tools/LSPTool/schemas.ts` | 輸入 schema（9 種操作的 discriminated union） |
| `src/tools/LSPTool/formatters.ts` | 各操作結果的格式化 |
| `src/tools/LSPTool/prompt.ts` | Tool 描述文本 |
| `src/utils/plugins/lspPluginIntegration.ts` | 從擴充功能加載、驗證、環境變量解析、作用域管理 |

## LSP Tool 支援的操作

| 操作 | LSP Method | 說明 |
|------|-----------|------|
| `goToDefinition` | `textDocument/definition` | 跳轉到符號定義 |
| `findReferences` | `textDocument/references` | 查找所有引用 |
| `hover` | `textDocument/hover` | 取得懸停信息（文件、類型） |
| `documentSymbol` | `textDocument/documentSymbol` | 取得檔案內所有符號 |
| `workspaceSymbol` | `workspace/symbol` | 全工作區符號搜索 |
| `goToImplementation` | `textDocument/implementation` | 查找介面/抽象方法的實現 |
| `prepareCallHierarchy` | `textDocument/prepareCallHierarchy` | 取得位置處的呼叫層級項 |
| `incomingCalls` | `callHierarchy/incomingCalls` | 查找呼叫此函數的所有函數 |
| `outgoingCalls` | `callHierarchy/outgoingCalls` | 查找此函數呼叫的所有函數 |

所有操作需要 `filePath`、`line`（1-based）和 `character`（1-based）參數。

## 插件開發：LSP 服務器設定

LSP 服務器通過插件提供。插件的 `manifest.json` 中可以聲明 LSP 服務器，支援三種格式：

**1. 內聯設定（在 manifest 中直接定義）**

```json
{
  "lspServers": {
    "typescript": {
      "command": "typescript-language-server",
      "args": ["--stdio"],
      "extensionToLanguage": {
        ".ts": "typescript",
        ".tsx": "typescriptreact"
      }
    }
  }
}
```

**2. 引用外部 .lsp.json 文件**

```json
{
  "lspServers": "path/to/.lsp.json"
}
```

**3. 數組混合格式**

```json
{
  "lspServers": [
    "path/to/.lsp.json",
    {
      "another-server": { "command": "...", "extensionToLanguage": { "...": "..." } }
    }
  ]
}
```

也可以在插件目錄下直接放置 `.lsp.json` 文件，無需在 manifest 中聲明。

### LSP 服務器設定 Schema

| 字段 | 類型 | 必填 | 說明 |
|------|------|------|------|
| `command` | string | 是 | LSP 服務器可執行命令（不含空格） |
| `args` | string[] | 否 | 命令行參數 |
| `extensionToLanguage` | Record<string, string> | 是 | 文件擴展名到語言 ID 的映射（至少一個） |
| `transport` | `"stdio"` \| `"socket"` | 否 | 通信方式，預設 `stdio` |
| `env` | Record<string, string> | 否 | 啓動服務器時設置的環境變量 |
| `initializationOptions` | unknown | 否 | 傳給服務器的初始化選項 |
| `settings` | unknown | 否 | 通過 `workspace/didChangeConfiguration` 傳遞的設置 |
| `workspaceFolder` | string | 否 | 工作區目錄路徑 |
| `startupTimeout` | number | 否 | 啓動超時時間（毫秒） |
| `maxRestarts` | number | 否 | 最大重啓次數（預設 3） |

### 環境變量替換

設定中的 `command`、`args`、`env`、`workspaceFolder` 支援：

- `${CLAUDE_PLUGIN_ROOT}` — 插件根目錄
- `${CLAUDE_PLUGIN_DATA}` — 插件資料目錄
- `${user_config.KEY}` — 用戶在插件啓用時設定的值
- `${VAR}` — 系統環境變量

## 生命週期管理

### 服務器狀態機

```
stopped → starting → running
running → stopping → stopped
any     → error (失敗時)
error   → starting (重試時)
```

### 崩潰恢復

- LSP 服務器崩潰時狀態設爲 `error`
- 下次請求時自動嘗試重啓（通過 `ensureServerStarted`）
- 超過 `maxRestarts`（預設 3）次後放棄

### 瞬態錯誤重試

- `ContentModified` 錯誤（LSP 錯誤碼 -32801）會自動重試，最多 3 次
- 使用指數退避：500ms → 1000ms → 2000ms
- 常見於 rust-analyzer 等仍在索引專案的服務器

### 診斷信息容量限制

- 每個文件最多 10 條診斷
- 總計最多 30 條診斷
- 超出部分按嚴重性排序後截斷（Error > Warning > Info > Hint）
- 跨 turn 去重：已發送過的相同診斷不會重複發送
- 檔案編輯後清除該文件的已發送記錄，允許新診斷通過

### 擴充功能重新整理

安裝/卸載擴充功能後使用 `/reload-plugins`，會呼叫 `reinitializeLspServerManager()`：
1. 異步關閉舊服務器實例
2. 重置狀態爲 `not-started`
3. 呼叫 `initializeLspServerManager()` 重新加載插件設定

## 依賴

- `vscode-jsonrpc` — JSON-RPC 通信（懶加載，僅在實際建立服務器實例時才 require）
- `vscode-languageserver-protocol` — LSP 協議類型
- `vscode-languageserver-types` — LSP 類型定義
- `lru-cache` — 診斷去重快取
