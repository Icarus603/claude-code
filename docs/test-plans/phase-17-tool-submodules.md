# Phase 17 — Tool 子模組純邏輯測試

> 建立日期：2026-04-02
> 預計：+150 tests / 11 files
> 目標：覆蓋 Tool 目錄下有豐富純邏輯但零測試的子模組

---

## 17.1 `src/tools/PowerShellTool/__tests__/powershellSecurity.test.ts`（~25 tests）

**目標模組**: `src/tools/PowerShellTool/powershellSecurity.ts`（1091 行）

**安全關鍵** — 檢測 ~20 種攻擊向量。

| 測試分組 | 測試數 | 驗證點 |
|---------|-------|--------|
| Invoke-Expression 檢測 | 3 | `IEX`, `Invoke-Expression`, 變形 |
| Download cradle 檢測 | 3 | `Net.WebClient`, `Invoke-WebRequest`, pipe |
| Privilege escalation | 3 | `Start-Process -Verb RunAs`, `runas.exe` |
| COM object | 2 | `New-Object -ComObject`, WScript.Shell |
| Scheduled tasks | 2 | `schtasks`, `Register-ScheduledTask` |
| WMI | 2 | `Invoke-WmiMethod`, `Get-WmiObject` |
| Module loading | 2 | `Import-Module` 從網絡路徑 |
| 安全命令通過 | 3 | `Get-Process`, `Get-ChildItem`, `Write-Host` |
| 混淆繞過嘗試 | 3 | base64, 字符串拼接, 空格變形 |
| 組合命令 | 2 | `;` 分隔的多命令 |

**Mock**: 構造 `ParsedPowerShellCommand` 對象（不需要真實 AST）

---

## 17.2 `src/tools/PowerShellTool/__tests__/commandSemantics.test.ts`（~10 tests）

**目標模組**: `src/tools/PowerShellTool/commandSemantics.ts`（143 行）

| 測試用例 | 驗證點 |
|---------|--------|
| grep exit 0/1/2 | 語義映射 |
| robocopy exit codes | Windows 特殊退出碼 |
| findstr exit codes | Windows find 工具 |
| unknown command | 預設語義 |
| extractBaseCommand — basic | `grep "pattern" file` → `grep` |
| extractBaseCommand — path | `C:\tools\rg.exe` → `rg` |
| heuristicallyExtractBaseCommand | 模糊匹配 |

---

## 17.3 `src/tools/PowerShellTool/__tests__/destructiveCommandWarning.test.ts`（~15 tests）

**目標模組**: `src/tools/PowerShellTool/destructiveCommandWarning.ts`（110 行）

| 測試用例 | 驗證點 |
|---------|--------|
| Remove-Item -Recurse -Force | 危險 |
| Format-Volume | 危險 |
| git reset --hard | 危險 |
| DROP TABLE | 危險 |
| Remove-Item (no -Force) | 安全 |
| Get-ChildItem | 安全 |
| 管道組合 | `rm -rf` + pipe |
| 大小寫混合 | `ReMoVe-ItEm` |

---

## 17.4 `src/tools/PowerShellTool/__tests__/gitSafety.test.ts`（~12 tests）

**目標模組**: `src/tools/PowerShellTool/gitSafety.ts`（177 行）

| 測試用例 | 驗證點 |
|---------|--------|
| normalizeGitPathArg — forward slash | 規範化 |
| normalizeGitPathArg — backslash | Windows 路徑規範化 |
| normalizeGitPathArg — NTFS short name | `GITFI~1` → `.git` |
| isGitInternalPathPS — .git/config | true |
| isGitInternalPathPS — normal file | false |
| isDotGitPathPS — hidden git dir | true |
| isDotGitPathPS — .gitignore | false |
| bare repo attack | `.git` 路徑遍歷 |

---

## 17.5 `src/tools/LSPTool/__tests__/formatters.test.ts`（~20 tests）

**目標模組**: `src/tools/LSPTool/formatters.ts`（593 行）

| 測試用例 | 驗證點 |
|---------|--------|
| formatGoToDefinitionResult — single | 單個定義 |
| formatGoToDefinitionResult — multiple | 多個定義（分組） |
| formatFindReferencesResult | 引用列表 |
| formatHoverResult — markdown | markdown 內容 |
| formatHoverResult — plaintext | 純文本 |
| formatDocumentSymbolResult — classes | 類符號 |
| formatDocumentSymbolResult — functions | 函數符號 |
| formatDocumentSymbolResult — nested | 嵌套符號 |
| formatWorkspaceSymbolResult | 工作區符號 |
| formatPrepareCallHierarchyResult | 呼叫層次 |
| formatIncomingCallsResult | 入呼叫 |
| formatOutgoingCallsResult | 出呼叫 |
| empty results | 各函數空結果 |
| groupByFile helper | 文件分組邏輯 |

---

## 17.6 `src/tools/GrepTool/__tests__/utils.test.ts`（~10 tests）

**目標模組**: `src/tools/GrepTool/GrepTool.ts`（577 行）

| 測試用例 | 驗證點 |
|---------|--------|
| applyHeadLimit — within limit | 不截斷 |
| applyHeadLimit — exceeds limit | 正確截斷 |
| applyHeadLimit — offset + limit | 分頁邏輯 |
| applyHeadLimit — zero limit | 邊界 |
| formatLimitInfo — basic | 格式化輸出 |

**Mock**: `mock.module("src/utils/log.ts", ...)` 解鎖導入

---

## 17.7 `src/tools/WebFetchTool/__tests__/utils.test.ts`（~15 tests）

**目標模組**: `src/tools/WebFetchTool/utils.ts`（531 行）

| 測試用例 | 驗證點 |
|---------|--------|
| validateURL — valid http | 通過 |
| validateURL — valid https | 通過 |
| validateURL — ftp | 拒絕 |
| validateURL — no protocol | 拒絕 |
| validateURL — localhost | 處理 |
| isPermittedRedirect — same host | 允許 |
| isPermittedRedirect — different host | 拒絕 |
| isPermittedRedirect — subdomain | 處理 |
| isRedirectInfo — valid object | true |
| isRedirectInfo — invalid | false |

---

## 17.8 `src/tools/WebFetchTool/__tests__/preapproved.test.ts`（~10 tests）

**目標模組**: `src/tools/WebFetchTool/preapproved.ts`（167 行）

| 測試用例 | 驗證點 |
|---------|--------|
| exact hostname match | 通過 |
| subdomain match | 處理 |
| path prefix match | `/docs/api` 匹配 |
| path non-match | `/internal` 不匹配 |
| unknown hostname | false |
| empty pathname | 邊界 |

---

## 17.9 `src/tools/FileReadTool/__tests__/utils.test.ts`（~15 tests）

**目標模組**: `src/tools/FileReadTool/FileReadTool.ts`（1184 行）

| 測試用例 | 驗證點 |
|---------|--------|
| isBlockedDevicePath — /dev/sda | true |
| isBlockedDevicePath — /dev/null | 處理 |
| isBlockedDevicePath — normal file | false |
| detectSessionFileType — .jsonl | 會話文件類型 |
| detectSessionFileType — unknown | 未知類型 |
| formatFileLines — basic | 行號格式 |
| formatFileLines — empty | 空文件 |

---

## 17.10 `src/tools/AgentTool/__tests__/agentToolUtils.test.ts`（~18 tests）

**目標模組**: `src/tools/AgentTool/agentToolUtils.ts`（688 行）

| 測試用例 | 驗證點 |
|---------|--------|
| filterToolsForAgent — builtin only | 只返回內置工具 |
| filterToolsForAgent — exclude async | 排除異步工具 |
| filterToolsForAgent — permission mode | 權限過濾 |
| resolveAgentTools — wildcard | 通配符展開 |
| resolveAgentTools — explicit list | 顯式列表 |
| countToolUses — multiple | 訊息中工具呼叫計數 |
| countToolUses — zero | 無工具呼叫 |
| extractPartialResult — text only | 提取文本 |
| extractPartialResult — mixed | 混合內容 |
| getLastToolUseName — basic | 最後工具名 |
| getLastToolUseName — no tool use | 無工具呼叫 |

**Mock**: `mock.module("src/bootstrap/state.ts", ...)`, `mock.module("src/utils/log.ts", ...)`

---

## 17.11 `src/tools/LSPTool/__tests__/schemas.test.ts`（~5 tests）

**目標模組**: `src/tools/LSPTool/schemas.ts`（216 行）

| 測試用例 | 驗證點 |
|---------|--------|
| isValidLSPOperation — goToDefinition | true |
| isValidLSPOperation — findReferences | true |
| isValidLSPOperation — hover | true |
| isValidLSPOperation — invalid | false |
| isValidLSPOperation — empty string | false |
