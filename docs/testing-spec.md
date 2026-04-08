# Testing Specification

本文件定義 claude-code 專案的測試規範、當前覆蓋狀態和改進計劃。

## 1. 技術棧

| 項 | 選型 |
|----|------|
| 測試框架 | `bun:test` |
| 斷言/Mock | `bun:test` 內置 |
| 覆蓋率 | `bun test --coverage` |
| CI | GitHub Actions，push/PR 到 main 自動執行 |

## 2. 測試層次

本專案採用 **單元測試 + 集成測試** 兩層結構，不做 E2E 或快照測試。

- **單元測試** — 純函數、工具類、解析器。文件就近放置於 `src/**/__tests__/`。
- **集成測試** — 多模組協作流程。集中於 `tests/integration/`。

## 3. 文件結構與命名

```
src/
├── utils/__tests__/           # 純函數單元測試
├── tools/<Tool>/__tests__/    # Tool 單元測試
├── services/mcp/__tests__/    # MCP 單元測試
├── utils/permissions/__tests__/
├── utils/model/__tests__/
├── utils/settings/__tests__/
├── utils/shell/__tests__/
├── utils/git/__tests__/
└── __tests__/                 # 頂層模組測試 (Tool.ts, tools.ts)
tests/
├── integration/               # 集成測試（尚未建立）
├── mocks/                     # 共享 mock/fixture（尚未建立）
└── helpers/                   # 測試輔助函數
```

- 測試文件：`<module>.test.ts`
- 命名風格：`describe("functionName")` + `test("行爲描述")`，英文
- 編寫原則：Arrange-Act-Assert、單一職責、獨立性、邊界覆蓋

## 4. 當前覆蓋狀態

> 更新日期：2026-04-02 | **1623 tests, 84 files, 0 fail, 851ms**

### 4.1 可靠度評分

每個測試文件按斷言深度、邊界覆蓋、mock 質量、測試獨立性綜合評定：

| 等級 | 含義 |
|------|------|
| **GOOD** | 斷言精確（exact match），邊界充分，結構清晰 |
| **ACCEPTABLE** | 正常路徑覆蓋完整，部分邊界或斷言可加強 |
| **WEAK** | 存在明顯缺陷：斷言過弱、重要邊界缺失、或有脆弱性風險 |

### 4.2 按模組分佈

#### P0 — 核心模組

| 文件 | Tests | 評分 | 覆蓋範圍 | 主要不足 |
|------|-------|------|----------|----------|
| `src/__tests__/Tool.test.ts` | 20 | GOOD | buildTool, toolMatchesName, findToolByName, filterToolProgressMessages | — |
| `src/__tests__/tools.test.ts` | 9 | ACCEPTABLE | parseToolPreset, filterToolsByDenyRules | 預設覆蓋僅測 "default"；有冗餘用例 |
| `src/tools/FileEditTool/__tests__/utils.test.ts` | 22 | ACCEPTABLE | normalizeQuotes, applyEditToFile, preserveQuoteStyle | `findActualString` 斷言過弱（`not.toBeNull`）；`preserveQuoteStyle` 僅 2 用例 |
| `src/tools/shared/__tests__/gitOperationTracking.test.ts` | 20 | ACCEPTABLE | parseGitCommitId, detectGitOperation | 6 個 GH PR action 全覆蓋；缺 `trackGitOperations` 測試（需 mock analytics） |
| `src/tools/BashTool/__tests__/destructiveCommandWarning.test.ts` | 21 | ACCEPTABLE | git/rm/SQL/k8s/terraform 危險模式 | safe commands 4 斷言合一；缺少 `rm -rf /`、`DROP DATABASE`、管道命令 |
| `src/tools/BashTool/__tests__/commandSemantics.test.ts` | 10 | ACCEPTABLE | grep/diff/test/rg/find 退出碼語義 | mock `splitCommand_DEPRECATED` 與實現可能分歧；覆蓋可更全面 |

**Utils 純函數（19 文件）：**

| 文件 | Tests | 評分 | 覆蓋範圍 | 主要不足 |
|------|-------|------|----------|----------|
| `utils/__tests__/array.test.ts` | 12 | GOOD | intersperse, count, uniq | — |
| `utils/__tests__/set.test.ts` | 11 | GOOD | difference, intersects, every, union | — |
| `utils/__tests__/xml.test.ts` | 9 | GOOD | escapeXml, escapeXmlAttr | 缺 null/undefined 輸入測試 |
| `utils/__tests__/hash.test.ts` | 12 | ACCEPTABLE | djb2Hash, hashContent, hashPair | `hashContent`/`hashPair` 無已知答案斷言（僅測確定性） |
| `utils/__tests__/stringUtils.test.ts` | 30 | GOOD | 10 個函數全覆蓋，含 Unicode 邊界 | — |
| `utils/__tests__/semver.test.ts` | 16 | ACCEPTABLE | gt/gte/lt/lte/satisfies/order | 缺 pre-release、tilde range、畸形版本串 |
| `utils/__tests__/uuid.test.ts` | 6 | ACCEPTABLE | validateUuid | 大寫測試僅 `not.toBeNull`，未驗證標準化輸出 |
| `utils/__tests__/format.test.ts` | 27 | GOOD | formatFileSize, formatDuration, formatNumber, formatTokens, formatRelativeTime | 全部 `toBe` 精確匹配，含 billions/weeks/days 邊界 |
| `utils/__tests__/frontmatterParser.test.ts` | 22 | GOOD | parseFrontmatter, splitPathInFrontmatter, parsePositiveIntFromFrontmatter | — |
| `utils/__tests__/file.test.ts` | 13 | ACCEPTABLE | convertLeadingTabsToSpaces, addLineNumbers, stripLineNumberPrefix | `addLineNumbers` 僅 `toContain`；缺 Windows 路徑分隔符測試 |
| `utils/__tests__/glob.test.ts` | 6 | ACCEPTABLE | extractGlobBaseDirectory | 缺絕對路徑、根 `/`、Windows 路徑 |
| `utils/__tests__/diff.test.ts` | 8 | ACCEPTABLE | adjustHunkLineNumbers, getPatchFromContents | `getPatchFromContents` 僅檢查結構，未驗證 diff 內容正確性 |
| `utils/__tests__/json.test.ts` | 15 | GOOD | safeParseJSON, parseJSONL, addItemToJSONCArray | — |
| `utils/__tests__/truncate.test.ts` | 18 | ACCEPTABLE | truncateToWidth, wrapText, truncatePathMiddle | **缺 CJK/emoji/wide-char 測試**（這是寬度感知實現的核心場景） |
| `utils/__tests__/path.test.ts` | 15 | ACCEPTABLE | containsPathTraversal, normalizePathForConfigKey | 僅覆蓋 2/5+ 導出函數 |
| `utils/__tests__/tokens.test.ts` | 18 | GOOD | getTokenCountFromUsage, doesMostRecentAssistantMessageExceed200k 等 | — |
| `utils/__tests__/stream.test.ts` | 15 | GOOD | Stream\<T\> enqueue/read/drain/next/done/error/for-await | — |
| `utils/__tests__/abortController.test.ts` | 13 | GOOD | createAbortController/createChildAbortController 父子傳播 | — |
| `utils/__tests__/bufferedWriter.test.ts` | 10 | GOOD | createBufferedWriter 立即/緩衝/flush/overflow | — |
| `utils/__tests__/gitDiff.test.ts` | 25 | GOOD | parseGitNumstat/parseGitDiff/parseShortstat 純解析 | — |
| `utils/__tests__/sliceAnsi.test.ts` | 13 | GOOD | sliceAnsi ANSI 感知切片 + undoAnsiCodes | — |
| `utils/__tests__/treeify.test.ts` | 13 | ACCEPTABLE | treeify 扁平/嵌套/循環引用 | 缺深度嵌套性能測試 |
| `utils/__tests__/words.test.ts` | 11 | GOOD | slug 格式 (adjective-verb-noun)、唯一性 | — |

**Context 構建（3 文件）：**

| 文件 | Tests | 評分 | 覆蓋範圍 | 主要不足 |
|------|-------|------|----------|----------|
| `utils/__tests__/claudemd.test.ts` | 14 | ACCEPTABLE | stripHtmlComments, isMemoryFilePath, getLargeMemoryFiles | **僅測 3 個輔助函數**，核心發現/加載/`@include` 指令/memoization 未覆蓋 |
| `utils/__tests__/systemPrompt.test.ts` | 8 | GOOD | buildEffectiveSystemPrompt | — |
| `__tests__/history.test.ts` | 26 | GOOD | parseReferences/expandPastedTextRefs/formatPastedTextRef 等 5 個函數 | — |

#### P1 — 重要模組

| 文件 | Tests | 評分 | 覆蓋範圍 | 主要不足 |
|------|-------|------|----------|----------|
| `permissions/__tests__/permissionRuleParser.test.ts` | 16 | GOOD | escape/unescape 規則，roundtrip 完整性 | — |
| `permissions/__tests__/permissions.test.ts` | 12 | ACCEPTABLE | getDenyRuleForTool, getAskRuleForTool, filterDeniedAgents | `as any` cast；缺 MCP tool deny 測試 |
| `permissions/__tests__/shellRuleMatching.test.ts` | 19 | GOOD | 通配符、轉義、正則特殊字符 | — |
| `permissions/__tests__/PermissionMode.test.ts` | 22 | ACCEPTABLE | permissionModeFromString, isExternalPermissionMode 等 | isExternalPermissionMode ant false 路徑已覆蓋；缺 `bubble` 模式獨立測試 |
| `permissions/__tests__/dangerousPatterns.test.ts` | 7 | WEAK | CROSS_PLATFORM_CODE_EXEC, DANGEROUS_BASH_PATTERNS | 純資料 smoke test，無行爲測試；不驗證數組無重複 |
| `model/__tests__/aliases.test.ts` | 15 | ACCEPTABLE | isModelAlias, isModelFamilyAlias | 缺 null/undefined/空串輸入 |
| `model/__tests__/model.test.ts` | 13 | ACCEPTABLE | firstPartyNameToCanonical | 缺空串、非標準日期後綴 |
| `model/__tests__/providers.test.ts` | 9 | ACCEPTABLE | getAPIProvider, isFirstPartyAnthropicBaseUrl | `originalEnv` 聲明未使用；env 恢復不完整 |
| `utils/__tests__/messages.test.ts` | 36 | GOOD | createAssistantMessage, createUserMessage, extractTag 等 16 個 describe | `normalizeMessages` 僅檢查長度未驗證內容 |

**Tool 子模組（8 文件）：**

| 文件 | Tests | 評分 | 覆蓋範圍 | 主要不足 |
|------|-------|------|----------|----------|
| `tools/PowerShellTool/__tests__/powershellSecurity.test.ts` | 24 | GOOD | AST 安全檢測：Invoke-Expression/iex/encoded/dynamic/download/COM | — |
| `tools/PowerShellTool/__tests__/commandSemantics.test.ts` | 21 | GOOD | grep/rg/findstr/robocopy 退出碼、pipeline last-segment | — |
| `tools/PowerShellTool/__tests__/destructiveCommandWarning.test.ts` | 38 | GOOD | Remove-Item/Format-Volume/Clear-Disk/git/SQL/COMPUTER/alias 全覆蓋 | — |
| `tools/PowerShellTool/__tests__/gitSafety.test.ts` | 29 | GOOD | .git 路徑檢測/NTFS 短名/反斜槓/引號/反引號轉義 | — |
| `tools/LSPTool/__tests__/formatters.test.ts` | 18 | GOOD | 全部 8 個 format 函數 null/empty/valid 輸入 | — |
| `tools/LSPTool/__tests__/schemas.test.ts` | 13 | GOOD | isValidLSPOperation 類型守衛 9 種操作 + 無效/空/大小寫 | — |
| `tools/WebFetchTool/__tests__/preapproved.test.ts` | 18 | GOOD | isPreapprovedHost 精確/路徑作用域/子路徑/大小寫/子域名 | — |
| `tools/WebFetchTool/__tests__/urlValidation.test.ts` | 18 | GOOD | validateURL/isPermittedRedirect 本地重實現（避免重依賴鏈） | — |

#### P2 — 補充模組

| 文件 | Tests | 評分 | 覆蓋範圍 | 主要不足 |
|------|-------|------|----------|----------|
| `utils/__tests__/cron.test.ts` | 31 | GOOD | parseCronExpression, computeNextCronRun, cronToHuman | 缺月邊界、閏年 |
| `utils/__tests__/git.test.ts` | 15 | ACCEPTABLE | normalizeGitRemoteUrl (SSH/HTTPS/ssh://) | 缺 git://、file://、端口號 |
| `settings/__tests__/config.test.ts` | 38 | GOOD | SettingsSchema, type guards, validateSettingsFileContent, formatZodError | 缺 DeniedMcpServerEntrySchema |

#### P3-P6 — 擴展覆蓋（27 文件）

| 文件 | Tests | 評分 | 備註 |
|------|-------|------|------|
| `utils/__tests__/errors.test.ts` | 33 | GOOD | — |
| `utils/__tests__/envUtils.test.ts` | 33 | GOOD | env 保存/恢復規範 |
| `utils/__tests__/effort.test.ts` | 30 | GOOD | 5 個 mock 模組，邊界完整 |
| `utils/__tests__/argumentSubstitution.test.ts` | 22 | ACCEPTABLE | 缺轉義引號、越界索引 |
| `utils/__tests__/sanitization.test.ts` | 14 | ACCEPTABLE | — |
| `utils/__tests__/sleep.test.ts` | 14 | GOOD | 時間相關測試，margin 充足 |
| `utils/__tests__/CircularBuffer.test.ts` | 11 | ACCEPTABLE | 缺 capacity=1、空 buffer getRecent |
| `utils/__tests__/memoize.test.ts` | 18 | GOOD | 快取 hit/stale/LRU 全覆蓋 |
| `utils/__tests__/tokenBudget.test.ts` | 21 | GOOD | — |
| `utils/__tests__/displayTags.test.ts` | 17 | GOOD | — |
| `utils/__tests__/taggedId.test.ts` | 10 | GOOD | — |
| `utils/__tests__/controlMessageCompat.test.ts` | 15 | GOOD | — |
| `utils/__tests__/gitConfigParser.test.ts` | 21 | GOOD | — |
| `utils/__tests__/windowsPaths.test.ts` | 19 | GOOD | 雙向 round-trip 測試 |
| `utils/__tests__/envExpansion.test.ts` | 15 | GOOD | — |
| `utils/__tests__/formatBriefTimestamp.test.ts` | 10 | GOOD | 固定 now 時間戳，確定性 |
| `utils/__tests__/notebook.test.ts` | 9 | ACCEPTABLE | 合併斷言偏弱 |
| `utils/__tests__/hyperlink.test.ts` | 10 | ACCEPTABLE | 空串測試行爲註釋混亂 |
| `utils/__tests__/zodToJsonSchema.test.ts` | 9 | WEAK | **object 屬性僅 `toBeDefined` 未驗證類型**；optional 字段未驗證 absence |
| `utils/__tests__/objectGroupBy.test.ts` | 5 | ACCEPTABLE | 極簡，缺 undefined key 測試 |
| `utils/__tests__/contentArray.test.ts` | 6 | ACCEPTABLE | 缺混合 tool_result+text 交替 |
| `utils/__tests__/slashCommandParsing.test.ts` | 8 | GOOD | — |
| `utils/__tests__/groupToolUses.test.ts` | 10 | GOOD | — |
| `utils/__tests__/shell/__tests__/outputLimits.test.ts` | 7 | ACCEPTABLE | — |
| `utils/__tests__/envValidation.test.ts` | 12 | GOOD | validateBoundedIntEnvVar | value=1 無下界確認爲設計意圖（函數僅校驗 >0 和 <=upperLimit） |
| `utils/git/__tests__/gitConfigParser.test.ts` | 20 | GOOD | — |
| `services/mcp/__tests__/mcpStringUtils.test.ts` | 16 | GOOD | — |
| `services/mcp/__tests__/normalization.test.ts` | 10 | GOOD | — |

### 4.3 評分彙總

| 等級 | 文件數 | 佔比 |
|------|--------|------|
| **GOOD** | 46 | 55% |
| **ACCEPTABLE** | 32 | 38% |
| **WEAK** | 6 | 7% |

## 5. 系統性問題

### 5.1 斷言過弱（Smell: `toContain` 代替精確匹配）

以下文件的部分測試使用 `toContain` 或 `not.toBeNull` 檢查結果，當實現返回包含目標子串的任何字符串時測試仍通過，無法檢測格式錯誤：

| 文件 | 受影響函數 | 建議 |
|------|-----------|------|
| `file.test.ts` | addLineNumbers | 斷言完整輸出格式 |
| `diff.test.ts` | getPatchFromContents | 驗證 hunk 內容正確性 |
| `notebook.test.ts` | mapNotebookCellsToToolResult | 驗證合併後內容 |
| `uuid.test.ts` | validateUuid (uppercase) | 斷言標準化後的精確值 |

### 5.2 集成測試空白

Spec 定義的三個集成測試均未建立：

| 計劃 | 狀態 | 依賴 |
|------|------|------|
| `tests/integration/tool-chain.test.ts` | 未建立 | 需 mock tools.ts 完整註冊鏈 |
| `tests/integration/context-build.test.ts` | 未建立 | 需 mock context.ts 重依賴鏈 |
| `tests/integration/message-pipeline.test.ts` | 未建立 | 需 mock API 層 |

`tests/mocks/` 目錄也不存在，無共享 mock/fixture 基礎設施。

### 5.3 Mock 相關

| 問題 | 影響文件 | 說明 |
|------|----------|------|
| 未 mock 重依賴 | `gitOperationTracking.test.ts` | `trackGitOperations` 呼叫 analytics/bootstrap，測試僅覆蓋 `detectGitOperation`（無副作用） |
| env 恢復不完整 | `providers.test.ts` | 僅刪除已知 key，新增 env var 會導致測試泄漏 |

### 5.4 潛在 Bug

| 文件 | 函數 | 問題 |
|------|------|------|
| ~~`envValidation.test.ts`~~ | ~~validateBoundedIntEnvVar~~ | ~~value=1 無下界檢查~~ — **已確認**：函數僅校驗 `parsed > 0` 和 `parsed <= upperLimit`，不強制 `parsed >= defaultValue`，爲設計意圖 |

### 5.5 已知限制

| 模組 | 問題 |
|------|------|
| `Bun.JSONL.parseChunk` | 畸形行時無限掛起（Bun 1.3.10 bug） |
| `context.ts` 核心邏輯 | 依賴 bootstrap/state + git + 50+ 模組，mock 不可行 |
| `tools.ts` (getAllBaseTools) | 導入鏈過重 |
| `spawnMultiAgent.ts` | 50+ 依賴 |
| `messages.ts` 部分函數 | 依賴 `getFeatureValue_CACHED_MAY_BE_STALE` |
| UI 組件 (`screens/`, `components/`) | 需 Ink 渲染測試環境 |

### 5.6 Mock 模式

通過 `mock.module()` + `await import()` 解鎖重依賴模組：

| 被 Mock 模組 | 解鎖的測試 |
|-------------|-----------|
| `src/utils/log.ts` | json, tokens, FileEditTool/utils, permissions, memoize, PermissionMode |
| `src/services/tokenEstimation.ts` | tokens |
| `src/utils/slowOperations.ts` | tokens, permissions, memoize, PermissionMode |
| `src/utils/debug.ts` | envValidation, outputLimits |
| `src/utils/bash/commands.ts` | commandSemantics |
| `src/utils/thinking.js` | effort |
| `src/utils/settings/settings.js` | effort |
| `src/utils/auth.js` | effort |
| `src/services/analytics/growthbook.js` | effort, tokenBudget |
| `src/utils/powershell/dangerousCmdlets.js` | powershellSecurity |
| `src/utils/cwd.js` | gitSafety |
| `src/utils/powershell/parser.js` | gitSafety |
| `src/utils/stringUtils.js` | LSP formatters |
| `figures` | treeify |

**約束**：`mock.module()` 必須在每個測試檔案內聯呼叫，不能從共享 helper 導入。

## 6. 完成狀態

> 更新日期：2026-04-02 | **1623 tests, 84 files, 0 fail, 851ms**

### 已完成

| 計劃 | 狀態 | 新增測試 | 說明 |
|------|------|---------|------|
| Plan 12 — Mock 可靠性 | **已完成** | +9 | PermissionMode ant false 路徑、providers env 快照恢復 |
| Plan 10 — WEAK 修復 | **已完成** | +15 | format 斷言精確化、envValidation 修正、zodToJsonSchema/destructors/notebook 加固 |
| Plan 13 — CJK/Emoji | **已完成** | +17 | truncate CJK/emoji 寬度感知測試 |
| Plan 11 — ACCEPTABLE 加強 | **已完成** | +62 | diff/uuid/hash/semver/path/claudemd/fileEdit/providers/messages 等 15 文件 |
| Plan 14 — 集成測試 | **已完成** | +43 | 搭建 tests/mocks/ + tool-chain/context-build/message-pipeline/cli-arguments |
| Plan 15 — CLI + 覆蓋率 | **已完成** | +11 | Commander.js 參數解析、覆蓋率基線 |
| Phase 16 — 零依賴純函數 | **已完成** | +126 | stream/abortController/bufferedWriter/gitDiff/history/sliceAnsi/treeify/words 8 文件 |
| Phase 17 — 工具子模組 | **已完成** | +179 | PowerShell 安全/語義/破壞性/gitSafety + LSP 格式化/schema + WebFetch 預批准/URL 8 文件 |
| Phase 18 — WEAK 修復 | **已完成** | +20 | format 精確匹配、envValidation 邊界、PermissionMode 補強、gitOperationTracking PR actions |

### 覆蓋率基線

| 指標 | 數值 |
|------|------|
| 總測試數 | 1623 |
| 測試文件數 | 84 |
| 失敗數 | 0 |
| 斷言數 | 2516 |
| 執行耗時 | ~851ms |
| Tool.ts 行覆蓋率 | 100% |
| 整體行覆蓋率 | ~33%（Bun coverage 限制：`mock.module` 模式下的模組不報告） |

> **注意**：Bun `--coverage` 僅報告測試 import 鏈中直接加載的文件。使用 `mock.module()` + `await import()` 模式的源文件（大多數 `src/utils/` 純函數）不顯示在覆蓋率報告中。實際測試覆蓋率高於報告值。

### 不納入計劃

| 模組 | 原因 |
|------|------|
| `query.ts` / `QueryEngine.ts` | 核心循環，需完整集成環境 |
| `services/api/claude.ts` | 需 mock SDK 流式響應 |
| `spawnMultiAgent.ts` | 50+ 依賴 |
| `modelCost.ts` | 依賴 bootstrap/state + analytics |
| `mcp/dateTimeParser.ts` | 呼叫 Haiku API |
| `screens/` / `components/` | 需 Ink 渲染測試 |
