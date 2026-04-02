# 第一阶段：启动流程详解

> 从 `bun run dev` 到用户看到交互界面的完整路径

## 启动链路总览

```
bun run dev
  → package.json scripts.dev: "bun run src/entrypoints/cli.tsx"
    → cli.tsx: polyfill 注入 + 快速路径检查
      → import("../main.jsx") → cliMain()
        → main.tsx: main() → run()
          → Commander 参数解析 → preAction 钩子
            → action handler: 服务初始化 → showSetupScreens
              → launchRepl()
                → replLauncher.tsx: <App><REPL /></App>
                  → REPL.tsx: 渲染交互界面，等待用户输入
```

---

## 1. cli.tsx（321 行）— 入口与快速路径分发

**文件路径**: `src/entrypoints/cli.tsx`

### 1.1 全局 Polyfill（第 1-53 行）

模块加载时立即执行的 side-effect，在 `main()` 之前运行。

#### feature() 桩函数（第 3 行）

```ts
const feature = (_name: string) => false;
```

原版 Claude Code 构建时，Bun bundler 通过 `bun:bundle` 提供 `feature()` 函数，用于**编译时 feature flag**（类似 C 的 `#ifdef`）。反编译版没有构建流程，所以直接定义为永远返回 `false`。

**效果**：所有 Anthropic 内部功能分支全部禁用，包括：
- `COORDINATOR_MODE` — 协调器模式
- `KAIROS` — 助手模式
- `DAEMON` — 后台守护进程
- `BRIDGE_MODE` — 远程控制
- `SSH_REMOTE` — SSH 远程
- `BG_SESSIONS` — 后台会话
- ... 等 20+ 个 flag

#### MACRO 全局对象（第 4-14 行）

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

原版构建时 Bun 会把这些值内联到代码里。这里模拟注入，让后续代码读 `MACRO.VERSION` 时能拿到值。

#### 构建常量（第 16-18 行）

```ts
BUILD_TARGET = "external";   // 标记为"外部"构建（非 Anthropic 内部）
BUILD_ENV = "production";    // 生产环境
INTERFACE_TYPE = "stdio";    // 标准输入输出模式
```

这三个全局变量在代码各处被读取，用来区分运行环境。`"external"` 意味着很多 `("external" as string) === 'ant'` 的检查会返回 false。

#### 环境修补（第 22-33 行）

- 禁用 corepack 自动 pin（防止污染 package.json）
- 远程模式下设置 Node.js 堆内存上限 8GB

#### ABLATION_BASELINE（第 40-53 行）

```ts
if (feature("ABLATION_BASELINE") && ...) { ... }
```

`feature()` 返回 false，**永远不执行**。Anthropic 内部 A/B 测试代码。

### 1.2 main() 函数（第 60-317 行）

设计模式：**分层快速路径（fast path cascading）**——按开销从低到高逐级检查，命中即返回。

#### 快速路径列表

| 优先级 | 行号 | 检查条件 | 功能 | 开销 | 可执行 |
|--------|------|---------|------|------|--------|
| 1 | 64-72 | `--version` / `-v` | 打印版本号退出 | **零 import** | 是 |
| 2 | 81-94 | `feature("DUMP_SYSTEM_PROMPT")` | 导出系统提示 | - | 否（flag） |
| 3 | 95-99 | `--claude-in-chrome-mcp` | Chrome MCP 服务 | 动态 import | 是 |
| 4 | 101-105 | `--chrome-native-host` | Chrome Native Host | 动态 import | 是 |
| 5 | 108-116 | `feature("CHICAGO_MCP")` | Computer Use MCP | - | 否（flag） |
| 6 | 123-127 | `feature("DAEMON")` | Daemon Worker | - | 否（flag） |
| 7 | 133-178 | `feature("BRIDGE_MODE")` | 远程控制 | - | 否（flag） |
| 8 | 181-190 | `feature("DAEMON")` | Daemon 主进程 | - | 否（flag） |
| 9 | 195-225 | `feature("BG_SESSIONS")` | ps/logs/attach/kill | - | 否（flag） |
| 10 | 228-240 | `feature("TEMPLATES")` | 模板任务 | - | 否（flag） |
| 11 | 244-253 | `feature("BYOC_ENVIRONMENT_RUNNER")` | BYOC 运行器 | - | 否（flag） |
| 12 | 258-264 | `feature("SELF_HOSTED_RUNNER")` | 自托管运行器 | - | 否（flag） |
| 13 | 267-293 | `--tmux` + `--worktree` | tmux worktree | 动态 import | 是 |

#### 参数修正（第 296-307 行）

```ts
// --update/--upgrade → 重写为 update 子命令
if (args[0] === "--update") process.argv = [..., "update"];
// --bare → 设置简单模式环境变量
if (args.includes("--bare")) process.env.CLAUDE_CODE_SIMPLE = "1";
```

#### 最终出口（第 310-316 行）

```ts
const { startCapturingEarlyInput } = await import("../utils/earlyInput.js");
startCapturingEarlyInput();           // 捕获用户提前输入的内容
const { main: cliMain } = await import("../main.jsx");
await cliMain();                      // 进入 main.tsx 重型初始化
```

所有快速路径都没命中时（99% 的情况），才走到这里。

### 1.3 启动（第 320 行）

```ts
void main();
```

`void` 表示不关心 Promise 返回值。

### 1.4 关键设计思想

- **快速路径**：`--version` 零开销返回，不加载任何模块
- **动态 import**：`await import()` 替代静态 import，每条路径只加载自己需要的模块
- **feature flag 过滤**：`feature()` 返回 false 使大量内部功能成为死代码

---

## 2. main.tsx（4683 行）— 重型初始化与 Commander CLI

**文件路径**: `src/main.tsx`

整个项目最大的单文件，但结构清晰：**辅助函数 → main() → run()**。

### 2.1 Import 区（第 1-215 行）

200+ 行 import，加载几乎所有子系统。关键的是前三个 **side-effect import**（import 即执行）：

```ts
// 第 9 行：记录时间戳
profileCheckpoint('main_tsx_entry');

// 第 16 行：启动 MDM 子进程读取（macOS plutil）
startMdmRawRead();

// 第 20 行：启动 keychain 预读取（OAuth token、API key）
startKeychainPrefetch();
```

这三个在 import 阶段就**并行启动子进程**，和后续 ~135ms 的模块加载同时进行——**用并行隐藏延迟**。

### 2.2 辅助函数（第 216-584 行）

| 函数 | 行号 | 作用 |
|------|------|------|
| `logManagedSettings()` | 216 | 记录企业托管设置到分析日志 |
| `isBeingDebugged()` | 232 | 检测调试模式，**外部构建下直接 exit(1)**（第 266 行） |
| `logSessionTelemetry()` | 279 | Session 遥测（技能、插件） |
| `getCertEnvVarTelemetry()` | 291 | SSL 证书环境变量收集 |
| `runMigrations()` | 326 | 数据迁移（模型重命名、设置格式升级等） |
| `prefetchSystemContextIfSafe()` | 360 | 信任关系建立后安全预取系统上下文 |
| `startDeferredPrefetches()` | 388 | REPL 首次渲染后的延迟预取 |
| `eagerLoadSettings()` | 502 | 在 init() 之前提前加载 `--settings` 参数 |
| `initializeEntrypoint()` | 517 | 根据运行模式设置 `CLAUDE_CODE_ENTRYPOINT` |

还有 `_pendingConnect`、`_pendingSSH`、`_pendingAssistantChat` 三个状态变量（第 542-583 行），用于暂存子命令参数。

### 2.3 main() 函数（第 585-856 行）

`main()` 本身不长，做完环境检测后调用 `run()`：

```
main()
├── 安全设置（NoDefaultCurrentDirectoryInExePath）
├── 信号处理（SIGINT → exit, exit → 恢复光标）
├── feature flag 保护的特殊路径（全部跳过）
├── 检测 -p/--print / --init-only → 判断是否交互模式
├── clientType 判断（cli / sdk-typescript / remote / github-action 等）
├── eagerLoadSettings()
└── await run()  ← 进入真正的逻辑
```

### 2.4 run() 函数（第 884-4683 行）

占 3800 行，是整个文件的核心。

#### Commander 初始化 + preAction 钩子（第 884-967 行）

```ts
const program = new CommanderCommand()
    .configureHelp(createSortedHelpConfig())
    .enablePositionalOptions();
```

**preAction 钩子**（所有命令执行前都会运行）：

```
preAction
├── await ensureMdmSettingsLoaded()         ← 等 MDM 子进程完成
├── await ensureKeychainPrefetchCompleted() ← 等 keychain 预读完成
├── await init()                             ← 一次性初始化
├── initSinks()                              ← 分析日志接收器
├── runMigrations()                          ← 数据迁移
├── loadRemoteManagedSettings()              ← 企业远程设置（非阻塞）
└── loadPolicyLimits()                       ← 策略限制（非阻塞）
```

#### 主命令 Option 定义（第 968-1006 行）

定义了 40+ CLI 参数，关键的包括：

| 参数 | 作用 |
|------|------|
| `-p, --print` | 非交互模式，输出后退出 |
| `--model <model>` | 指定模型（如 sonnet、opus） |
| `--permission-mode <mode>` | 权限模式 |
| `-c, --continue` | 继续最近对话 |
| `-r, --resume` | 恢复指定对话 |
| `--mcp-config` | MCP 服务器配置文件 |
| `--allowedTools` | 允许的工具列表 |
| `--system-prompt` | 自定义系统提示 |
| `--dangerously-skip-permissions` | 跳过所有权限检查 |
| `--output-format` | 输出格式（text/json/stream-json） |
| `--effort <level>` | 推理努力级别（low/medium/high/max） |
| `--bare` | 最小模式 |

#### action 处理器（第 1006-3808 行）

主命令的执行逻辑，内部按阶段和场景分支：

```
action(async (prompt, options) => {
    │
    ├── [1007-1600] 参数解析与预处理
    │   ├── --bare 模式
    │   ├── 解析 model / permission-mode / thinking / effort
    │   ├── 解析 MCP 配置、工具列表、系统提示
    │   └── 初始化工具权限上下文
    │
    ├── [1600-2220] 服务初始化
    │   ├── MCP 客户端连接
    │   ├── 插件加载 + 技能初始化
    │   ├── 工具列表组装
    │   └── 初始 AppState 构建
    │
    ├── [2220-2315] UI 初始化（交互模式）
    │   ├── createRoot() — 创建 Ink 渲染根节点
    │   ├── showSetupScreens() — 信任对话框、OAuth 登录、引导
    │   └── 登录后刷新各种服务
    │
    ├── [2315-2582] 后续初始化
    │   ├── LSP 管理器、插件版本管理
    │   ├── session 注册、遥测日志
    │   └── 遥测上报
    │
    ├── [2584-3050] --print 非交互模式分支
    │   ├── 构建 headless AppState + store
    │   └── 交给 print.ts 执行
    │
    └── [3050-3808] 交互模式：启动 REPL（7 个分支）
        ├── --continue      → 加载最近对话 → launchRepl()
        ├── DIRECT_CONNECT  → ❌ flag 关闭
        ├── SSH_REMOTE      → ❌ flag 关闭
        ├── KAIROS assistant → ❌ flag 关闭
        ├── --resume <id>   → 恢复指定对话 → launchRepl()
        ├── --resume 无 ID  → 显示对话选择器
        └── 默认（无参数）  → launchRepl()  ★最常走的路径
})
```

#### 子命令注册（第 3808-4683 行）

| 子命令 | 行号 | 作用 |
|--------|------|------|
| `claude mcp` | 3892 | MCP 服务器管理（serve/add/remove/list/get） |
| `claude server` | 3960 | Session 服务器（❌ flag 关闭） |
| `claude auth` | 4098 | 认证管理（login/logout/status/token） |
| `claude plugin` | 4148 | 插件管理（install/uninstall/list/update） |
| `claude setup-token` | 4267 | 设置长期认证 token |
| `claude agents` | 4278 | 列出已配置的 agents |
| `claude doctor` | 4346 | 健康检查 |
| `claude update` | 4362 | 检查更新 |
| `claude install` | 4394 | 安装原生构建 |
| `claude log` | 4411 | 查看对话日志（内部） |
| `claude completion` | 4491 | Shell 自动补全 |

最后执行解析：

```ts
await program.parseAsync(process.argv);
```

### 2.5 main.tsx 学习建议

- **不要通读**。记住三段结构：辅助函数 → main() → run()
- `feature()` 返回 false 的分支全部跳过，可忽略 50%+ 代码
- `("external" as string) === 'ant'` 的分支也跳过（内部构建专用）
- 需要深入某功能时，通过搜索定位对应代码段

---

## 3. replLauncher.tsx（22 行）— 胶水层

**文件路径**: `src/replLauncher.tsx`

极其简单，就做一件事：

```tsx
export async function launchRepl(root, appProps, replProps, renderAndRun) {
  const { App } = await import('./components/App.js');
  const { REPL } = await import('./screens/REPL.js');
  await renderAndRun(root, <App {...appProps}><REPL {...replProps} /></App>);
}
```

- `App` — 全局 Provider（AppState、Stats、FpsMetrics）
- `REPL` — 交互界面组件
- `renderAndRun` — 把 React 元素渲染到 Ink 终端

动态 import 保持了按需加载的策略。

---

## 4. REPL.tsx（5009 行）— 交互界面

**文件路径**: `src/screens/REPL.tsx`

项目第二大文件，是用户直接交互的界面。一个巨型 React 函数组件。

### 4.1 文件结构

```
REPL.tsx (5009 行)
├── [1-310]     Import 区（150+ import）
├── [312-525]   辅助组件
│   ├── median()               — 数学工具函数
│   ├── TranscriptModeFooter   — 转录模式底栏
│   ├── TranscriptSearchBar    — 转录搜索栏
│   └── AnimatedTerminalTitle  — 终端标题动画
├── [527-571]   Props 类型定义
└── [573-5009]  REPL() 组件主体
    ├── [600-900]   状态声明（50+ 个 useState/useRef/useAppState）
    ├── [900-2750]  副作用与回调（useEffect/useCallback）
    ├── [2750-2860] onQueryImpl — 核心：执行 API 查询
    ├── [2860-3030] onQuery — 查询守卫与并发控制
    ├── [3030-3145] 查询相关辅助回调
    ├── [3146-3550] onSubmit — 用户提交处理
    ├── [3550-4395] 更多副作用与状态管理
    └── [4396-5009] JSX 渲染
```

### 4.2 Props

从 main.tsx 通过 launchRepl() 传入：

| Prop | 类型 | 含义 |
|------|------|------|
| `commands` | `Command[]` | 可用的斜杠命令 |
| `debug` | `boolean` | 调试模式 |
| `initialTools` | `Tool[]` | 初始工具集 |
| `initialMessages` | `MessageType[]` | 初始消息（恢复对话时有值） |
| `pendingHookMessages` | `Promise<...>` | 延迟加载的 hook 消息 |
| `mcpClients` | `MCPServerConnection[]` | MCP 服务器连接 |
| `systemPrompt` | `string` | 自定义系统提示 |
| `appendSystemPrompt` | `string` | 追加系统提示 |
| `onBeforeQuery` | `fn` | 查询前回调，返回 false 可阻止查询 |
| `onTurnComplete` | `fn` | 轮次完成回调 |
| `mainThreadAgentDefinition` | `AgentDefinition` | 主线程 Agent 定义 |
| `thinkingConfig` | `ThinkingConfig` | 思考模式配置 |
| `disabled` | `boolean` | 禁用输入 |

### 4.3 状态管理

分三层：

**全局 AppState（通过 useAppState 选择器读取）：**

```ts
const toolPermissionContext = useAppState(s => s.toolPermissionContext);
const verbose = useAppState(s => s.verbose);
const mcp = useAppState(s => s.mcp);
const plugins = useAppState(s => s.plugins);
const agentDefinitions = useAppState(s => s.agentDefinitions);
```

**本地状态（useState）：**

```ts
const [messages, setMessages] = useState(initialMessages ?? []);
const [inputValue, setInputValue] = useState('');
const [screen, setScreen] = useState<Screen>('prompt');
const [streamingText, setStreamingText] = useState(null);
const [streamingToolUses, setStreamingToolUses] = useState([]);
// ... 50+ 个状态
```

**关键 Ref：**

```ts
const queryGuard = useRef(new QueryGuard()).current;  // 查询并发控制
const messagesRef = useRef(messages);                  // 消息的同步引用（避免闭包问题）
const abortController = ...;                           // 取消请求控制器
const responseLengthRef = useRef(0);                   // 响应长度追踪
```

### 4.4 核心数据流：用户输入 → API 调用

```
用户按回车
    │
    ▼
onSubmit (第 3146 行)
    ├── 斜杠命令？→ immediate command 直接执行 或 handlePromptSubmit 路由
    ├── 空输入？→ 忽略
    ├── 空闲检测 → 可能弹出"是否开始新对话"对话框
    ├── 加入历史记录
    │
    ▼
handlePromptSubmit (外部函数，src/utils/handlePromptSubmit.ts)
    ├── 斜杠命令 → 路由到对应 Command handler
    ├── 普通文本 → 构建 UserMessage，调用 onQuery()
    │
    ▼
onQuery (第 2860 行) — 并发守卫层
    ├── queryGuard.tryStart() → 已有查询？排队等待
    ├── setMessages([...old, ...newMessages]) — 追加用户消息
    ├── onQueryImpl()
    │
    ▼
onQueryImpl (第 2750 行) — 真正执行 API 调用
    │
    ├── 1. 并行加载上下文:
    │   await Promise.all([
    │       getSystemPrompt(),      // 构建系统提示
    │       getUserContext(),        // 用户上下文
    │       getSystemContext(),      // 系统上下文（git、平台等）
    │   ])
    │
    ├── 2. buildEffectiveSystemPrompt() — 合成最终系统提示
    │
    ├── 3. for await (const event of query({...}))  ★核心★
    │   │   调用 src/query.ts 的 query() AsyncGenerator
    │   │   流式产出事件
    │   │
    │   └── onQueryEvent(event) — 处理每个流式事件
    │       ├── 更新 streamingText（打字机效果）
    │       ├── 更新 messages（工具调用结果）
    │       └── 更新 inProgressToolUseIDs
    │
    └── 4. 收尾：resetLoadingState()、onTurnComplete()
```

**核心代码（第 2797-2807 行）**：

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

`query()` 来自 `src/query.ts`，是第二阶段要学的核心函数。

### 4.5 QueryGuard 并发控制

防止同时发起多个 API 请求的状态机：

```
idle ──tryStart()──▶ running ──end()──▶ idle
                        │
                        └── tryStart() 返回 null（已在运行）
                            → 新消息排入队列
```

- `tryStart()` — 原子操作，检查并转换 idle→running，返回 generation 号
- `end(generation)` — 检查 generation 匹配后转换 running→idle
- 防止 cancel+resubmit 竞态条件

### 4.6 JSX 渲染

两个互斥的渲染分支：

#### Transcript 模式（第 4396-4493 行）

按 `v` 键切换，只读浏览对话历史，支持搜索：

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

主交互界面，从上到下：

```tsx
<KeybindingSetup>
  <AnimatedTerminalTitle />           // 终端 tab 标题
  <GlobalKeybindingHandlers />        // 全局快捷键
  <CommandKeybindingHandlers />       // 命令快捷键
  <ScrollKeybindingHandler />         // 滚动快捷键
  <CancelRequestHandler />           // Ctrl+C 取消
  <MCPConnectionManager>             // MCP 连接管理
    <FullscreenLayout
      overlay={<PermissionRequest />}  // 权限审批覆盖层
      scrollable={                     // 可滚动区域
        <>
          <Messages />                 // ★ 对话消息渲染
          <UserTextMessage />          // 用户输入占位
          {toolJSX}                    // 工具 UI
          <SpinnerWithVerb />          // 加载动画
        </>
      }
      bottom={                         // 固定底部
        <>
          {/* 各种对话框 */}
          <SandboxPermissionRequest />
          <PromptDialog />
          <ElicitationDialog />
          <CostThresholdDialog />
          <FeedbackSurvey />

          {/* ★ 用户输入框 */}
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

### 4.7 REPL.tsx 学习建议

- 核心只有一条线：`onSubmit → onQuery → query() → onQueryEvent → 更新消息`
- 其余 4000+ 行是 UI 细节：快捷键、对话框、动画、边界情况处理
- `feature('...')` 保护的 JSX 全部跳过
- `("external" as string) === 'ant'` 的分支也跳过

---

## 关键设计模式总结

| 模式 | 位置 | 说明 |
|------|------|------|
| 快速路径 | cli.tsx | 按开销从低到高逐级检查，零开销处理简单请求 |
| 动态 import | cli.tsx / main.tsx | `await import()` 延迟加载，每条路径只加载需要的模块 |
| Side-effect import | main.tsx 顶部 | import 阶段就并行启动子进程，用并行隐藏延迟 |
| feature flag | 全局 | `feature()` 永远返回 false，编译时消除死代码 |
| preAction 钩子 | main.tsx run() | Commander.js 命令执行前统一初始化 |
| QueryGuard | REPL.tsx | 状态机防止并发 API 请求，带 generation 计数防竞态 |
| React/Ink | UI 层 | 用 React 组件模型渲染终端 UI，支持全屏和虚拟滚动 |

## 需要忽略的代码模式

| 模式 | 来源 | 说明 |
|------|------|------|
| `_c(N)` 调用 | React Compiler | 反编译产生的 memoization 样板代码 |
| `feature('FLAG')` 后面的代码 | Bun bundler | 全部是死代码，在当前版本不会执行 |
| `("external" as string) === 'ant'` | 构建目标检查 | 永远为 false（external !== ant） |
| tsc 类型错误 | 反编译 | `unknown`/`never`/`{}` 类型，不影响 Bun 运行 |
| `packages/@ant/` | stub 包 | 空实现，仅满足 import 依赖 |