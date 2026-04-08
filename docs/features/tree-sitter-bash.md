# TREE_SITTER_BASH — Bash AST 解析

> Feature Flag: `FEATURE_TREE_SITTER_BASH=1`
> 實現狀態：完整可用（純 TypeScript 實現，~7000+ 行）
> 引用數：3

## 一、功能概述

TREE_SITTER_BASH 啓用一個完整的 Bash AST 解析器，用於安全驗證 Bash 命令。它用完整的樹遍歷安全分析器取代了舊的基於正則表達式的 shell-quote 解析器。關鍵屬性是 **fail-closed**：任何無法識別的內容都被歸類爲 `too-complex` 並需要用戶批准。

### 關聯 Feature

| Feature | 說明 |
|---------|------|
| `TREE_SITTER_BASH` | 激活用於權限檢查的 AST 解析器 |
| `TREE_SITTER_BASH_SHADOW` | Shadow/觀測模式：執行解析器但丟棄結果，僅記錄遙測 |

## 二、安全架構

### 2.1 Fail-Closed 設計

核心設計使用 **allowlist** 遍歷模式：

- `walkArgument()` 只處理已知安全的節點類型（`word`、`number`、`raw_string`、`string`、`concatenation`、`arithmetic_expansion`、`simple_expansion`）
- 任何未知節點類型 → `tooComplex()` → 需要用戶批准
- 解析器加載但失敗（超時/節點預算/panic）→ 返回 `PARSE_ABORTED` 符號（區別於"模組未加載"）

### 2.2 解析結果

```ts
parseForSecurity(cmd) 返回：
  { kind: 'simple', commands: SimpleCommand[] }     // 可靜態分析
  { kind: 'too-complex', reason, nodeType }          // 需要用戶批准
  { kind: 'parse-unavailable' }                      // 解析器未加載
```

### 2.3 安全檢查層次

```
parseForSecurity(cmd)
      │
      ▼
parseCommandRaw(cmd) → AST root node
      │
      ▼
預檢查：控制字符、Unicode 空白、反斜槓+空白、
        zsh ~[ ] 語法、zsh =cmd 展開、大括號+引號混淆
      │
      ▼
walkProgram(root) → collectCommands(root, commands, varScope)
      │
      ├── 'command'         → walkCommand()
      ├── 'pipeline'/'list' → 結構性，遞歸子節點
      ├── 'for_statement'   → 跟蹤循環變量爲 VAR_PLACEHOLDER
      ├── 'if/while'        → 作用域隔離的分支
      ├── 'subshell'        → 作用域複製
      ├── 'variable_assignment' → walkVariableAssignment()
      ├── 'declaration_command' → 驗證 declare/export flags
      ├── 'test_command'    → walk test expressions
      └── 其他              → tooComplex()
      │
      ▼
checkSemantics(commands)
  ├── EVAL_LIKE_BUILTINS（eval, source, exec, trap...）
  ├── ZSH_DANGEROUS_BUILTINS（zmodload, emulate...）
  ├── SUBSCRIPT_EVAL_FLAGS（test -v, printf -v, read -a）
  ├── Shell keywords as argv[0]（誤解析檢測）
  ├── /proc/*/environ 訪問
  ├── jq system() 和危險 flags
  └── 包裝器剝離（time, nohup, timeout, nice, env, stdbuf）
```

## 三、實現架構

### 3.1 核心模組

| 模組 | 文件 | 行數 | 職責 |
|------|------|------|------|
| 門控入口 | `src/utils/bash/parser.ts` | ~110 | `parseCommand()`、`parseCommandRaw()`、`ensureInitialized()` |
| Bash 解析器 | `src/utils/bash/bashParser.ts` | 4437 | 純 TS 詞法分析 + 遞歸下降解析器 |
| 安全分析器 | `src/utils/bash/ast.ts` | 2680 | 樹遍歷安全分析 + `parseForSecurity()` |
| AST 分析輔助 | `src/utils/bash/treeSitterAnalysis.ts` | 507 | 引號上下文、複合結構、危險模式提取 |
| 權限檢查入口 | `src/tools/BashTool/bashPermissions.ts` | — | 集成 AST 結果到權限決策 |

### 3.2 Bash 解析器

文件：`src/utils/bash/bashParser.ts`（4437 行）

- 純 TypeScript 實現（無原生依賴）
- 生成與 tree-sitter-bash 相容的 AST
- 關鍵類型：`TsNode`（type、text、startIndex、endIndex、children）
- 安全限制：`PARSE_TIMEOUT_MS = 50`、`MAX_NODES = 50_000` — 防止對抗性輸入導致 OOM

### 3.3 安全分析器

文件：`src/utils/bash/ast.ts`（2680 行）

核心函數：

| 函數 | 職責 |
|------|------|
| `parseForSecurity(cmd)` | 頂層入口，返回 `simple/too-complex/parse-unavailable` |
| `parseForSecurityFromAst(cmd, root)` | 接受預解析 AST |
| `checkSemantics(commands)` | 後解析語義檢查 |
| `walkCommand()` | 提取 argv、envVars、redirects |
| `walkArgument()` | Allowlist 參數遍歷 |
| `collectCommands()` | 遞歸收集所有命令 |

### 3.4 AST 分析輔助

文件：`src/utils/bash/treeSitterAnalysis.ts`（507 行）

| 函數 | 職責 |
|------|------|
| `extractQuoteContext()` | 識別單引號、雙引號、ANSI-C 字符串、heredoc |
| `extractCompoundStructure()` | 檢測管道、子 shell、命令組 |
| `hasActualOperatorNodes()` | 區分真實 `;`/`&&`/`||` 與轉義形式 |
| `extractDangerousPatterns()` | 檢測命令替換、參數展開、heredocs |
| `analyzeCommand()` | 單次遍歷提取 |

### 3.5 Shadow 模式

`TREE_SITTER_BASH_SHADOW` 執行解析器但**從不影響權限決策**：

```ts
// Shadow 模式：記錄遙測，然後強制使用舊版路徑
astResult = { kind: 'parse-unavailable' }
astRoot = null
// 記錄: available, astTooComplex, astSemanticFail, subsDiffer, ...
```

記錄 `tengu_tree_sitter_shadow` 事件，包含與舊版 `splitCommand()` 的對比資料。用於在不影響行爲的情況下收集遙測。

## 四、關鍵設計決策

1. **Allowlist 遍歷**：只處理已知安全的節點類型，未知類型直接 `tooComplex()`
2. **PARSE_ABORTED 符號**：區分"解析器未加載"和"解析器加載但失敗"。後者阻止回退舊版（舊版缺少 `EVAL_LIKE_BUILTINS` 檢查）
3. **變量作用域跟蹤**：`VAR=value && cmd $VAR` 模式。靜態值解析爲真實字符串，`$()` 輸出使用 `VAR_PLACEHOLDER`
4. **PS4/IFS Allowlist**：PS4 賦值使用嚴格字符白名單 `[A-Za-z0-9 _+:.\/=\[\]-]`，只允許 `${VAR}` 引用
5. **包裝器剝離**：從 argv 前面剝離 `time/nohup/timeout/nice/env/stdbuf`，未知標誌 → fail-closed
6. **Shadow 安全性**：Shadow 模式**總是**強制 `astResult = { kind: 'parse-unavailable' }`，絕不影響權限

## 五、使用方式

```bash
# 激活 AST 解析用於權限檢查
FEATURE_TREE_SITTER_BASH=1 bun run dev

# Shadow 模式（僅遙測，不影響行爲）
FEATURE_TREE_SITTER_BASH_SHADOW=1 bun run dev
```

## 六、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/utils/bash/parser.ts` | ~110 | 門控入口點 |
| `src/utils/bash/bashParser.ts` | 4437 | 純 TS bash 解析器 |
| `src/utils/bash/ast.ts` | 2680 | 安全分析器（核心） |
| `src/utils/bash/treeSitterAnalysis.ts` | 507 | AST 分析輔助 |
| `src/tools/BashTool/bashPermissions.ts:1670-1810` | ~140 | 權限集成 + Shadow 遙測 |
