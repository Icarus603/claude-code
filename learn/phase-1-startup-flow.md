# 第一階段：啓動流程詳解

> 從 `bun run dev` 到用戶看到交互界面的完整路徑

## 啓動鏈路總覽

```
bun run dev
  → package.json scripts.dev: "bun run src/entrypoints/cli.tsx"
    → cli.tsx: polyfill 注入 + 快速路徑檢查
      → import("../main.jsx") → cliMain()
        → main.tsx: main() → run()
          → Commander 參數解析 → preAction 鉤子
            → action handler: 服務初始化 → showSetupScreens
              → launchRepl()
                → replLauncher.tsx: <App><REPL /></App>
                  → REPL.tsx: 渲染交互界面，等待用戶輸入
```

---

## 1. cli.tsx（321 行）— 入口與快速路徑分發

**檔案路徑**: `src/entrypoints/cli.tsx`

### 1.1 全局 Polyfill（第 1-53 行）

模組加載時立即執行的 side-effect，在 `main()` 之前執行。

#### feature() 樁函數（第 3 行）

```ts
const feature = (_name: string) => false;
```

原版 Claude Code 構建時，Bun bundler 通過 `bun:bundle` 提供 `feature()` 函數，用於**編譯時 feature flag**（類似 C 的 `#ifdef`）。反編譯版沒有構建流程，所以直接定義爲永遠返回 `false`。

**效果**：所有 Anthropic 內部功能分支全部禁用，包括：
- `COORDINATOR_MODE` — 協調器模式
- `KAIROS` — 助手模式
- `DAEMON` — 後臺守護進程
- `BRIDGE_MODE` — 遠程控制
- `SSH_REMOTE` — SSH 遠程
- `BG_SESSIONS` — 後臺會話
- ... 等 20+ 個 flag

#### MACRO 全局對象（第 4-14 行）

```ts
globalThis.MACRO = {
    VERSION: "2.1.888",
    BUILD_TIME: new Date().toISOString(),
    FEEDBACK_CHANNEL: "",
    ISSUES_EXPLAINER: "",
    NATIVE_PACKAGE_URL: "",
    PACKAGE_URL: "",
    VERSION_CHANGELOG: "",
};
```

原版構建時 Bun 會把這些值內聯到程式碼裏。這裏模擬注入，讓後續程式碼讀 `MACRO.VERSION` 時能拿到值。

#### 構建常量（第 16-18 行）

```ts
BUILD_TARGET = "external";   // 標記爲"外部"構建（非 Anthropic 內部）
BUILD_ENV = "production";    // 生產環境
INTERFACE_TYPE = "stdio";    // 標準輸入輸出模式
```

這三個全局變量在程式碼各處被讀取，用來區分執行環境。`"external"` 意味着很多 `("external" as string) === 'ant'` 的檢查會返回 false。

#### 環境修補（第 22-33 行）

- 禁用 corepack 自動 pin（防止污染 package.json）
- 遠程模式下設置 Node.js 堆內存上限 8GB

#### ABLATION_BASELINE（第 40-53 行）

```ts
if (feature("ABLATION_BASELINE") && ...) { ... }
```

`feature()` 返回 false，**永遠不執行**。Anthropic 內部 A/B 測試程式碼。

### 1.2 main() 函數（第 60-317 行）

設計模式：**分層快速路徑（fast path cascading）**——按開銷從低到高逐級檢查，命中即返回。

#### 快速路徑列表

| 優先級 | 行號 | 檢查條件 | 功能 | 開銷 | 可執行 |
|--------|------|---------|------|------|--------|
| 1 | 64-72 | `--version` / `-v` | 打印版本號退出 | **零 import** | 是 |
| 2 | 81-94 | `feature("DUMP_SYSTEM_PROMPT")` | 導出系統提示 | - | 否（flag） |
| 3 | 95-99 | `--claude-in-chrome-mcp` | Chrome MCP 服務 | 動態 import | 是 |
| 4 | 101-105 | `--chrome-native-host` | Chrome Native Host | 動態 import | 是 |
| 5 | 108-116 | `feature("CHICAGO_MCP")` | Computer Use MCP | - | 否（flag） |
| 6 | 123-127 | `feature("DAEMON")` | Daemon Worker | - | 否（flag） |
| 7 | 133-178 | `feature("BRIDGE_MODE")` | 遠程控制 | - | 否（flag） |
| 8 | 181-190 | `feature("DAEMON")` | Daemon 主進程 | - | 否（flag） |
| 9 | 195-225 | `feature("BG_SESSIONS")` | ps/logs/attach/kill | - | 否（flag） |
| 10 | 228-240 | `feature("TEMPLATES")` | 模板任務 | - | 否（flag） |
| 11 | 244-253 | `feature("BYOC_ENVIRONMENT_RUNNER")` | BYOC 執行器 | - | 否（flag） |
| 12 | 258-264 | `feature("SELF_HOSTED_RUNNER")` | 自託管執行器 | - | 否（flag） |
| 13 | 267-293 | `--tmux` + `--worktree` | tmux worktree | 動態 import | 是 |

#### 參數修正（第 296-307 行）

```ts
// --update/--upgrade → 重寫爲 update 子命令
if (args[0] === "--update") process.argv = [..., "update"];
// --bare → 設置簡單模式環境變量
if (args.includes("--bare")) process.env.CLAUDE_CODE_SIMPLE = "1";
```

#### 最終出口（第 310-316 行）

```ts
const { startCapturingEarlyInput } = await import("../utils/earlyInput.js");
startCapturingEarlyInput();           // 捕獲用戶提前輸入的內容
const { main: cliMain } = await import("../main.jsx");
await cliMain();                      // 進入 main.tsx 重型初始化
```

所有快速路徑都沒命中時（99% 的情況），才走到這裏。

### 1.3 啓動（第 320 行）

```ts
void main();
```

`void` 表示不關心 Promise 返回值。

### 1.4 關鍵設計思想

- **快速路徑**：`--version` 零開銷返回，不加載任何模組
- **動態 import**：`await import()` 替代靜態 import，每條路徑只加載自己需要的模組
- **feature flag 過濾**：`feature()` 返回 false 使大量內部功能成爲死程式碼

---

## 2. main.tsx（4683 行）— 重型初始化與 Commander CLI

**檔案路徑**: `src/main.tsx`

整個專案最大的單檔，但結構清晰：**輔助函數 → main() → run()**。

### 2.1 Import 區（第 1-215 行）

200+ 行 import，加載幾乎所有子系統。關鍵的是前三個 **side-effect import**（import 即執行）：

```ts
// 第 9 行：記錄時間戳
profileCheckpoint('main_tsx_entry');

// 第 16 行：啓動 MDM 子進程讀取（macOS plutil）
startMdmRawRead();

// 第 20 行：啓動 keychain 預讀取（OAuth token、API key）
startKeychainPrefetch();
```

這三個在 import 階段就**並行啓動子進程**，和後續 ~135ms 的模組加載同時進行——**用並行隱藏延遲**。

### 2.2 輔助函數（第 216-584 行）

| 函數 | 行號 | 作用 |
|------|------|------|
| `logManagedSettings()` | 216 | 記錄企業託管設置到分析日誌 |
| `isBeingDebugged()` | 232 | 檢測調試模式，**外部構建下直接 exit(1)**（第 266 行） |
| `logSessionTelemetry()` | 279 | Session 遙測（技能、插件） |
| `getCertEnvVarTelemetry()` | 291 | SSL 證書環境變量收集 |
| `runMigrations()` | 326 | 資料遷移（模型重命名、設置格式升級等） |
| `prefetchSystemContextIfSafe()` | 360 | 信任關係建立後安全預取系統上下文 |
| `startDeferredPrefetches()` | 388 | REPL 首次渲染後的延遲預取 |
| `eagerLoadSettings()` | 502 | 在 init() 之前提前加載 `--settings` 參數 |
| `initializeEntrypoint()` | 517 | 根據執行模式設置 `CLAUDE_CODE_ENTRYPOINT` |

還有 `_pendingConnect`、`_pendingSSH`、`_pendingAssistantChat` 三個狀態變量（第 542-583 行），用於暫存子命令參數。

### 2.3 main() 函數（第 585-856 行）

`main()` 本身不長，做完環境檢測後呼叫 `run()`：

```
main()
├── 安全設置（NoDefaultCurrentDirectoryInExePath）
├── 信號處理（SIGINT → exit, exit → 恢復光標）
├── feature flag 保護的特殊路徑（全部跳過）
├── 檢測 -p/--print / --init-only → 判斷是否交互模式
├── clientType 判斷（cli / sdk-typescript / remote / github-action 等）
├── eagerLoadSettings()
└── await run()  ← 進入真正的邏輯
```

### 2.4 run() 函數（第 884-4683 行）

佔 3800 行，是整個文件的核心。

#### Commander 初始化 + preAction 鉤子（第 884-967 行）

```ts
const program = new CommanderCommand()
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions();
```

**preAction 鉤子**（所有命令執行前都會執行）：

```
preAction
├── await ensureMdmSettingsLoaded()         ← 等 MDM 子進程完成
├── await ensureKeychainPrefetchCompleted() ← 等 keychain 預讀完成
├── await init()                             ← 一次性初始化
├── initSinks()                              ← 分析日誌接收器
├── runMigrations()                          ← 資料遷移
├── loadRemoteManagedSettings()              ← 企業遠程設置（非阻塞）
└── loadPolicyLimits()                       ← 策略限制（非阻塞）
```

#### 主命令 Option 定義（第 968-1006 行）

定義了 40+ CLI 參數，關鍵的包括：

| 參數 | 作用 |
|------|------|
| `-p, --print` | 非交互模式，輸出後退出 |
| `--model <model>` | 指定模型（如 sonnet、opus） |
| `--permission-mode <mode>` | 權限模式 |
| `-c, --continue` | 繼續最近對話 |
| `-r, --resume` | 恢復指定對話 |
| `--mcp-config` | MCP 服務器設定文件 |
| `--allowedTools` | 允許的工具列表 |
| `--system-prompt` | 自定義系統提示 |
| `--dangerously-skip-permissions` | 跳過所有權限檢查 |
| `--output-format` | 輸出格式（text/json/stream-json） |
| `--effort <level>` | 推理努力級別（low/medium/high/max） |
| `--bare` | 最小模式 |

#### action 處理器（第 1006-3808 行）

主命令的執行邏輯，內部按階段和場景分支：

```
action(async (prompt, options) => {
    │
    ├── [1007-1600] 參數解析與預處理
    │   ├── --bare 模式
    │   ├── 解析 model / permission-mode / thinking / effort
    │   ├── 解析 MCP 設定、工具列表、系統提示
    │   └── 初始化工具權限上下文
    │
    ├── [1600-2220] 服務初始化
    │   ├── MCP 客戶端連接
    │   ├── 擴充功能加載 + 技能初始化
    │   ├── 工具列表組裝
    │   └── 初始 AppState 構建
    │
    ├── [2220-2315] UI 初始化（交互模式）
    │   ├── createRoot() — 建立 Ink 渲染根節點
    │   ├── showSetupScreens() — 信任對話框、OAuth 登錄、引導
    │   └── 登錄後刷新各種服務
    │
    ├── [2315-2582] 後續初始化
    │   ├── LSP 管理器、擴充功能版本管理
    │   ├── session 註冊、遙測日誌
    │   └── 遙測上報
    │
    ├── [2584-3050] --print 非交互模式分支
    │   ├── 構建 headless AppState + store
    │   └── 交給 print.ts 執行
    │
    └── [3050-3808] 交互模式：啓動 REPL（7 個分支）
        ├── --continue      → 加載最近對話 → launchRepl()
        ├── DIRECT_CONNECT  → ❌ flag 關閉
        ├── SSH_REMOTE      → ❌ flag 關閉
        ├── KAIROS assistant → ❌ flag 關閉
        ├── --resume <id>   → 恢復指定對話 → launchRepl()
        ├── --resume 無 ID  → 顯示對話選擇器
        └── 預設（無參數）  → launchRepl()  ★最常走的路徑
})
```

#### 子命令註冊（第 3808-4683 行）

| 子命令 | 行號 | 作用 |
|--------|------|------|
| `claude mcp` | 3892 | MCP 服務器管理（serve/add/remove/list/get） |
| `claude server` | 3960 | Session 服務器（❌ flag 關閉） |
| `claude auth` | 4098 | 認證管理（login/logout/status/token） |
| `claude plugin` | 4148 | 擴充功能管理（install/uninstall/list/update） |
| `claude setup-token` | 4267 | 設置長期認證 token |
| `claude agents` | 4278 | 列出已設定的 agents |
| `claude doctor` | 4346 | 健康檢查 |
| `claude update` | 4362 | 檢查更新 |
| `claude install` | 4394 | 安裝原生構建 |
| `claude log` | 4411 | 查看對話日誌（內部） |
| `claude completion` | 4491 | Shell 自動補全 |

最後執行解析：

```ts
await program.parseAsync(process.argv);
```

### 2.5 main.tsx 學習建議

- **不要通讀**。記住三段結構：輔助函數 → main() → run()
- `feature()` 返回 false 的分支全部跳過，可忽略 50%+ 程式碼
- `("external" as string) === 'ant'` 的分支也跳過（內部構建專用）
- 需要深入某功能時，通過搜索定位對應程式碼段

---

## 3. replLauncher.tsx（22 行）— 膠水層

**檔案路徑**: `src/replLauncher.tsx`

極其簡單，就做一件事：

```tsx
export async function launchRepl(root, appProps, replProps, renderAndRun) {
  const { App } = await import('./components/App.js');
  const { REPL } = await import('./screens/REPL.js');
  await renderAndRun(root, <App {...appProps}><REPL {...replProps} /></App>);
}
```

- `App` — 全局 Provider（AppState、Stats、FpsMetrics）
- `REPL` — 交互界面組件
- `renderAndRun` — 把 React 元素渲染到 Ink 終端

動態 import 保持了按需加載的策略。

---

## 4. REPL.tsx（5009 行）— 交互界面

**檔案路徑**: `src/screens/REPL.tsx`

專案第二大文件，是用戶直接交互的界面。一個巨型 React 函數組件。

### 4.1 文件結構

```
REPL.tsx (5009 行)
├── [1-310]     Import 區（150+ import）
├── [312-525]   輔助組件
│   ├── median()               — 數學工具函數
│   ├── TranscriptModeFooter   — 轉錄模式底欄
│   ├── TranscriptSearchBar    — 轉錄搜索欄
│   └── AnimatedTerminalTitle  — 終端標題動畫
├── [527-571]   Props 類型定義
└── [573-5009]  REPL() 組件主體
    ├── [600-900]   狀態聲明（50+ 個 useState/useRef/useAppState）
    ├── [900-2750]  副作用與回調（useEffect/useCallback）
    ├── [2750-2860] onQueryImpl — 核心：執行 API 查詢
    ├── [2860-3030] onQuery — 查詢守衛與併發控制
    ├── [3030-3145] 查詢相關輔助回調
    ├── [3146-3550] onSubmit — 用戶提交處理
    ├── [3550-4395] 更多副作用與狀態管理
    └── [4396-5009] JSX 渲染
```

### 4.2 Props

從 main.tsx 通過 launchRepl() 傳入：

| Prop | 類型 | 含義 |
|------|------|------|
| `commands` | `Command[]` | 可用的斜槓命令 |
| `debug` | `boolean` | 調試模式 |
| `initialTools` | `Tool[]` | 初始工具集 |
| `initialMessages` | `MessageType[]` | 初始訊息（恢復對話時有值） |
| `pendingHookMessages` | `Promise<...>` | 延遲加載的 hook 訊息 |
| `mcpClients` | `MCPServerConnection[]` | MCP 服務器連接 |
| `systemPrompt` | `string` | 自定義系統提示 |
| `appendSystemPrompt` | `string` | 追加系統提示 |
| `onBeforeQuery` | `fn` | 查詢前回調，返回 false 可阻止查詢 |
| `onTurnComplete` | `fn` | 輪次完成回調 |
| `mainThreadAgentDefinition` | `AgentDefinition` | 主執行緒 Agent 定義 |
| `thinkingConfig` | `ThinkingConfig` | 思考模式設定 |
| `disabled` | `boolean` | 禁用輸入 |

### 4.3 狀態管理

分三層：

**全局 AppState（通過 useAppState 選擇器讀取）：**

```ts
const toolPermissionContext = useAppState(s => s.toolPermissionContext);
const verbose = useAppState(s => s.verbose);
const mcp = useAppState(s => s.mcp);
const plugins = useAppState(s => s.plugins);
const agentDefinitions = useAppState(s => s.agentDefinitions);
```

**本地狀態（useState）：**

```ts
const [messages, setMessages] = useState(initialMessages ?? []);
const [inputValue, setInputValue] = useState('');
const [screen, setScreen] = useState<Screen>('prompt');
const [streamingText, setStreamingText] = useState(null);
const [streamingToolUses, setStreamingToolUses] = useState([]);
// ... 50+ 個狀態
```

**關鍵 Ref：**

```ts
const queryGuard = useRef(new QueryGuard()).current;  // 查詢併發控制
const messagesRef = useRef(messages);                  // 訊息的同步引用（避免閉包問題）
const abortController = ...;                           // 取消請求控制器
const responseLengthRef = useRef(0);                   // 響應長度追蹤
```

### 4.4 核心資料流：用戶輸入 → API 呼叫

```
用戶按回車
    │
    ▼
onSubmit (第 3146 行)
    ├── 斜槓命令？→ immediate command 直接執行 或 handlePromptSubmit 路由
    ├── 空輸入？→ 忽略
    ├── 空閒檢測 → 可能彈出"是否開始新對話"對話框
    ├── 加入歷史記錄
    │
    ▼
handlePromptSubmit (外部函數，src/utils/handlePromptSubmit.ts)
    ├── 斜槓命令 → 路由到對應 Command handler
    ├── 普通文本 → 構建 UserMessage，呼叫 onQuery()
    │
    ▼
onQuery (第 2860 行) — 併發守衛層
    ├── queryGuard.tryStart() → 已有查詢？排隊等待
    ├── setMessages([...old, ...newMessages]) — 追加用戶訊息
    ├── onQueryImpl()
    │
    ▼
onQueryImpl (第 2750 行) — 真正執行 API 呼叫
    │
    ├── 1. 並行加載上下文:
    │   await Promise.all([
    │       getSystemPrompt(),      // 構建系統提示
    │       getUserContext(),        // 用戶上下文
    │       getSystemContext(),      // 系統上下文（git、平臺等）
    │   ])
    │
    ├── 2. buildEffectiveSystemPrompt() — 合成最終系統提示
    │
    ├── 3. for await (const event of query({...}))  ★核心★
    │   │   呼叫 src/query.ts 的 query() AsyncGenerator
    │   │   流式產出事件
    │   │
    │   └── onQueryEvent(event) — 處理每個流式事件
    │       ├── 更新 streamingText（打字機效果）
    │       ├── 更新 messages（工具呼叫結果）
    │       └── 更新 inProgressToolUseIDs
    │
    └── 4. 收尾：resetLoadingState()、onTurnComplete()
```

**核心程式碼（第 2797-2807 行）**：

```ts
for await (const event of query({
    messages: messagesIncludingNewMessages,
    systemPrompt,
    userContext,
    systemContext,
    canUseTool,
    toolUseContext,
    querySource: getQuerySourceForREPL()
})) {
    onQueryEvent(event);
}
```

`query()` 來自 `src/query.ts`，是第二階段要學的核心函數。

### 4.5 QueryGuard 併發控制

防止同時發起多個 API 請求的狀態機：

```
idle ──tryStart()──▶ running ──end()──▶ idle
                        │
                        └── tryStart() 返回 null（已在執行）
                            → 新訊息排入隊列
```

- `tryStart()` — 原子操作，檢查並轉換 idle→running，返回 generation 號
- `end(generation)` — 檢查 generation 匹配後轉換 running→idle
- 防止 cancel+resubmit 競態條件

### 4.6 JSX 渲染

兩個互斥的渲染分支：

#### Transcript 模式（第 4396-4493 行）

按 `v` 鍵切換，只讀瀏覽對話歷史，支援搜索：

```tsx
<KeybindingSetup>
  <AnimatedTerminalTitle />
  <GlobalKeybindingHandlers />
  <ScrollKeybindingHandler />
  <CancelRequestHandler />
  <FullscreenLayout
    scrollable={<Messages />}
    bottom={<TranscriptSearchBar /> 或 <TranscriptModeFooter />}
  />
</KeybindingSetup>
```

#### Prompt 模式（第 4552-5009 行）

主交互界面，從上到下：

```tsx
<KeybindingSetup>
  <AnimatedTerminalTitle />           // 終端 tab 標題
  <GlobalKeybindingHandlers />        // 全局快捷鍵
  <CommandKeybindingHandlers />       // 命令快捷鍵
  <ScrollKeybindingHandler />         // 滾動快捷鍵
  <CancelRequestHandler />           // Ctrl+C 取消
  <MCPConnectionManager>             // MCP 連接管理
    <FullscreenLayout
      overlay={<PermissionRequest />}  // 權限審批覆蓋層
      scrollable={                     // 可滾動區域
        <>
          <Messages />                 // ★ 對話訊息渲染
          <UserTextMessage />          // 用戶輸入佔位
          {toolJSX}                    // 工具 UI
          <SpinnerWithVerb />          // 加載動畫
        </>
      }
      bottom={                         // 固定底部
        <>
          {/* 各種對話框 */}
          <SandboxPermissionRequest />
          <PromptDialog />
          <ElicitationDialog />
          <CostThresholdDialog />
          <FeedbackSurvey />

          {/* ★ 用戶輸入框 */}
          <PromptInput
            onSubmit={onSubmit}
            commands={commands}
            isLoading={isLoading}
            messages={messages}
            // ... 20+ props
          />
        </>
      }
    />
  </MCPConnectionManager>
</KeybindingSetup>
```

### 4.7 REPL.tsx 學習建議

- 核心只有一條線：`onSubmit → onQuery → query() → onQueryEvent → 更新訊息`
- 其餘 4000+ 行是 UI 細節：快捷鍵、對話框、動畫、邊界情況處理
- `feature('...')` 保護的 JSX 全部跳過
- `("external" as string) === 'ant'` 的分支也跳過

---

## 關鍵設計模式總結

| 模式 | 位置 | 說明 |
|------|------|------|
| 快速路徑 | cli.tsx | 按開銷從低到高逐級檢查，零開銷處理簡單請求 |
| 動態 import | cli.tsx / main.tsx | `await import()` 延遲加載，每條路徑只加載需要的模組 |
| Side-effect import | main.tsx 頂部 | import 階段就並行啓動子進程，用並行隱藏延遲 |
| feature flag | 全局 | `feature()` 永遠返回 false，編譯時消除死程式碼 |
| preAction 鉤子 | main.tsx run() | Commander.js 命令執行前統一初始化 |
| QueryGuard | REPL.tsx | 狀態機防止併發 API 請求，帶 generation 計數防競態 |
| React/Ink | UI 層 | 用 React 組件模型渲染終端 UI，支援全屏和虛擬滾動 |

## 需要忽略的程式碼模式

| 模式 | 來源 | 說明 |
|------|------|------|
| `_c(N)` 呼叫 | React Compiler | 反編譯產生的 memoization 樣板程式碼 |
| `feature('FLAG')` 後面的程式碼 | Bun bundler | 全部是死程式碼，在當前版本不會執行 |
| `("external" as string) === 'ant'` | 構建目標檢查 | 永遠爲 false（external !== ant） |
| tsc 類型錯誤 | 反編譯 | `unknown`/`never`/`{}` 類型，不影響 Bun 執行 |
| `packages/@ant/` | stub 包 | 空實現，僅滿足 import 依賴 |