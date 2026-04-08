# MCP_SKILLS — MCP 技能發現

> Feature Flag: `FEATURE_MCP_SKILLS=1`
> 實現狀態：功能性實現（config 門控篩選器完整，核心 fetcher 爲 stub）
> 引用數：9

## 一、功能概述

MCP_SKILLS 將 MCP 服務器暴露的資源（`skill://` URI 方案）發現並轉換爲可呼叫的技能命令。MCP 服務器可以同時提供 tools、prompts 和 resources；啓用此 feature 後，帶有 `skill://` URI 的資源被識別爲技能。

### 核心特性

- **自動發現**：MCP 服務器連接時自動取得 `skill://` 資源
- **命令轉換**：將 MCP 資源轉換爲 `prompt` 類型的 Command 對象
- **實時刷新**：prompts/resources 列表變化時重新取得技能
- **快取一致性**：連接關閉時清除技能快取

## 二、實現架構

### 2.1 資料流

```
MCP Server 連接
      │
      ▼
client.ts: connectToServer / setupMcpClientConnections
  ├── fetchToolsForClient     (MCP tools)
  ├── fetchCommandsForClient   (MCP prompts → Command 對象)
  ├── fetchMcpSkillsForClient  (MCP skill:// 資源 → Command 對象) [MCP_SKILLS]
  └── fetchResourcesForClient  (MCP resources)
      │
      ▼
commands = [...mcpPrompts, ...mcpSkills]
      │
      ▼
AppState.mcp.commands 更新
      │
      ▼
getMcpSkillCommands() 過濾 → SkillTool 呼叫
```

### 2.2 技能篩選

文件：`src/commands.ts:547-558`

`getMcpSkillCommands(mcpCommands)` 過濾條件：

```ts
cmd.type === 'prompt'                  // 必須是 prompt 類型
cmd.loadedFrom === 'mcp'               // 必須來自 MCP 服務器
!cmd.disableModelInvocation            // 必須可由模型呼叫
feature('MCP_SKILLS')                  // feature flag 必須開啓
```

### 2.3 條件加載

文件：`src/services/mcp/client.ts:117-121`

`fetchMcpSkillsForClient` 通過 `require()` 條件加載，feature flag 關閉時不加載任何模組：

```ts
const fetchMcpSkillsForClient = feature('MCP_SKILLS')
  ? require('../../skills/mcpSkills.js').fetchMcpSkillsForClient
  : null
```

### 2.4 快取管理

技能取得函數維護 `.cache`（Map），在以下時機清除：

| 事件 | 行爲 |
|------|------|
| 連接關閉 | 清除該 client 的技能快取 |
| `disconnectMcpServer()` | 清除技能快取 |
| `prompts/list_changed` 通知 | 刷新 prompts + 並行取得技能 |
| `resources/list_changed` 通知 | 刷新 resources + prompts + 技能 |

### 2.5 集成點

| 文件 | 行 | 說明 |
|------|------|------|
| `src/commands.ts` | 547-558, 561-608 | 命令過濾和 SkillTool 命令收集 |
| `src/services/mcp/client.ts` | 117-121, 1394, 1672, 2173-2181, 2346-2358 | 技能取得、快取清除、連接時取得 |
| `src/services/mcp/useManageMCPConnections.ts` | 22-26, 682-740 | 實時刷新（prompts/resources 變化） |

## 三、關鍵設計決策

1. **Feature gate 隔離**：`feature('MCP_SKILLS')` 守護條件 `require()` 和所有呼叫點。關閉時無模組加載、無取得操作
2. **資源到技能映射**：技能從 MCP 服務器的 `skill://` URI 資源中發現。`fetchMcpSkillsForClient` 負責轉換（當前爲 stub）
3. **循環依賴避免**：`mcpSkillBuilders.ts` 作爲依賴圖葉節點，避免 `client.ts ↔ mcpSkills.ts ↔ loadSkillsDir.ts` 循環
4. **服務器能力檢查**：技能取得還需要 MCP 服務器支援 resources (`!!client.capabilities?.resources`)

## 四、使用方式

```bash
# 啓用 feature
FEATURE_MCP_SKILLS=1 bun run dev

# 前提條件：
# 1. 設定了支援 skill:// 資源的 MCP 服務器
# 2. MCP 服務器聲明瞭 resources 能力
```

## 五、需要補全的內容

| 文件 | 狀態 | 需要實現 |
|------|------|---------|
| `src/skills/mcpSkills.ts` | Stub | `fetchMcpSkillsForClient()` — 從 MCP 資源列表中篩選 `skill://` URI 並轉換爲 Command 對象 |
| `src/skills/mcpSkillBuilders.ts` | Stub | 技能構建器註冊（避免循環依賴） |

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/commands.ts:547-608` | 技能命令過濾 |
| `src/services/mcp/client.ts:117-2358` | 技能取得 + 快取管理 |
| `src/services/mcp/useManageMCPConnections.ts` | 實時刷新 |
| `src/skills/mcpSkills.ts` | 核心轉換邏輯（stub） |
