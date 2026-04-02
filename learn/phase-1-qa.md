# 第一阶段 Q&A

## Q1：cli.tsx 的快速路径分发具体在做什么？

**核心思想**：根据用户输入的命令参数，尽早决定走哪条路，避免加载不需要的代码。cli.tsx 充当一个轻量级路由器，把简单请求就地处理，只有真正需要完整 CLI 时才加载 main.tsx。

### 场景对比

#### 场景 1：`claude --version`（命中快速路径）

```
cli.tsx main() 开始执行
  ├── args = ["--version"]
  ├── 命中第 64 行: args[0] === "--version" ✅
  ├── console.log("2.1.888 (Claude Code)")
  └── return  ← 立即退出，零 import，~10ms
```

#### 场景 2：`claude --claude-in-chrome-mcp`（命中中间路径）

```
cli.tsx main() 开始执行
  ├── 第 64 行: --version? ❌
  ├── 第 75 行: 加载 profileCheckpoint（仅此一个 import）
  ├── 第 81 行: feature("DUMP_SYSTEM_PROMPT") → false ❌
  ├── 第 95 行: --claude-in-chrome-mcp? ✅ 命中
  ├── await import("../utils/claudeInChrome/mcpServer.js")  ← 只加载这一个模块
  └── return  ← 没有加载 main.tsx 的 200+ import
```

#### 场景 3：`claude`（无参数，最常见，全部未命中）

```
cli.tsx main() 开始执行
  ├── --version?           ❌
  ├── profileCheckpoint 加载
  ├── feature(DUMP)?       ❌ (feature=false)
  ├── --chrome-mcp?        ❌
  ├── --chrome-native?     ❌
  ├── feature(CHICAGO)?    ❌ (feature=false)
  ├── feature(DAEMON)?     ❌ (feature=false)
  ├── feature(BRIDGE)?     ❌ (feature=false)
  ├── ... 所有快速路径逐一检查，全部未命中
  │
  ├── 走到第 310 行 ← 最终出口
  ├── await import("../main.jsx")  ← 加载完整 CLI（200+ import，~135ms）
  └── await cliMain()              ← 进入 main.tsx 重型初始化
```

### 性能对比

| 方式 | `claude --version` 耗时 |
|------|------------------------|
| 无快速路径（全部走 main.tsx） | ~200ms（加载 200+ import → 初始化 Commander → 解析参数 → 打印） |
| 有快速路径（cli.tsx 拦截） | ~10ms（读 args → 打印 → 退出） |

### feature() 的加速作用

大量快速路径被 `feature()` 守护：

```ts
if (feature("DAEMON") && args[0] === "daemon") { ... }
```

`feature()` 返回 false → `&&` 短路求值 → 连 `args[0]` 都不检查，直接跳过。在反编译版本中这些路径等于不存在，进一步加速了"全部没命中 → 走默认路径"的过程。

---

## Q2：main.tsx 中不同命令的具体执行流程是怎样的？

所有命令都会经过 main() → run()，但在 run() 内部根据 Commander 路由到不同分支。

### 场景 1：`claude`（无参数 — 启动交互 REPL）

最常见的场景，走完整条主命令路径：

```
main() (第 585 行)
  ├── 信号处理注册（SIGINT、exit）
  ├── feature flag 路径全部跳过
  ├── isNonInteractive = false（有 TTY，没有 -p）
  ├── clientType = 'cli'
  └── await run()
       │
       ▼
  run() (第 884 行)
  ├── Commander 初始化 + preAction 钩子 + 主命令选项注册
  ├── isPrintMode = false → 注册所有子命令
  └── program.parseAsync(process.argv)
       │  Commander 匹配到主命令，先执行 preAction
       ▼
  preAction (第 907 行)
  ├── await ensureMdmSettingsLoaded()        ← 等 side-effect import 的子进程完成
  ├── await ensureKeychainPrefetchCompleted() ← 等 keychain 预读完成
  ├── await init()                            ← 遥测、配置、信任
  ├── initSinks()                             ← 分析日志
  ├── runMigrations()                         ← 数据迁移
  └── loadRemoteManagedSettings() / loadPolicyLimits() ← 非阻塞
       │  然后执行 action handler
       ▼
  action(undefined, options) (第 1007 行)     ← prompt = undefined
  ├── [参数解析] permissionMode, model, thinkingConfig...
  ├── [工具加载] tools = getTools(toolPermissionContext)
  ├── [并行初始化]
  │   ├── setup()        ← worktree、CWD
  │   ├── getCommands()  ← 加载斜杠命令
  │   └── getAgentDefinitionsWithOverrides() ← 加载 agent 定义
  ├── [MCP 连接] 连接配置的 MCP 服务器
  ├── [构建初始状态] initialState = { tools, mcp, permissions, ... }
  │
  ├── [UI 初始化]（交互模式专属）
  │   ├── createRoot()          ← 创建 Ink 渲染根节点
  │   └── showSetupScreens()    ← 信任对话框 / OAuth / 引导
  │
  ├── [后续初始化] LSP、插件版本、session 注册
  │
  └── 默认分支 (第 3760 行) ← 没有 --continue/--resume/--print
      └── await launchRepl(root, {
              initialState
          }, {
              ...sessionConfig,
              initialMessages: undefined  ← 全新对话，无历史消息
          }, renderAndRun)
            │
            ▼
          REPL.tsx 渲染，用户看到空白对话界面
```

### 场景 2：`echo "explain this" | claude -p`（管道/非交互模式）

```
main() →
  ├── isNonInteractive = true（-p 标志 + stdin 不是 TTY）
  ├── clientType = 'sdk-cli'
  └── run()
       │
       ▼
  run()
  ├── Commander 初始化 + preAction + 主命令选项
  ├── isPrintMode = true
  │   → ★ 跳过所有子命令注册（节省 ~65ms）
  └── program.parseAsync()  ← 直接解析，Commander 路由到主命令 action
       │
       ▼
  preAction → init、迁移等（同场景 1）
       │
       ▼
  action("", { print: true, ... })
  ├── inputPrompt = await getInputPrompt("")
  │   ├── stdin.isTTY = false → 从 stdin 读数据
  │   ├── 等待最多 3s 读入: "explain this"
  │   └── 返回 "explain this"
  ├── tools = getTools()
  ├── setup() + getCommands()（并行）
  │
  ├── isNonInteractiveSession = true → 走 --print 分支（第 2584 行）
  │   ├── applyConfigEnvironmentVariables() ← -p 模式信任隐含
  │   ├── 构建 headlessInitialState（无 UI）
  │   ├── headlessStore = createStore(headlessInitialState)
  │   │
  │   ├── await import('src/cli/print.js')
  │   └── runHeadless(inputPrompt, ...)  ★ 不走 REPL
  │       ├── 发送 API 请求
  │       ├── 流式输出到 stdout
  │       └── 完成后 process.exit()
  │
  └── ← 不走 createRoot()、showSetupScreens()、launchRepl()
```

**关键差异**：
- 检测到 `-p` 后跳过子命令注册（节省 ~65ms）
- 不创建 Ink UI，不调用 `showSetupScreens()`
- 从 stdin 读取输入（`getInputPrompt` 第 857 行）
- 走 `print.js` 路径直接执行查询输出到 stdout

### 场景 3：`claude -c`（继续最近对话）

```
... main() → run() → preAction → action（前半部分同场景 1）
       │
       ▼
  action(undefined, { continue: true, ... })
  ├── [参数解析 + 工具加载 + 并行初始化 + UI 初始化]（同场景 1）
  │
  ├── options.continue = true → 命中第 3101 行
  │   ├── clearSessionCaches()       ← 清除过期缓存
  │   ├── result = await loadConversationForResume()
  │   │   └── 从 ~/.claude/projects/<cwd>/ 读最近的会话 JSONL
  │   │
  │   ├── result 为 null? → exitWithError("No conversation found")
  │   │
  │   ├── loaded = await processResumedConversation(result)
  │   │   ├── 解析 JSONL → messages[]
  │   │   ├── 恢复文件历史快照
  │   │   └── 重建 initialState
  │   │
  │   └── await launchRepl(root, {
  │           initialState: loaded.initialState
  │       }, {
  │           ...sessionConfig,
  │           initialMessages: loaded.messages,            ★ 带上历史消息
  │           initialFileHistorySnapshots: loaded.fileHistorySnapshots,
  │           initialAgentName: loaded.agentName
  │       }, renderAndRun)
  │         │
  │         ▼
  │       REPL.tsx 渲染，显示历史对话，用户继续聊天
  │
  └── ← 其他分支不执行
```

**关键差异**：`initialMessages` 有值（历史消息），REPL 启动时会渲染之前的对话内容。

### 场景 4：`claude mcp list`（子命令）

```
main() → run()
       │
       ▼
  run()
  ├── Commander 初始化 + preAction 钩子
  ├── 注册主命令 .action(...)
  ├── isPrintMode = false → 注册所有子命令
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
  preAction (第 907 行)     ← 子命令也触发 preAction
  ├── await init()
  ├── initSinks()
  ├── runMigrations()
  └── ...
       │
       ▼  执行子命令自己的 action（不走主命令 action）
  mcp list action
  ├── await import('./cli/handlers/mcp.js')
  └── await mcpListHandler()
      ├── 读取 MCP 配置（user/project/local 三级）
      ├── 连接每个服务器做健康检查
      ├── 格式化输出到终端
      └── 退出

  ← 主命令的 action handler 完全不执行
  ← 没有 REPL、没有 Ink UI、没有 showSetupScreens
```

**关键差异**：
- Commander 路由到子命令，**主命令 action 完全跳过**
- `preAction` 仍然执行（基础初始化所有命令都需要）
- 子命令有自己独立的轻量 action

### 四种场景对比

| | `claude` | `claude -p` | `claude -c` | `claude mcp list` |
|---|---------|------------|------------|-------------------|
| preAction | 执行 | 执行 | 执行 | 执行 |
| 主命令 action | 执行 | 执行 | 执行 | **跳过** |
| 子命令注册 | 注册 | **跳过** | 注册 | 注册 |
| showSetupScreens | 执行 | **跳过** | 执行 | **跳过** |
| createRoot (Ink) | 执行 | **跳过** | 执行 | **跳过** |
| 加载历史消息 | 否 | 否 | **是** | 否 |
| 最终出口 | launchRepl | print.js | launchRepl | 子命令 action |