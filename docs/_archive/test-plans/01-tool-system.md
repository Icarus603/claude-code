# Tool 系統測試計劃

## 概述

Tool 系統是 Claude Code 的核心，負責工具的定義、註冊、發現和過濾。本計劃覆蓋 `src/Tool.ts` 中的工具介面與工具函數、`src/tools.ts` 中的註冊/過濾邏輯，以及各工具目錄下可獨立測試的純函數。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/Tool.ts` | `buildTool`, `toolMatchesName`, `findToolByName`, `getEmptyToolPermissionContext`, `filterToolProgressMessages` |
| `src/tools.ts` | `parseToolPreset`, `filterToolsByDenyRules`, `getAllBaseTools`, `getTools`, `assembleToolPool` |
| `src/tools/shared/gitOperationTracking.ts` | `parseGitCommitId`, `detectGitOperation` |
| `src/tools/shared/spawnMultiAgent.ts` | `resolveTeammateModel`, `generateUniqueTeammateName` |
| `src/tools/GrepTool/GrepTool.ts` | `applyHeadLimit`, `formatLimitInfo`（內部輔助函數） |
| `src/tools/FileEditTool/utils.ts` | 字符串匹配/補丁相關純函數 |

---

## 測試用例

### src/Tool.ts

#### describe('buildTool')

- test('fills in default isEnabled as true') — 不傳 isEnabled 時，構建的 tool.isEnabled() 應返回 true
- test('fills in default isConcurrencySafe as false') — 預設值應爲 false（fail-closed）
- test('fills in default isReadOnly as false') — 預設假設有寫操作
- test('fills in default isDestructive as false') — 預設非破壞性
- test('fills in default checkPermissions as allow') — 預設 checkPermissions 應返回 `{ behavior: 'allow', updatedInput }`
- test('fills in default userFacingName from tool name') — userFacingName 預設應返回 tool.name
- test('preserves explicitly provided methods') — 傳入自定義 isEnabled 等方法時應覆蓋預設值
- test('preserves all non-defaultable properties') — name, inputSchema, call, description 等屬性原樣保留

#### describe('toolMatchesName')

- test('returns true for exact name match') — `{ name: 'Bash' }` 匹配 'Bash'
- test('returns false for non-matching name') — `{ name: 'Bash' }` 不匹配 'Read'
- test('returns true when name matches an alias') — `{ name: 'Bash', aliases: ['BashTool'] }` 匹配 'BashTool'
- test('returns false when aliases is undefined') — `{ name: 'Bash' }` 不匹配 'BashTool'
- test('returns false when aliases is empty') — `{ name: 'Bash', aliases: [] }` 不匹配 'BashTool'

#### describe('findToolByName')

- test('finds tool by primary name') — 從 tools 列表中按 name 找到工具
- test('finds tool by alias') — 從 tools 列表中按 alias 找到工具
- test('returns undefined when no match') — 找不到時返回 undefined
- test('returns first match when duplicates exist') — 多個同名工具時返回第一個

#### describe('getEmptyToolPermissionContext')

- test('returns default permission mode') — mode 應爲 'default'
- test('returns empty maps and arrays') — additionalWorkingDirectories 爲空 Map，rules 爲空對象
- test('returns isBypassPermissionsModeAvailable as false')

#### describe('filterToolProgressMessages')

- test('filters out hook_progress messages') — 移除 type 爲 hook_progress 的訊息
- test('keeps tool progress messages') — 保留非 hook_progress 的訊息
- test('returns empty array for empty input')
- test('handles messages without type field') — data 不含 type 時應保留

---

### src/tools.ts

#### describe('parseToolPreset')

- test('returns "default" for "default" input') — 精確匹配
- test('returns "default" for "Default" input') — 大小寫不敏感
- test('returns null for unknown preset') — 未知字符串返回 null
- test('returns null for empty string')

#### describe('filterToolsByDenyRules')

- test('returns all tools when no deny rules') — 空 deny 規則不過濾任何工具
- test('filters out tools matching blanket deny rule') — deny rule `{ toolName: 'Bash' }` 應移除 Bash
- test('does not filter tools with content-specific deny rules') — deny rule `{ toolName: 'Bash', ruleContent: 'rm -rf' }` 不移除 Bash（只在執行時阻止特定命令）
- test('filters MCP tools by server name prefix') — deny rule `mcp__server` 應移除該 server 下所有工具
- test('preserves tools not matching any deny rule')

#### describe('getAllBaseTools')

- test('returns a non-empty array of tools') — 至少包含核心工具
- test('each tool has required properties') — 每個工具應有 name, inputSchema, call 等屬性
- test('includes BashTool, FileReadTool, FileEditTool') — 核心工具始終存在
- test('includes TestingPermissionTool when NODE_ENV is test') — 需設置 env

#### describe('getTools')

- test('returns filtered tools based on permission context') — 根據 deny rules 過濾
- test('returns simple tools in CLAUDE_CODE_SIMPLE mode') — 僅返回 Bash/Read/Edit
- test('filters disabled tools via isEnabled') — isEnabled 返回 false 的工具被排除

---

### src/tools/shared/gitOperationTracking.ts

#### describe('parseGitCommitId')

- test('extracts commit hash from git commit output') — 從 `[main abc1234] message` 中提取 `abc1234`
- test('returns null for non-commit output') — 無法解析時返回 null
- test('handles various branch name formats') — `[feature/foo abc1234]` 等

#### describe('detectGitOperation')

- test('detects git commit operation') — 命令含 `git commit` 時識別爲 commit
- test('detects git push operation') — 命令含 `git push` 時識別
- test('returns null for non-git commands') — 非 git 命令返回 null
- test('detects git merge operation')
- test('detects git rebase operation')

---

### src/tools/shared/spawnMultiAgent.ts

#### describe('resolveTeammateModel')

- test('returns specified model when provided')
- test('falls back to default model when not specified')

#### describe('generateUniqueTeammateName')

- test('generates a name when no existing names') — 無衝突時返回基礎名
- test('appends suffix when name conflicts') — 與已有名稱衝突時添加後綴
- test('handles multiple conflicts') — 多次衝突時遞增後綴

---

## Mock 需求

| 依賴 | Mock 方式 | 說明 |
|------|-----------|------|
| `bun:bundle` (feature) | 已 polyfill 爲 `() => false` | 不需額外 mock |
| `process.env` | `bun:test` mock | 測試 `USER_TYPE`、`NODE_ENV`、`CLAUDE_CODE_SIMPLE` |
| `getDenyRuleForTool` | mock module | `filterToolsByDenyRules` 測試中需控制返回值 |
| `isToolSearchEnabledOptimistic` | mock module | `getAllBaseTools` 中條件加載 |

## 集成測試場景

放在 `tests/integration/tool-chain.test.ts`：

### describe('Tool registration and discovery')

- test('getAllBaseTools returns tools that can be found by findToolByName') — 註冊 → 查找完整鏈路
- test('filterToolsByDenyRules + getTools produces consistent results') — 過濾管線一致性
- test('assembleToolPool deduplicates built-in and MCP tools') — 合併去重邏輯
