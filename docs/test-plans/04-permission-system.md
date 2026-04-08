# 權限系統測試計劃

## 概述

權限系統控制工具是否可以執行，包含規則解析器、權限檢查管線和權限模式判斷。測試重點是純函數解析器和規則匹配邏輯。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/utils/permissions/permissionRuleParser.ts` | `permissionRuleValueFromString`, `permissionRuleValueToString`, `escapeRuleContent`, `unescapeRuleContent`, `normalizeLegacyToolName`, `getLegacyToolNames` |
| `src/utils/permissions/PermissionMode.ts` | 權限模式常量和輔助函數 |
| `src/utils/permissions/permissions.ts` | `hasPermissionsToUseTool`, `getDenyRuleForTool`, `checkRuleBasedPermissions` |
| `src/types/permissions.ts` | `PermissionMode`, `PermissionBehavior`, `PermissionRule` 類型定義 |

---

## 測試用例

### src/utils/permissions/permissionRuleParser.ts

#### describe('escapeRuleContent')

- test('escapes backslashes first') — `'test\\value'` → `'test\\\\value'`
- test('escapes opening parentheses') — `'print(1)'` → `'print\\(1\\)'`
- test('escapes closing parentheses') — `'func()'` → `'func\\(\\)'`
- test('handles combined escape') — `'echo "test\\nvalue"'` 中的 `\\` 先轉義
- test('handles empty string') — `''` → `''`
- test('no-op for string without special chars') — `'npm install'` 原樣返回

#### describe('unescapeRuleContent')

- test('unescapes parentheses') — `'print\\(1\\)'` → `'print(1)'`
- test('unescapes backslashes last') — `'test\\\\nvalue'` → `'test\\nvalue'`
- test('handles empty string')
- test('roundtrip: escape then unescape returns original') — `unescapeRuleContent(escapeRuleContent(x)) === x`

#### describe('permissionRuleValueFromString')

- test('parses tool name only') — `'Bash'` → `{ toolName: 'Bash' }`
- test('parses tool name with content') — `'Bash(npm install)'` → `{ toolName: 'Bash', ruleContent: 'npm install' }`
- test('parses content with escaped parentheses') — `'Bash(python -c "print\\(1\\)")'` → ruleContent 爲 `'python -c "print(1)"'`
- test('treats empty parens as tool-wide rule') — `'Bash()'` → `{ toolName: 'Bash' }`（無 ruleContent）
- test('treats wildcard content as tool-wide rule') — `'Bash(*)'` → `{ toolName: 'Bash' }`
- test('normalizes legacy tool names') — `'Task'` → `{ toolName: 'Agent' }`（或對應的 AGENT_TOOL_NAME）
- test('handles malformed input: no closing paren') — `'Bash(npm'` → 整個字符串作爲 toolName
- test('handles malformed input: content after closing paren') — `'Bash(npm)extra'` → 整個字符串作爲 toolName
- test('handles missing tool name') — `'(foo)'` → 整個字符串作爲 toolName

#### describe('permissionRuleValueToString')

- test('serializes tool name only') — `{ toolName: 'Bash' }` → `'Bash'`
- test('serializes with content') — `{ toolName: 'Bash', ruleContent: 'npm install' }` → `'Bash(npm install)'`
- test('escapes content with parentheses') — ruleContent 含 `()` 時正確轉義
- test('roundtrip: fromString then toString preserves value') — 往返一致

#### describe('normalizeLegacyToolName')

- test('maps Task to Agent tool name') — `'Task'` → AGENT_TOOL_NAME
- test('maps KillShell to TaskStop tool name') — `'KillShell'` → TASK_STOP_TOOL_NAME
- test('maps AgentOutputTool to TaskOutput tool name')
- test('returns unknown names unchanged') — `'UnknownTool'` → `'UnknownTool'`

#### describe('getLegacyToolNames')

- test('returns legacy names for canonical name') — 給定 AGENT_TOOL_NAME 返回包含 `'Task'`
- test('returns empty array for name with no legacy aliases')

---

### src/utils/permissions/permissions.ts — 需 Mock

#### describe('getDenyRuleForTool')

- test('returns deny rule matching tool name') — 匹配到 blanket deny 規則時返回
- test('returns null when no deny rules match') — 無匹配時返回 null
- test('matches MCP tools by server prefix') — `mcp__server` 規則匹配該 server 下的 MCP 工具
- test('does not match content-specific deny rules') — 有 ruleContent 的 deny 規則不作爲 blanket deny

#### describe('checkRuleBasedPermissions')（集成級別）

- test('deny rule takes precedence over allow') — 同時有 allow 和 deny 時 deny 優先
- test('ask rule prompts user') — 匹配 ask 規則返回 `{ behavior: 'ask' }`
- test('allow rule permits execution') — 匹配 allow 規則返回 `{ behavior: 'allow' }`
- test('passthrough when no rules match') — 無匹配規則返回 passthrough

---

## Mock 需求

| 依賴 | Mock 方式 | 說明 |
|------|-----------|------|
| `bun:bundle` (feature) | 已 polyfill | BRIEF_TOOL_NAME 條件加載 |
| Tool 常量導入 | 實際值 | AGENT_TOOL_NAME 等從常量文件導入 |
| `appState` | mock object | `hasPermissionsToUseTool` 中的狀態依賴 |
| Tool 對象 | mock object | 模擬 tool 的 name, checkPermissions 等 |

## 集成測試場景

### describe('Permission pipeline end-to-end')

- test('deny rule blocks tool before it runs') — deny 規則在 call 前攔截
- test('bypassPermissions mode allows all') — bypass 模式下 ask → allow
- test('dontAsk mode converts ask to deny') — dontAsk 模式下 ask → deny
