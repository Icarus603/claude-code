# 第一階段 Q&A

## Q1：cli.tsx 的快速路徑分發具體在做什麼？

**核心思想**：根據用戶輸入的命令參數，儘早決定走哪條路，避免加載不需要的程式碼。cli.tsx 充當一個輕量級路由器，把簡單請求就地處理，只有真正需要完整 CLI 時才加載 main.tsx。

### 場景對比

#### 場景 1：`claude --version`（命中快速路徑）

```
cli.tsx main() 開始執行
  ├── args = ["--version"]
  ├── 命中第 64 行: args[0] === "--version" ✅
  ├── console.log("2.1.888 (Claude Code)")
  └── return  ← 立即退出，零 import，~10ms
```

#### 場景 2：`claude --claude-in-chrome-mcp`（命中中間路徑）

```
cli.tsx main() 開始執行
  ├── 第 64 行: --version? ❌
  ├── 第 75 行: 加載 profileCheckpoint（僅此一個 import）
  ├── 第 81 行: feature("DUMP_SYSTEM_PROMPT") → false ❌
  ├── 第 95 行: --claude-in-chrome-mcp? ✅ 命中
  ├── await import("../utils/claudeInChrome/mcpServer.js")  ← 只加載這一個模組
  └── return  ← 沒有加載 main.tsx 的 200+ import
```

#### 場景 3：`claude`（無參數，最常見，全部未命中）

```
cli.tsx main() 開始執行
  ├── --version?           ❌
  ├── profileCheckpoint 加載
  ├── feature(DUMP)?       ❌ (feature=false)
  ├── --chrome-mcp?        ❌
  ├── --chrome-native?     ❌
  ├── feature(CHICAGO)?    ❌ (feature=false)
  ├── feature(DAEMON)?     ❌ (feature=false)
  ├── feature(BRIDGE)?     ❌ (feature=false)
  ├── ... 所有快速路徑逐一檢查，全部未命中
  │
  ├── 走到第 310 行 ← 最終出口
  ├── await import("../main.jsx")  ← 加載完整 CLI（200+ import，~135ms）
  └── await cliMain()              ← 進入 main.tsx 重型初始化
```

### 性能對比

| 方式 | `claude --version` 耗時 |
|------|------------------------|
| 無快速路徑（全部走 main.tsx） | ~200ms（加載 200+ import → 初始化 Commander → 解析參數 → 打印） |
| 有快速路徑（cli.tsx 攔截） | ~10ms（讀 args → 打印 → 退出） |

### feature() 的加速作用

大量快速路徑被 `feature()` 守護：

```ts
if (feature("DAEMON") && args[0] === "daemon") { ... }
```

`feature()` 返回 false → `&&` 短路求值 → 連 `args[0]` 都不檢查，直接跳過。在反編譯版本中這些路徑等於不存在，進一步加速了"全部沒命中 → 走預設路徑"的過程。

---

## Q2：main.tsx 中不同命令的具體執行流程是怎樣的？

所有命令都會經過 main() → run()，但在 run() 內部根據 Commander 路由到不同分支。

### 場景 1：`claude`（無參數 — 啓動交互 REPL）

最常見的場景，走完整條主命令路徑：

```
main() (第 585 行)
  ├── 信號處理註冊（SIGINT、exit）
  ├── feature flag 路徑全部跳過
  ├── isNonInteractive = false（有 TTY，沒有 -p）
  ├── clientType = 'cli'
  └── await run()
       │
       ▼
  run() (第 884 行)
  ├── Commander 初始化 + preAction 鉤子 + 主命令選項註冊
  ├── isPrintMode = false → 註冊所有子命令
  └── program.parseAsync(process.argv)
       │  Commander 匹配到主命令，先執行 preAction
       ▼
  preAction (第 907 行)
  ├── await ensureMdmSettingsLoaded()        ← 等 side-effect import 的子進程完成
  ├── await ensureKeychainPrefetchCompleted() ← 等 keychain 預讀完成
  ├── await init()                            ← 遙測、設定、信任
  ├── initSinks()                             ← 分析日誌
  ├── runMigrations()                         ← 資料遷移
  └── loadRemoteManagedSettings() / loadPolicyLimits() ← 非阻塞
       │  然後執行 action handler
       ▼
  action(undefined, options) (第 1007 行)     ← prompt = undefined
  ├── [參數解析] permissionMode, model, thinkingConfig...
  ├── [工具加載] tools = getTools(toolPermissionContext)
  ├── [並行初始化]
  │   ├── setup()        ← worktree、CWD
  │   ├── getCommands()  ← 加載斜槓命令
  │   └── getAgentDefinitionsWithOverrides() ← 加載 agent 定義
  ├── [MCP 連接] 連接設定的 MCP 服務器
  ├── [構建初始狀態] initialState = { tools, mcp, permissions, ... }
  │
  ├── [UI 初始化]（交互模式專屬）
  │   ├── createRoot()          ← 建立 Ink 渲染根節點
  │   └── showSetupScreens()    ← 信任對話框 / OAuth / 引導
  │
  ├── [後續初始化] LSP、插件版本、session 註冊
  │
  └── 預設分支 (第 3760 行) ← 沒有 --continue/--resume/--print
      └── await launchRepl(root, {
              initialState
          }, {
              ...sessionConfig,
              initialMessages: undefined  ← 全新對話，無歷史訊息
          }, renderAndRun)
            │
            ▼
          REPL.tsx 渲染，用戶看到空白對話界面
```

### 場景 2：`echo "explain this" | claude -p`（管道/非交互模式）

```
main() →
  ├── isNonInteractive = true（-p 標誌 + stdin 不是 TTY）
  ├── clientType = 'sdk-cli'
  └── run()
       │
       ▼
  run()
  ├── Commander 初始化 + preAction + 主命令選項
  ├── isPrintMode = true
  │   → ★ 跳過所有子命令註冊（節省 ~65ms）
  └── program.parseAsync()  ← 直接解析，Commander 路由到主命令 action
       │
       ▼
  preAction → init、遷移等（同場景 1）
       │
       ▼
  action("", { print: true, ... })
  ├── inputPrompt = await getInputPrompt("")
  │   ├── stdin.isTTY = false → 從 stdin 讀資料
  │   ├── 等待最多 3s 讀入: "explain this"
  │   └── 返回 "explain this"
  ├── tools = getTools()
  ├── setup() + getCommands()（並行）
  │
  ├── isNonInteractiveSession = true → 走 --print 分支（第 2584 行）
  │   ├── applyConfigEnvironmentVariables() ← -p 模式信任隱含
  │   ├── 構建 headlessInitialState（無 UI）
  │   ├── headlessStore = createStore(headlessInitialState)
  │   │
  │   ├── await import('src/cli/print.js')
  │   └── runHeadless(inputPrompt, ...)  ★ 不走 REPL
  │       ├── 發送 API 請求
  │       ├── 流式輸出到 stdout
  │       └── 完成後 process.exit()
  │
  └── ← 不走 createRoot()、showSetupScreens()、launchRepl()
```

**關鍵差異**：
- 檢測到 `-p` 後跳過子命令註冊（節省 ~65ms）
- 不建立 Ink UI，不呼叫 `showSetupScreens()`
- 從 stdin 讀取輸入（`getInputPrompt` 第 857 行）
- 走 `print.js` 路徑直接執行查詢輸出到 stdout

### 場景 3：`claude -c`（繼續最近對話）

```
... main() → run() → preAction → action（前半部分同場景 1）
       │
       ▼
  action(undefined, { continue: true, ... })
  ├── [參數解析 + 工具加載 + 並行初始化 + UI 初始化]（同場景 1）
  │
  ├── options.continue = true → 命中第 3101 行
  │   ├── clearSessionCaches()       ← 清除過期快取
  │   ├── result = await loadConversationForResume()
  │   │   └── 從 ~/.claude/projects/<cwd>/ 讀最近的會話 JSONL
  │   │
  │   ├── result 爲 null? → exitWithError("No conversation found")
  │   │
  │   ├── loaded = await processResumedConversation(result)
  │   │   ├── 解析 JSONL → messages[]
  │   │   ├── 恢復檔案歷史快照
  │   │   └── 重建 initialState
  │   │
  │   └── await launchRepl(root, {
  │           initialState: loaded.initialState
  │       }, {
  │           ...sessionConfig,
  │           initialMessages: loaded.messages,            ★ 帶上歷史訊息
  │           initialFileHistorySnapshots: loaded.fileHistorySnapshots,
  │           initialAgentName: loaded.agentName
  │       }, renderAndRun)
  │         │
  │         ▼
  │       REPL.tsx 渲染，顯示歷史對話，用戶繼續聊天
  │
  └── ← 其他分支不執行
```

**關鍵差異**：`initialMessages` 有值（歷史訊息），REPL 啓動時會渲染之前的對話內容。

### 場景 4：`claude mcp list`（子命令）

```
main() → run()
       │
       ▼
  run()
  ├── Commander 初始化 + preAction 鉤子
  ├── 註冊主命令 .action(...)
  ├── isPrintMode = false → 註冊所有子命令
  │   ├── program.command('mcp') (第 3894 行)
  │   │   ├── mcp.command('serve').action(...)
  │   │   ├── mcp.command('add').action(...)
  │   │   ├── mcp.command('list').action(async () => {  ★
  │   │   │       const { mcpListHandler } = await import('./cli/handlers/mcp.js');
  │   │   │       await mcpListHandler();
  │   │   │   })
  │   │   └── ...
  │   ├── program.command('auth')
  │   ├── program.command('doctor')
  │   └── ...
  │
  └── program.parseAsync(["node", "claude", "mcp", "list"])
       │  Commander 匹配到 mcp → list
       ▼
  preAction (第 907 行)     ← 子命令也觸發 preAction
  ├── await init()
  ├── initSinks()
  ├── runMigrations()
  └── ...
       │
       ▼  執行子命令自己的 action（不走主命令 action）
  mcp list action
  ├── await import('./cli/handlers/mcp.js')
  └── await mcpListHandler()
      ├── 讀取 MCP 設定（user/project/local 三級）
      ├── 連接每個服務器做健康檢查
      ├── 格式化輸出到終端
      └── 退出

  ← 主命令的 action handler 完全不執行
  ← 沒有 REPL、沒有 Ink UI、沒有 showSetupScreens
```

**關鍵差異**：
- Commander 路由到子命令，**主命令 action 完全跳過**
- `preAction` 仍然執行（基礎初始化所有命令都需要）
- 子命令有自己獨立的輕量 action

### 四種場景對比

| | `claude` | `claude -p` | `claude -c` | `claude mcp list` |
|---|---------|------------|------------|-------------------|
| preAction | 執行 | 執行 | 執行 | 執行 |
| 主命令 action | 執行 | 執行 | 執行 | **跳過** |
| 子命令註冊 | 註冊 | **跳過** | 註冊 | 註冊 |
| showSetupScreens | 執行 | **跳過** | 執行 | **跳過** |
| createRoot (Ink) | 執行 | **跳過** | 執行 | **跳過** |
| 加載歷史訊息 | 否 | 否 | **是** | 否 |
| 最終出口 | launchRepl | print.js | launchRepl | 子命令 action |