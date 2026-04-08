# Context 構建測試計劃

## 概述

Context 構建系統負責組裝發送給 Claude API 的系統提示和用戶上下文。包括 git 狀態取得、CLAUDE.md 文件發現與加載、系統提示拼裝三部分。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/context.ts` | `getSystemContext`, `getUserContext`, `getGitStatus`, `setSystemPromptInjection` |
| `src/utils/claudemd.ts` | `stripHtmlComments`, `getClaudeMds`, `isMemoryFilePath`, `getLargeMemoryFiles`, `filterInjectedMemoryFiles`, `getExternalClaudeMdIncludes`, `hasExternalClaudeMdIncludes`, `processMemoryFile`, `getMemoryFiles` |
| `src/utils/systemPrompt.ts` | `buildEffectiveSystemPrompt` |

---

## 測試用例

### src/utils/claudemd.ts — 純函數部分

#### describe('stripHtmlComments')

- test('strips block-level HTML comments') — `"text <!-- comment --> more"` → content 不含註釋
- test('preserves inline content') — 行內文本保留
- test('preserves code block content') — ` ```html\n<!-- not stripped -->\n``` ` 內的註釋不移除
- test('returns stripped: false when no comments') — 無註釋時 stripped 爲 false
- test('returns stripped: true when comments exist')
- test('handles empty string') — `""` → `{ content: "", stripped: false }`
- test('handles multiple comments') — 多個註釋全部移除

#### describe('getClaudeMds')

- test('assembles memory files with type descriptions') — 不同 type 的文件有不同前綴描述
- test('includes instruction prompt prefix') — 輸出包含指令前綴
- test('handles empty memory files array') — 空數組返回空字符串或最小前綴
- test('respects filter parameter') — filter 函數可過濾特定類型
- test('concatenates multiple files with separators')

#### describe('isMemoryFilePath')

- test('returns true for CLAUDE.md path') — `"/project/CLAUDE.md"` → true
- test('returns true for .claude/rules/ path') — `"/project/.claude/rules/foo.md"` → true
- test('returns true for memory file path') — `"~/.claude/memory/foo.md"` → true
- test('returns false for regular file') — `"/project/src/main.ts"` → false
- test('returns false for unrelated .md file') — `"/project/README.md"` → false

#### describe('getLargeMemoryFiles')

- test('returns files exceeding 40K chars') — 內容 > MAX_MEMORY_CHARACTER_COUNT 的文件被返回
- test('returns empty array when all files are small')
- test('correctly identifies threshold boundary')

#### describe('filterInjectedMemoryFiles')

- test('filters out AutoMem type files') — feature flag 開啓時移除自動記憶
- test('filters out TeamMem type files')
- test('preserves other types') — 非 AutoMem/TeamMem 的文件保留

#### describe('getExternalClaudeMdIncludes')

- test('returns includes from outside CWD') — 外部 @include 路徑被識別
- test('returns empty array when all includes are internal')

#### describe('hasExternalClaudeMdIncludes')

- test('returns true when external includes exist')
- test('returns false when no external includes')

---

### src/utils/systemPrompt.ts

#### describe('buildEffectiveSystemPrompt')

- test('returns default system prompt when no overrides') — 無任何覆蓋時使用預設提示
- test('overrideSystemPrompt replaces everything') — override 模式替換全部內容
- test('customSystemPrompt replaces default') — `--system-prompt` 參數替換預設
- test('appendSystemPrompt is appended after main prompt') — append 在主提示之後
- test('agent definition replaces default prompt') — agent 模式使用 agent prompt
- test('agent definition with append combines both') — agent prompt + append
- test('override takes precedence over agent and custom') — 優先級最高
- test('returns array of strings') — 返回值爲 SystemPrompt 類型（字符串數組）

---

### src/context.ts — 需 Mock 的部分

#### describe('getGitStatus')

- test('returns formatted git status string') — 包含 branch、status、log、user
- test('truncates status at 2000 chars') — 超長 status 被截斷
- test('returns null in test environment') — `NODE_ENV=test` 時返回 null
- test('returns null in non-git directory') — 非 git 倉庫返回 null
- test('runs git commands in parallel') — 多個 git 命令並行執行

#### describe('getSystemContext')

- test('includes gitStatus key') — 返回對象包含 gitStatus
- test('returns memoized result on subsequent calls') — 多次呼叫返回同一結果
- test('skips git when instructions disabled')

#### describe('getUserContext')

- test('includes currentDate key') — 返回對象包含當前日期
- test('includes claudeMd key when CLAUDE.md exists') — 加載 CLAUDE.md 內容
- test('respects CLAUDE_CODE_DISABLE_CLAUDE_MDS env') — 設置後不加載 CLAUDE.md
- test('returns memoized result')

#### describe('setSystemPromptInjection')

- test('clears memoized context caches') — 呼叫後下次 getSystemContext/getUserContext 重新計算
- test('injection value is accessible via getSystemPromptInjection')

---

## Mock 需求

| 依賴 | Mock 方式 | 用途 |
|------|-----------|------|
| `execFileNoThrow` | `mock.module` | `getGitStatus` 中的 git 命令 |
| `getMemoryFiles` | `mock.module` | `getUserContext` 中的 CLAUDE.md 加載 |
| `getCwd` | `mock.module` | 路徑解析上下文 |
| `process.env.NODE_ENV` | 直接設置 | 測試環境檢測 |
| `process.env.CLAUDE_CODE_DISABLE_CLAUDE_MDS` | 直接設置 | 禁用 CLAUDE.md |

## 集成測試場景

放在 `tests/integration/context-build.test.ts`：

### describe('Context assembly pipeline')

- test('getUserContext produces claudeMd containing CLAUDE.md content') — 端到端驗證 CLAUDE.md 被正確加載到 context
- test('buildEffectiveSystemPrompt + getUserContext produces complete prompt') — 系統提示 + 用戶上下文完整性
- test('setSystemPromptInjection invalidates and rebuilds context') — 注入後重新構建上下文
