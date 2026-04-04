# Claude Code 架构重构规划

## 一、当前架构 (As-Is)

```
┌─────────────────────────────────────────────────────────────────┐
│                        Entry Layer                              │
│  cli.tsx → main.tsx (4680行) ─┬─→ REPL.tsx (5005行, 交互)      │
│                                ├─→ print.ts (Headless/Pipe)     │
│                                └─→ SDK (QueryEngine)            │
├─────────────────────────────────────────────────────────────────┤
│                      Core Monolith                              │
│                                                                 │
│  ┌──────────┐   ┌──────────────┐   ┌───────────────────────┐   │
│  │ query.ts │←──│ QueryEngine  │   │  AppState (199行类型)  │   │
│  │ (1732行) │   │  (1320行)    │   │  UI+MCP+Bridge+       │   │
│  │          │   │              │   │  Perm+Plugin+Agent     │   │
│  └────┬─────┘   └──────────────┘   └───────────────────────┘   │
│       │                                                         │
│  ┌────▼─────────────────────────────────────────────────────┐  │
│  │              services/api/claude.ts (3415行)              │  │
│  │  ┌─────────┐  ┌──────────┐  ┌─────────┐  ┌───────────┐  │  │
│  │  │Anthropic│  │ Bedrock  │  │ Vertex  │  │  OpenAI   │  │  │
│  │  │ (主路径)│  │(if分支)  │  │(if分支) │  │ (882行    │  │  │
│  │  │         │  │          │  │         │  │  已实现)   │  │  │
│  │  └─────────┘  └──────────┘  └─────────┘  └───────────┘  │  │
│  └──────────────────────────────────────────────────────────┘  │
│       │                                                         │
│  ┌────▼──────────┐  ┌──────────────┐  ┌──────────────────┐    │
│  │ tools.ts      │  │ services/mcp/│  │  auth.ts         │    │
│  │ (硬编码列表)  │  │  client.ts   │  │  (2001行,7种认证) │    │
│  │ 54个Tool      │  │  (3351行)    │  │  +oauth/(12文件)  │    │
│  └───────────────┘  └──────────────┘  └──────────────────┘    │
│                                                                 │
│  ┌───────────────┐  ┌───────────────┐  ┌─────────────────┐    │
│  │ sessionStorage│  │   context.ts  │  │   ink/ (104文件) │    │
│  │ (5106行,JSONL)│  │  (189行,轻量) │  │   (UI框架)      │    │
│  └───────────────┘  └───────────────┘  └─────────────────┘    │
│                                                                 │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  隐蔽巨文件                                               │  │
│  │  tasks/LocalMainSessionTask.ts (15373行) ← 全库最大单文件  │  │
│  │  utils/hooks.ts (5177行) + hooks/ (5文件 1494行)          │  │
│  │  components/ (596文件) ← UI组件, 低估 3.5x               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘

耦合特征:
  ● main.tsx ~2867行内联 action handler (L1003-L3870), 51个subcommand
  ● REPL.tsx God Component: 54 useState, 68 useEffect, ~30 自定义Hook
  ● AppState 单一类型混合 7+ 个域 (UI/MCP/Permission/Bridge/Agent/Plugin/Team)
  ● Provider 分发靠 if/else 字符串比较 (108处 provider 相关引用)
  ● Tool 注册为静态列表 (getAllBaseTools), 54个工具, 无发现机制
  ● auth.ts (2001行) + oauth服务 (12文件 1077行) + 其他 (~779行), 总计约3857行
  ● hooks.ts 5177行, 27种 hook 事件类型, 混杂在 utils/ 中
  ● LocalMainSessionTask.ts 15373行为全库最大单体文件, 文档此前未提及
```

---

## 二、目标架构 (To-Be)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                           Entry Layer                                   │
│                                                                         │
│   cli.tsx ──→ main.tsx (瘦身) ─┬─→ REPL (纯 UI, Hook 编排)            │
│                                 ├─→ Headless (JSON 输出)                │
│                                 ├─→ SDK (程序化接口)                    │
│                                 └─→ Deep Links (claude:// 协议)        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                         │
│  ┌──────────────────── packages/agent ──────────────────────────┐      │
│  │                  (核心引擎, 零 UI 依赖)                           │      │
│  │                                                               │      │
│  │   query()            QueryEngine          HookLifecycle       │      │
│  │   ├─ streaming       ├─ turn管理          ├─ PreToolUse       │      │
│  │   ├─ recovery        ├─ compaction        ├─ PostToolUse      │      │
│  │   ├─ attachments     ├─ SDK消息转换       ├─ Notification     │      │
│  │   └─ abort           └─ budget追踪        ├─ Stop             │      │
│  │                                          ├─ SubagentStop      │      │
│  │   CompactionService    CronScheduler      ├─ UserPromptSubmit │      │
│  │   (snip/micro/auto)    (定时任务/抖动)     ├─ SessionStart/End │      │
│  │                                          ├─ PreCompact/      │      │
│  │   LocalMainSessionTask                   │  PostCompact       │      │
│  │   (15373行 → 分解重构)                   ├─ Permission*      │      │
│  │                                          └─ ... (27种事件)    │      │
│  │   QueryDeps (依赖注入)                                        │      │
│  └──────────────────────────┬────────────────────────────────────┘      │
│                             │                                           │
├─────────────────────────────┼───────────────────────────────────────────┤
│                             ▼                                           │
│  ┌──────────────── packages/provider ────────────────────────┐         │
│  │                  (适配器层, 可扩展)                             │         │
│  │                                                             │         │
│  │  ┌─────────────────┐  ┌────────────────┐                    │         │
│  │  │ ProviderAdapter │  │  AuthProvider   │                    │         │
│  │  │ ├─queryStream() │  │  ├─getCredentials()                 │         │
│  │  │ ├─query()       │  │  ├─refresh()    │                   │         │
│  │  │ ├─isAvailable() │  │  └─invalidate() │                   │         │
│  │  │ └─listModels()  │  └────────────────┘                    │         │
│  │  └────────┬────────┘                                        │         │
│  │           │                                                  │         │
│  │  ┌────────▼────────────────────────────────────────┐        │         │
│  │  │            StreamAdapter (归一化)                │        │         │
│  │  │  将任意 SSE/WS/流 → 统一的内部事件格式          │        │         │
│  │  └─────────────────────────────────────────────────┘        │         │
│  │                                                              │         │
│  │  ┌──────────────────────────────────────────────────┐        │         │
│  │  │            ContextProvider (可插拔 prompt 管线)   │        │         │
│  │  │  GitStatus → ClaudeMd → Date → Attribution → ... │        │         │
│  │  └──────────────────────────────────────────────────┘        │         │
│  │                                                              │         │
│  │  ┌──────────────────────────────────────────────────┐        │         │
│  │  │            NetworkLayer (网络/代理)               │        │         │
│  │  │  Proxy / mTLS / CA证书 / Upstream Proxy          │        │         │
│  │  └──────────────────────────────────────────────────┘        │         │
│  └──────────────────────────────────────────────────────────────┘         │
│                             │                                             │
├─────────────────────────────┼───────────────────────────────────────────┤
│                             ▼                                             │
│  ┌──────────────── 具体实现 (Implementation) ──────────────────────┐    │
│  │                                                                 │    │
│  │  LLM Providers           Auth Implementations                   │    │
│  │  ├─ Anthropic            ├─ AnthropicOAuth                      │    │
│  │  ├─ OpenAI               ├─ APIKey (Keychain/env/config)        │    │
│  │  ├─ Gemini               ├─ AWS (Bedrock IAM)                   │    │
│  │  ├─ Mistral              ├─ GCP (Vertex ADC)                    │    │
│  │  ├─ Bedrock              └─ Azure (Managed Identity)            │    │
│  │  ├─ Vertex                                                  │    │
│  │  ├─ 通义千问             Storage Backends                       │    │
│  │  └─ 本地推理             ├─ LocalFile (JSONL)                   │    │
│  │      (llama.cpp/vLLM)    ├─ RemoteAPI                          │    │
│  │                          └─ Memory (测试)                       │    │
│  └─────────────────────────────────────────────────────────────────┘    │
│                                                                         │
├────────────────────────────────── UI ───────────────────────────────────┤
│                                                                         │
│  ┌──────────── packages/ink ───────────────────────────────────────┐   │
│  │  UI 框架 (104文件 + 扩展)                                        │   │
│  │  ├─ reconciler / hooks (useInput等) / components                │   │
│  │  ├─ Keybinding 系统    (可配置键绑定, 模式解析, 冲突解决)        │   │
│  │  ├─ Vim Emulation      (motions / operators / text objects)     │   │
│  │  ├─ Typeahead          (命令/文件建议, 模糊搜索, ghost text)    │   │
│  │  └─ InkConfig (12个注入点)                                       │   │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├──────────────────────── 基础设施层 ─────────────────────────────────────┤
│                                                                         │
│  ┌──────── packages/agent-tools ──────────────────────────────────┐    │
│  │  Agent 工具库 (纯逻辑)                                          │    │
│  │  ├─ Tool interface + 54 个工具实现                               │    │
│  │  ├─ Sandbox 系统 (沙盒隔离执行)                                 │    │
│  │  ├─ configs, aliases, cost, deprecation, contextWindow          │    │
│  │  └─ ModelDeps (注入点)                                          │    │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────── packages/shell ────────────────────────────────────────┐    │
│  │  Shell 执行层 (独立抽象, 零 UI 依赖)                             │    │
│  │  ├─ ShellProvider 接口 (统一 bash/zsh/PowerShell)               │    │
│  │  ├─ Bash/Zsh 实现 (命令前缀注入/超时/环境构建)                   │    │
│  │  ├─ PowerShell 实现 (Windows 路径转换/FindGitBash)              │    │
│  │  └─ 子进程环境构建 (subprocessEnv)                               │    │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────── packages/config ───────────────────────────────────────┐    │
│  │  配置管理 (基础设施层, 被所有模块依赖)                            │    │
│  │  ├─ SettingsManager   (7层优先级合并: user→project→local→       │    │
│  │  │                     policy→flag→command→session)             │    │
│  │  ├─ FeatureFlagProvider (BunBundle/EnvVar/ConfigFile/Remote)   │    │
│  │  ├─ SettingsSync       (跨设备同步)                             │    │
│  │  ├─ RemoteManagedSettings (企业管控)                             │    │
│  │  └─ GlobalConfig       (apiKey/oauthToken等, config.ts 1821行)  │    │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────── packages/telemetry ────────────────────────────────────┐    │
│  │  遥测/诊断 (真实实现, 非空 stub, 需谨慎处理)                      │    │
│  │  ├─ AnalyticsEventEmitter  (OTel日志导出+JSONL批处理, 806行)    │    │
│  │  ├─ GrowthBook客户端       (AB测试/FeatureFlag, 1163行)         │    │
│  │  ├─ Datadog日志            (日志上传, 321行)                    │    │
│  │  ├─ SessionTracer          (OTel兼容会话追踪)                   │    │
│  │  └─ Metadata              (事件元数据enrichment, 973行)         │    │
│  │  总计: services/analytics/ (10文件, 4062行)                     │    │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├──────────────────────── 领域系统 ───────────────────────────────────────┤
│                                                                         │
│  ┌──────── packages/memory ───────────────────────────────────────┐    │
│  │  记忆系统 (独立实现, 零 UI 依赖)                                 │    │
│  │  ├─ MemoryStore (存储抽象) / MemoryRecall (相关性检索)          │    │
│  │  ├─ MemoryExtract (后台提取) / MemoryConsolidation (合并/清理)  │    │
│  │  └─ 类型: user / feedback / project / reference                 │    │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
│  ┌──────── packages/permission ───────────────────────────────────┐    │
│  │  权限系统 (独立实现, 零 UI 依赖)                                 │    │
│  │  ├─ PermissionMode (8种模式) / PermissionPipeline (检查管线)   │    │
│  │  ├─ RuleStore (allow/deny/ask 规则) / AutoClassifier (AI分类)  │    │
│  │  └─ ToolPermissionContext                                       │    │
│  └──────────────────────────────────────────────────────────────────┘   │
│                                                                         │
├──────────────────────── 扩展系统 (Phase 5) ─────────────────────────────┤
│                                                                         │
│  ┌──────────────┐  ┌──────────────────┐  ┌──────────────────────────┐  │
│  │ ToolRegistry │  │ OutputTarget     │  │ packages/swarm           │  │
│  │ ├─ 内置(静态)│  │ ├─ Terminal(Ink) │  │ (多Agent协调)            │  │
│  │ ├─ MCP(动态) │  │ ├─ JSON (SDK)    │  │ ├─ Backends              │  │
│  │ ├─ Plugin    │  │ ├─ Web (未来)    │  │ │  (进程/Tmux/iTerm2)    │  │
│  │ └─ 用户自定义│  │ └─ Silent (后台) │  │ ├─ PermissionSync        │  │
│  └──────────────┘  └──────────────────┘  │ ├─ TeammateMailbox       │  │
│                                           │ └─ Worktree管理          │  │
│  ┌──────────────────┐  ┌───────────────┐  └──────────────────────────┘  │
│  │ packages/ide     │  │ packages/server│                               │
│  │ ├─ VS Code       │  │ ├─ DirectConn │  ┌──────────────────────────┐ │
│  │ ├─ JetBrains     │  │ └─ LockFile   │  │ packages/teleport        │ │
│  │ ├─ LSP Client    │  │ (6/11文件stub │  │ ├─ 环境选择/配置         │ │
│  │ ├─ Code Indexing │  │  仅371行有效) │  │ ├─ Git 打包              │ │
│  │ └─ Claude-in-   │                      │ └─ API 集成              │ │
│  │    Chrome        │                      └──────────────────────────┘ │
│  └──────────────────┘                                                   │
│                                           ┌──────────────────────────┐ │
│  ┌──────────────────┐                     │ packages/updater        │ │
│  │ packages/cli     │                     │ ├─ NativeInstaller      │ │
│  │ ├─ Transport     │                     │ │  (.deb/.rpm/.pkg)      │ │
│  │ │  (Hybrid/SSE/  │                     │ ├─ BinaryDownload       │ │
│  │ │   WS/Worker)   │                     │ └─ AutoUpdateCheck      │ │
│  │ ├─ StructuredIO  │                     └──────────────────────────┘ │
│  │ └─ Rollback      │                                                   │
│  └──────────────────┘                                                   │
│                                                                         │
└─────────────────────────────────────────────────────────────────────────┘
```

---

## 三、单体文件分解图

```
main.tsx (4680行)                    REPL.tsx (5005行)
┌──────────────────────┐            ┌──────────────────────────┐
│ main() (安全/URL/argv)│            │    God Component         │
├──────────────────────┤            │  54 useState, 68 useEffect│
│ .action() handler     │            │  ~30 自定义 Hook         │
│ ┌──────────────────┐ │            │                          │
│ │ parseActionOptions│ │            │  ┌─ useQueryLifecycle ──┐│
│ │ (L1003-L3870,    │ │            │  │  query生命周期 (830行) ││
│ │  ~2867行内联)    │ │            │  │  权限回调, abort处理  ││
│ ├──────────────────┤ │            │  └──────────────────────┘│
│ │ mcpSetup         │ │            │  ┌─ usePromptSubmit ────┐│
│ ├──────────────────┤ │            │  │  命令解析, 队列 (350行)││
│ │ headlessSetup    │ │            │  └──────────────────────┘│
│ │ buildInitialState│ │            │  ┌─ useDialogManager ───┐│
│ ├──────────────────┤ │            │  │  通知优先级 (20路)    ││
│ │ sessionResume    │ │            │  └──────────────────────┘│
│ └──────────────────┘ │            │  ┌─ useScrollManager ───┐│
├──────────────────────┤            │  │  视口状态机 (135行)   ││
│ 51个 subcommands     │            │  └──────────────────────┘│
│ mcp/server/ssh/auth  │            │  ┌─ useSessionInit ─────┐│
│ plugin/doctor/update │            │  │  初始化, initial msg  ││
│ agents/task/autoMode │            │  └──────────────────────┘│
└──────────────────────┘            └──────────────────────────┘

query.ts (1732行)                   AppState (199行类型定义)
┌──────────────────────┐            ┌──────────────────────────┐
│ query() 异步生成器    │            │    单一嵌套类型, ~90字段  │
│ ┌──────────────────┐ │            │                          │
│ │compactionPipeline│ │            │  ┌─ UISlice ────────────┐│
│ │ (snip/micro/auto)│ │            │  │ verbose, expanded,   ││
│ ├──────────────────┤ │            │  │ footer, spinner      ││
│ │streamingOrchestrator            │  └─────────────────────┘│
│ │ (流+错误+abort)  │ │            │  ┌─ MCPSlice ───────────┐│
│ ├──────────────────┤ │            │  │ clients, tools,      ││
│ │ recovery         │ │            │  │ commands, resources  ││
│ │ (max_tokens/ptl) │ │            │  └─────────────────────┘│
│ ├──────────────────┤ │            │  ┌─ PermissionSlice ────┐│
│ │ attachments      │ │            │  │ toolPermissionContext││
│ │ (files/mem/skill)│ │            │  └─────────────────────┘│
│ └──────────────────┘ │            │  ┌─ BridgeSlice ────────┐│
└──────────────────────┘            │  │ replBridge* (~20字段)││
                                    │  └─────────────────────┘│
services/mcp/client.ts (3351行)     │  ┌─ AgentSlice ─────────┐│
┌──────────────────────┐            │  │ tasks, agents, team  ││
│ ┌──────────────────┐ │            │  └─────────────────────┘│
│ │transportManager  │ │            │  ┌─ PluginSlice ────────┐│
│ │(stdio/SSE/WS)    │ │            │  │ enabled, commands    ││
│ ├──────────────────┤ │            │  └─────────────────────┘│
│ │ toolDiscovery    │ │            └──────────────────────────┘
│ │(MCPTool实例化)   │ │
│ ├──────────────────┤ │            → Domain Slicing:
│ │ authManager      │ │            type AppState = UISlice
│ │(OAuth+重连)      │ │              & MCPSlice & PermissionSlice
│ └──────────────────┘ │              & BridgeSlice & AgentSlice
└──────────────────────┘              & PluginSlice & TeamSlice

LocalMainSessionTask.ts (15373行)    ← 全库最大单体文件
┌──────────────────────┐            (此前文档未提及)
│ 单文件承担本地主会话   │
│ 全部生命周期管理      │
│ 包含: turn管理/消息   │
│ 处理/工具调用/权限    │
│ 恢复/compaction等    │
│ 分解优先级: P1        │
└──────────────────────┘
```

---

## 四、适配器层详解

### 4.1 LLM Provider 适配器 (P1)

```
                    ┌─────────────────────────┐
                    │     agent          │
                    │  query() / QueryEngine  │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   ProviderAdapter       │
                    │  ┌─ queryStreaming()    │
                    │  ├─ query()            │
                    │  ├─ isAvailable()      │
                    │  └─ listModels()       │
                    └────────────┬────────────┘
                                 │
              ┌──────────────────┼──────────────────┐
              │                  │                   │
    ┌─────────▼──────┐ ┌────────▼───────┐ ┌────────▼───────┐
    │   Anthropic    │ │    OpenAI      │ │    Gemini      │
    │                │ │   (已有参考)    │ │    (新增)      │
    │ ┌────────────┐ │ │ ┌────────────┐│ │ ┌────────────┐ │
    │ │消息格式转换 │ │ │ │消息格式转换││ │ │消息格式转换│ │
    │ └────────────┘ │ │ └────────────┘│ │ └────────────┘ │
    │ ┌────────────┐ │ │ ┌────────────┐│ │ ┌────────────┐ │
    │ │工具格式转换 │ │ │ │工具格式转换││ │ │工具格式转换│ │
    │ └────────────┘ │ │ └────────────┘│ │ └────────────┘ │
    │ ┌────────────┐ │ │ ┌────────────┐│ │ ┌────────────┐ │
    │ │StreamAdapter│ │ │StreamAdapter ││ │StreamAdapter │ │
    │ │(原生)      │ │ │(SSE→内部)   ││ │(SSE→内部)   │ │
    │ └────────────┘ │ │ └────────────┘│ │ └────────────┘ │
    └────────────────┘ └───────────────┘ └────────────────┘
         ↑                    ↑                  ↑
    ┌────┴────────────────────┴──────────────────┴────┐
    │              归一化事件格式                        │
    │  content_block_start/delta/stop                  │
    │  message_start/delta/stop                        │
    │  error                                           │
    └──────────────────────────────────────────────────┘

当前问题:  claude.ts 3415行单体, Bedrock/Vertex 靠 if/else 分支 (108处provider引用)
参考实现:  src/services/api/openai/ (6文件, 882行)
           ├─ streamAdapter.ts  (310行, SSE→内部事件流)
           ├─ convertMessages.ts (184行, 消息格式转换)
           ├─ convertTools.ts   (68行, 工具格式转换)
           ├─ modelMapping.ts   (56行, 模型名称映射)
           ├─ client.ts         (48行, OpenAI客户端)
           └─ index.ts          (216行, 入口+queryModel)
已验证可行: 通过 CLAUDE_CODE_USE_OPENAI=1 启用, 流适配器模式已跑通
```

### 4.2 Auth Provider 适配器 (P1, 与 LLM 配套)

```
┌──────────────────────────────────────────────────┐
│                  ProviderAdapter                  │
│              需要 Credentials 才能工作             │
└─────────────────────┬────────────────────────────┘
                      │
         ┌────────────▼────────────┐
         │     AuthProvider        │
         │  ┌─ getCredentials()   │
         │  ├─ refresh()          │
         │  ├─ isAuthenticated()  │
         │  └─ invalidate()       │
         └────────────┬───────────┘
                      │
    ┌────────┬────────┼────────┬──────────┐
    │        │        │        │          │
┌───▼──┐ ┌──▼───┐ ┌──▼──┐ ┌──▼──┐ ┌────▼───┐
│OAuth │ │APIKey│ │ AWS │ │ GCP │ │ Azure  │
│      │ │      │ │     │ │     │ │        │
│PKCE  │ │Keych │ │IAM  │ │ADC  │ │Managed │
│flow  │ │env   │ │STS  │ │     │ │Identity│
│      │ │config│ │     │ │     │ │        │
└──────┘ └──────┘ └─────┘ └─────┘ └────────┘

当前问题:  auth.ts (2001行) + oauth/(12文件 1077行) + 其他(~779行) = 总计约3857行
           7种认证: APIKey/OAuth/Bedrock IAM/Vertex ADC/Keychain/ApiKeyHelper/Foundry
已有实现:  全部可从现有代码提取
```

### 4.3 Tool Registry (P1)

```
┌───────────────────────────────────────────┐
│              ToolRegistry                  │
│                                           │
│  register(tool)    unregister(name)       │
│  get(name)         getAll()               │
│                                           │
│  ┌─────────────────────────────────────┐  │
│  │            发现机制                  │  │
│  │  1. BuiltInTools  ─── 静态注册      │  │
│  │  2. MCPTools      ─── 动态加载 (已有)│  │
│  │  3. PluginTools   ─── npm包+配置    │  │
│  │  4. UserTools     ─── ~/.claude/    │  │
│  └─────────────────────────────────────┘  │
│                    │                       │
│                    ▼                       │
│         统一 AgentTool 接口                │
│         call() / checkPermissions()        │
│         isEnabled() / isReadOnly()         │
└───────────────────────────────────────────┘

当前问题:  tools.ts getAllBaseTools() 硬编码 54个 (20常驻 + 34条件, feature()控制)
优势:      Tool 接口已很干净, MCPTool 已证明动态加载
```

### 4.4 Storage Backend (P2)

```
┌───────────────────────────────────────────┐
│          Project (会话管理)                │
│  写队列 / 刷新 / 远程同步                  │
│                    │                       │
│         ┌──────────▼──────────┐           │
│         │   StorageBackend    │           │
│         │  read/write/append  │           │
│         │  delete/list        │           │
│         └──────────┬──────────┘           │
│                    │                       │
│    ┌───────────────┼───────────────┐      │
│    │               │               │      │
│ ┌──▼──────┐ ┌─────▼──────┐ ┌─────▼───┐  │
│ │LocalFile│ │ RemoteAPI  │ │ Memory  │  │
│ │(JSONL)  │ │(已有部分)  │ │(测试用) │  │
│ └─────────┘ └────────────┘ └─────────┘  │
└───────────────────────────────────────────┘

当前问题:  sessionStorage.ts (5106行, JSONL) + sessionRestore.ts (551行)
           + sessionStoragePortable.ts (793行) + listSessionsImpl.ts (454行)
           = 总计约6968行, 硬编码 JSONL 格式
已有基础:  hydrateRemoteSession / persistToRemote 部分实现
```

### 4.5 Output Target (P3)

```
┌───────────────────────────────────────────┐
│              agent                    │
│         (产出 Message/Event)               │
│                    │                       │
│         ┌──────────▼──────────┐           │
│         │    OutputTarget     │           │
│         │  renderMessage()    │           │
│         │  renderToolProgress()│          │
│         │  renderError()      │           │
│         │  renderPermission() │           │
│         └──────────┬──────────┘           │
│                    │                       │
│  ┌─────────┬───────┼────────┬──────────┐  │
│  │         │       │        │          │  │
│ ┌▼───────┐┌▼─────┐┌▼──────┐┌▼────────┐ │  │
│ │Terminal││ JSON ││  Web  ││ Silent  │ │  │
│ │(Ink)   ││(SDK) ││(未来) ││(后台)   │ │  │
│ └────────┘└──────┘└───────┘└─────────┘ │  │
└───────────────────────────────────────────┘

当前问题:  170+组件耦合 Ink API, 3种输出路径未抽象
已有分支:  headless/pipe 绕过 Ink, SDK 跳过 Ink
```

### 4.6 Context Pipeline (P2)

```
┌──────────────────────────────────────────────────┐
│                  System Prompt 装配               │
│                                                  │
│  ┌────────────────────────────────────────────┐  │
│  │            ContextProvider[]               │  │
│  │   (按 priority 排序, 可插拔)               │  │
│  │                                            │  │
│  │   ┌─ GitStatusProvider ──── priority: 10   │  │
│  │   ├─ ClaudeMdProvider ──── priority: 20   │  │
│  │   ├─ DateProvider ──────── priority: 30   │  │
│  │   ├─ AttributionProvider ─ priority: 40   │  │
│  │   ├─ AdvisorProvider ──── priority: 50    │  │
│  │   └─ CustomProvider ────── priority: 99   │  │
│  │         (用户通过配置注册)                  │  │
│  └────────────────────────────────────────────┘  │
│                      │                           │
│                      ▼                           │
│              最终 System Prompt                   │
└──────────────────────────────────────────────────┘

当前问题:  context.ts (189行, 轻量) 提供上下文, claude.ts buildSystemPromptBlocks()
           做 prompt 缓存分块, 无自定义 hook 点
改动范围:  集中在 prompt 装配逻辑 (claude.ts + context.ts)
```

### 4.7 Hook 生命周期 (P1, 核心扩展机制)

```
┌───────────────────────────────────────────────────────────────────┐
│                    HookLifecycle (packages/agent 内)              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Hook 点 (用户在 settings.json 配置 shell 命令)             │  │
│  │  共 27 种事件, 按类型分组:                                    │  │
│  │                                                             │  │
│  │  工具相关:                                                   │  │
│  │  ├─ PreToolUse        工具调用前 → 可阻止/修改输入          │  │
│  │  ├─ PostToolUse       工具调用后 → 可修改输出               │  │
│  │  └─ PostToolUseFailure 工具调用失败后                        │  │
│  │  会话相关:                                                   │  │
│  │  ├─ SessionStart/End   会话生命周期                         │  │
│  │  ├─ UserPromptSubmit   用户提交输入时                       │  │
│  │  ├─ Stop/StopFailure   对话停止时                           │  │
│  │  ├─ PreCompact/PostCompact  上下文压缩前后                  │  │
│  │  └─ CwdChanged         工作目录变更时                       │  │
│  │  子Agent/团队:                                              │  │
│  │  ├─ SubagentStart/Stop 子Agent生命周期                      │  │
│  │  ├─ TeammateIdle       队友空闲时                           │  │
│  │  ├─ TaskCreated/Completed 任务生命周期                      │  │
│  │  └─ WorktreeCreate/Remove Worktree管理                      │  │
│  │  权限/通知:                                                  │  │
│  │  ├─ Notification       通知触发 → 自定义渠道                │  │
│  │  ├─ PermissionRequest/Denied 权限审批                       │  │
│  │  ├─ Elicitation/Result 用户反馈请求                         │  │
│  │  └─ ConfigChange       配置变更时                           │  │
│  │  其他: Setup, InstructionsLoaded, FileChanged                │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                         │                                         │
│  ┌──────────────────────▼──────────────────────────────────────┐  │
│  │  HookExecutor (hooks.ts, 5177行 → 提取为独立模块)           │  │
│  │                                                             │  │
│  │  ├─ spawnShellCommand()  → 执行用户配置的 shell 命令        │  │
│  │  ├─ parseJsonOutput()    → 解析 hook 的 JSON 输出           │  │
│  │  ├─ timeout / abort      → 超时和中断处理                   │  │
│  │  ├─ hooksConfigSnapshot  → 配置快照 (热加载)                │  │
│  │  └─ fileChangedWatcher   → 文件变更监听触发 hook            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  hooks.ts (5177行) + hooks/ (5文件 1494行) = 6713行  │
│            混杂在 utils/ 中, 27种事件类型全部硬编码               │
│  改动范围:  提取到 packages/agent/hooks/, 作为核心生命周期        │
│  依赖关系:  HookExecutor ← ToolRegistry (PreToolUse/PostToolUse) │
│            HookExecutor ← QueryEngine (Stop/SubagentStop)        │
└───────────────────────────────────────────────────────────────────┘
```

### 4.8 Shell 执行层 (P2, BashTool 底层依赖)

```
┌───────────────────────────────────────────────────────────────────┐
│                  packages/shell (~19000行)                         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  ShellProvider 接口                                         │  │
│  │  ├─ spawn(command, options)    → ShellResult               │  │
│  │  ├─ getShellPath()             → string                    │  │
│  │  ├─ buildEnv(context)          → Record<string, string>    │  │
│  │  └─ wrapCommand(cmd, sandbox)  → string (前缀注入)         │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                              │                                    │
│         ┌────────────────────┼──────────────────────┐             │
│         │                    │                      │             │
│  ┌──────▼─────────┐  ┌──────▼─────────┐  ┌────────▼──────────┐  │
│  │  BashProvider   │  │  ZshProvider   │  │ PowerShellProvider│  │
│  │                 │  │                │  │                   │  │
│  │ ├─ bash/(24文件)│  │ ├─ .zshrc 检测│  │ ├─ powershell/    │  │
│  │ │  12310行      │  │ ├─ 插件兼容   │  │ │  3文件, 2305行  │  │
│  │ ├─ 超时/中断    │  │ └─ compfix    │  │ ├─ FindGitBash    │  │
│  │ ├─ 沙盒集成     │  └────────────────┘  │ ├─ Windows路径    │  │
│  │ └─ 命令前缀     │                      │ └─ ExecutionPolicy│  │
│  └─────────────────┘                      └───────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  subprocessEnv.ts  → 子进程环境变量构建                      │  │
│  │  ShellCommand.ts (465行)  → 命令封装 + 流式输出              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  bash/ 12310行 + powershell/ 2305行 混在 utils/ 中    │
│  改动范围:  提取为独立 package, BashTool 通过依赖注入使用         │
│  依赖方向:  packages/shell ← packages/agent-tools (BashTool)     │
└───────────────────────────────────────────────────────────────────┘
```

### 4.9 配置管理系统 (P2, 基础设施层)

```
┌───────────────────────────────────────────────────────────────────┐
│                 packages/config (~9700行)                          │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  SettingsManager                                            │  │
│  │  ├─ 7 层优先级合并 (低→高, 后者覆盖前者):                   │  │
│  │  │  1. userSettings     ~/.claude/settings.json             │  │
│  │  │  2. projectSettings  .claude/settings.json               │  │
│  │  │  3. localSettings    .claude/local/settings.json         │  │
│  │  │  4. policySettings   企业管理 (远程下发)                 │  │
│  │  │  5. flagSettings     GrowthBook feature flags            │  │
│  │  │  6. cliArg           --allowed-tools 等 CLI 参数         │  │
│  │  │  7. session          临时 ("始终允许" 按钮产生)           │  │
│  │  └─ get(key) / set(key, value, source) / watch(key, cb)    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │ FeatureFlagProvider  │  │ SettingsSync                     │  │
│  │ ├─ BunBundle        │  │ ├─ 跨设备同步 (已部分实现)       │  │
│  │ ├─ EnvVar           │  │ ├─ 冲突检测/合并                 │  │
│  │ ├─ ConfigFile       │  │ └─ RemoteManagedSettings         │  │
│  │ ├─ Remote (GrowthBook)│  │    (企业管控配置)               │  │
│  │ └─ feature(name)→bool│  └──────────────────────────────────┘  │
│  └──────────────────────┘                                         │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  GlobalConfig (src/utils/config.ts, 1821行)                 │  │
│  │  ├─ apiKey / oauthToken / customApiKeyResponses             │  │
│  │  ├─ preferredNotifChannel / projects (per-project)          │  │
│  │  ├─ saveGlobalConfig / getGlobalConfig (文件锁+新鲜度监控)  │  │
│  │  └─ trust dialog / config backup / default factory          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  settings/(3文件 1411行) + config.ts(1821行) 混在utils │
│  改动范围:  提取为独立 package, 作为最底层基础设施                │
│  依赖方向:  被 packages/agent, packages/permission 等所有模块依赖 │
│  注意:  feature() 使用181处, 分布在30+文件, 提取需谨慎          │
└───────────────────────────────────────────────────────────────────┘
```

### 4.10 遥测/诊断系统 (P3, 真实实现, 非空 stub)

```
┌───────────────────────────────────────────────────────────────────┐
│          services/analytics/ (10文件, 4062行, 真实实现)            │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  重要: 这不是空 stub, 而是完整的生产级实现                    │  │
│  │  包含 OTel 日志导出、GrowthBook AB测试、Datadog 日志上传     │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  FirstPartyEventLoggingExporter (806行)                      │  │
│  │  ├─ OpenTelemetry LogExporter + JSONL 批处理 + HTTP 上传    │  │
│  └─ FirstPartyEventLogger (449行)                               │  │
│     └─ OTel LoggerProvider + 采样策略                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  GrowthBook 客户端 (1163行)                                  │  │
│  │  ├─ Feature flags / AB 测试 / 远程配置                      │  │
│  └─ sinkKillswitch (25行) — per-sink 开关                      │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Datadog 日志 (321行) + Metadata (973行)                     │  │
│  │  ├─ Datadog 日志上传 (需环境变量配置端点/密钥)                │  │
│  └─ 事件元数据enrichment                                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  真实实现散布在 services/analytics/, 耦合 GrowthBook   │
│  建议:  暂不提取为独立 package, 保持原地, 避免引入回归风险        │
│  依赖方向:  被多个模块调用, 但不影响核心业务逻辑                  │
└───────────────────────────────────────────────────────────────────┘
```

### 4.11 Compaction 服务 (P2, 从 query.ts 独立)

```
┌───────────────────────────────────────────────────────────────────┐
│              CompactionService (packages/agent 内)                 │
│               src/services/compact/ (29文件, 4267行)               │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  CompactionStrategy (策略模式)                              │  │
│  │                                                             │  │
│  │  ├─ SnipCompaction     精确裁剪 (保留首尾, 裁剪中间)       │  │
│  │  ├─ MicroCompaction    摘要压缩 (每 N 轮自动摘要)          │  │
│  │  └─ AutoCompaction     智能压缩 (按 token budget 触发)     │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                              │                                    │
│  ┌──────────────────────────▼──────────────────────────────────┐  │
│  │  ContextWindowManager                                        │  │
│  │  ├─ token 计数 / budget 分配                                 │  │
│  │  ├─ 触发阈值检测 (80%/90%/95%)                              │  │
│  │  └─ prompt 构造 (摘要请求 → 模型 → 替换历史)               │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  逻辑分散在 query.ts + services/compact/ 两处          │
│  改动范围:  统一到 packages/agent/compaction/                     │
│  依赖方向:  ← QueryEngine 调用; → packages/provider (摘要请求)   │
└───────────────────────────────────────────────────────────────────┘
```

### 4.12 Swarm / 多Agent 协调 (P3, 扩展系统)

```
┌───────────────────────────────────────────────────────────────────┐
│              packages/swarm (~7548行 + tasks/)                     │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  SwarmOrchestrator                                          │  │
│  │  ├─ spawnTeammate(config) → TeammateHandle                 │  │
│  │  ├─ broadcast(message)    → void                           │  │
│  │  ├─ getTeamStatus()       → TeamStatus[]                   │  │
│  │  └─ shutdown()            → void                           │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                              │                                    │
│         ┌────────────────────┼──────────────────────┐             │
│         │                    │                      │             │
│  ┌──────▼──────────┐  ┌─────▼───────────┐  ┌──────▼──────────┐  │
│  │ InProcessBackend│  │ TmuxBackend     │  │ ITerm2Backend   │  │
│  │ (同进程, 线程)  │  │ (Tmux pane)     │  │ (iTerm2 split)  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                   │
│  ┌──────────────────────┐  ┌──────────────────────────────────┐  │
│  │ TeammateMailbox      │  │ PermissionSync                   │  │
│  │ ├─ send(to, msg)     │  │ ├─ 主Agent → 子Agent 权限传递   │  │
│  │ ├─ receive()         │  │ ├─ 规则同步 / 模式继承          │  │
│  │ └─ broadcast(msg)    │  │ └─ 子Agent 结果审批             │  │
│  └──────────────────────┘  └──────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Task 类型系统 (src/tasks/, 13入口, 含巨文件)                │  │
│  │  ├─ LocalMainSessionTask  15373行 (全库最大!)               │  │
│  │  ├─ DreamTask            后台记忆合并                       │  │
│  │  ├─ InProcessTeammateTask 进程内队友                        │  │
│  │  ├─ LocalAgentTask       本地子Agent                       │  │
│  │  ├─ RemoteAgentTask      远程子Agent                       │  │
│  │  └─ MonitorMcpTask       MCP 监控                          │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Worktree 管理 (src/utils/worktree.ts, 1519行)              │  │
│  │  ├─ createWorktree() → 隔离的 git worktree                  │  │
│  │  ├─ cleanupWorktree() → 合并/丢弃                           │  │
│  │  └─ getWorktreePaths() → 路径映射                            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  src/utils/swarm/(22文件, 7548行) + tasks/ 分散        │
│            swarm 含 13文件(4486行) + backends/(9文件 3062行)      │
│  改动范围:  统一到 packages/swarm/                                │
│  依赖方向:  ← packages/agent (AgentTool); → packages/shell       │
└───────────────────────────────────────────────────────────────────┘
```

### 4.13 IDE / 编辑器集成 (P3, 扩展系统)

```
┌───────────────────────────────────────────────────────────────────┐
│               packages/ide (~6800行)                               │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  IDEConnector 接口                                         │  │
│  │  ├─ connect(ideType) → IDEConnection                       │  │
│  │  ├─ highlightFile(path, range)                              │  │
│  │  ├─ openFile(path, line?)                                   │  │
│  │  └─ getSelection() → Range | null                          │  │
│  └──────────────────────────┬──────────────────────────────────┘  │
│                              │                                    │
│         ┌────────────────────┼──────────────────────┐             │
│         │                    │                      │             │
│  ┌──────▼──────────┐  ┌─────▼───────────┐  ┌──────▼──────────┐  │
│  │ VSCodeProvider  │  │ JetBrainsProvider│  │ LSPClient       │  │
│  │ (ide.ts 1494行) │  │ (jetbrains.ts   │  │ (services/lsp/  │  │
│  │ LSP 协议连接    │  │  191行)         │  │  8文件)         │  │
│  │ 选区/高亮同步   │  │ IDE 集成        │  │ 代码操作/诊断   │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  CodeIndexing (native-ts/file-index/)                       │  │
│  │  ├─ 文件内容索引 → 快速代码搜索                             │  │
│  │  └─ 增量更新 / 持久化                                       │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Claude-in-Chrome (utils/claudeInChrome/, 7文件, 2337行)    │  │
│  │  ├─ Chrome Native Messaging → 浏览器控制                    │  │
│  │  ├─ 设置管理 / Prompt 注入                                  │  │
│  │  └─ 独立于 Computer Use, 通过 --chrome 启用                │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  ide.ts + jetbrains.ts + lsp/ + claudeInChrome/ 分散  │
│  改动范围:  合并到 packages/ide/                                  │
│  依赖方向:  ← packages/agent (LSPTool); 独立于核心循环           │
└───────────────────────────────────────────────────────────────────┘
```

### 4.14 Server 模式 (P3, 大部分 stub)

```
┌───────────────────────────────────────────────────────────────────┐
│              packages/server (11文件, 大部分 stub)                  │
│               src/server/ (392行, 其中仅371行有效代码)              │
│                                                                   │
│  实际实现 (4文件, 371行):                                          │
│  ├─ directConnectManager.ts (213行) — Direct Connect 管理         │
│  ├─ createDirectConnectSession.ts (88行) — 会话创建               │
│  ├─ types.ts (57行) — 类型定义                                    │
│  └─ lockfile.ts (13行) — PID 锁                                   │
│                                                                   │
│  Stub 文件 (6个, 各3行):                                           │
│  ├─ server.ts / sessionManager.ts / connectHeadless.ts            │
│  ├─ serverBanner.ts / serverLog.ts / parseConnectUrl.ts           │
│  └─ backends/dangerousBackend.ts                                   │
│                                                                   │
│  当前问题:  6/11文件为空 stub, 仅 DirectConnect 有实际代码        │
│  建议:  低优先级, 待 stub 被恢复后再考虑提取                      │
│  依赖方向:  ← main.tsx (启动, DIRECT_CONNECT feature); 独立于核心  │
└───────────────────────────────────────────────────────────────────┘
```

### 4.15 远程执行 / Teleport (P3, 扩展系统)

```
┌───────────────────────────────────────────────────────────────────┐
│            packages/teleport (~2200行)                             │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  TeleportProvider                                           │  │
│  │  ├─ selectEnvironment(config) → Environment                 │  │
│  │  ├─ packGitContext() → Archive        (Git 打包上传)        │  │
│  │  ├─ execute(command, env) → Result    (远程执行)            │  │
│  │  └─ syncResults(remote, local)        (结果同步)            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  teleport.tsx(1234行) + teleport/(4文件, 956行)       │
│            = 总计约2190行, 散布在 utils/ 中                      │
│  改动范围:  提取为独立 package                                    │
│  依赖方向:  ← packages/agent; → packages/shell (远程执行)        │
└───────────────────────────────────────────────────────────────────┘
```

### 4.16 自动更新 / 安装器 (P3, 入口层辅助)

```
┌───────────────────────────────────────────────────────────────────┐
│            packages/updater (~3579行)                              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  NativeInstaller                                            │  │
│  │  ├─ Linux:  .deb / .rpm 包管理                              │  │
│  │  ├─ macOS:  .pkg 安装器                                     │  │
│  │  └─ Windows: (预留)                                         │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  AutoUpdater (autoUpdater.ts, 561行)                        │  │
│  │  ├─ 版本检查 (远程 / npm registry)                          │  │
│  │  ├─ 二进制下载 + 校验                                       │  │
│  │  └─ PID 锁 (防止并发更新)                                   │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  nativeInstaller/(5文件 3018行) + autoUpdater.ts(561行)│
│            = 总计约3579行, 散布在 utils/ 中                      │
│  改动范围:  提取为独立 package, 仅被 entry layer 调用             │
│  依赖方向:  ← cli.tsx / main.tsx (启动时检查); 无业务依赖       │
└───────────────────────────────────────────────────────────────────┘
```

### 4.17 CLI 传输层 (P3, 入口层基础设施)

```
┌───────────────────────────────────────────────────────────────────┐
│          packages/cli (~12700行)                                   │
│           src/cli/ (127文件)                                       │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Transport 层 (可插拔 I/O 传输)                             │  │
│  │                                                             │  │
│  │  ├─ HybridTransport    混合模式 (本地 + 远程)              │  │
│  │  ├─ SSETransport       Server-Sent Events                  │  │
│  │  ├─ WebSocketTransport WebSocket 双向通信                  │  │
│  │  ├─ WorkerStateTransport Worker 线程通信                   │  │
│  │  └─ SerialBatchTransport 串行批处理                        │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Handler 模块 (8个, 按 subcommand 分发)                     │  │
│  │  ├─ agents / auth / mcp / autoMode / ...                   │  │
│  │  ├─ StructuredIO (结构化输入输出)                           │  │
│  │  └─ Rollback 机制                                           │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  当前问题:  127文件独立目录但未抽为 package                       │
│  改动范围:  提取为 packages/cli/, 仅被 entry layer 引用          │
│  依赖方向:  ← cli.tsx / main.tsx; → packages/agent              │
└───────────────────────────────────────────────────────────────────┘
```

---

## 五、Packages 目录结构

```
packages/
├── @ant/                           (已有)
│   ├── computer-use-mcp/
│   ├── computer-use-input/
│   ├── computer-use-swift/
│   └── claude-for-chrome-mcp/
├── audio-capture-napi/             (已有)
├── color-diff-napi/                (已有)
├── image-processor-napi/           (已有)
│
├── ink/               ← Phase 1   UI 框架 + Keybinding + Vim + Typeahead
├── agent-tools/        ← Phase 2   Agent 工具库 + Sandbox 系统
├── memory/             ← Phase 2   记忆系统, 独立实现
├── permission/         ← Phase 2   权限系统, 独立实现
├── config/             ← Phase 2   配置管理 + FeatureFlag + GlobalConfig
├── telemetry/          ← Phase 2   遥测/诊断 (真实实现, 非空stub)
├── agent/              ← Phase 3   核心引擎 + Hook 生命周期 + Compaction + Cron
├── provider/           ← Phase 4   ProviderAdapter + AuthProvider + NetworkLayer
├── shell/              ← Phase 4   Shell 执行层 (Bash/Zsh/PowerShell)
├── swarm/              ← Phase 5   多Agent协调 + Worktree
├── ide/                ← Phase 5   IDE/LSP/CodeIndex + Claude-in-Chrome
├── server/             ← Phase 5   服务器模式 (大部分stub, 低优先级)
├── teleport/           ← Phase 5   远程执行环境
├── updater/            ← Phase 5   自动更新 + 原生安装器
└── cli/                ← Phase 5   CLI 传输层 + Handler 分发
```

---

## 六、实施路线图

```
Phase 0: 内部分解 (与 Phase 1-3 并行, 低风险)
  ├── main.tsx  → 6 个模块
  ├── REPL.tsx  → 5 个 Hook
  ├── query.ts  → 4 个子模块
  ├── services/mcp/client.ts → 3 个模块
  ├── LocalMainSessionTask.ts → 分解 (15373行, 全库最大)
  └── AppState → Domain Slicing

Phase 1: packages/ink/                    风险: 低
  ├── Ink 框架 (reconciler/hooks/components)
  ├── Keybinding 系统 (16文件 → 纳入 ink/)
  ├── Vim 模拟 (5文件 → 纳入 ink/)
  └── Typeahead/Suggestion (→ 纳入 ink/)

Phase 2: 独立系统提取                          风险: 低-中
  ├── packages/agent-tools/    Agent 工具库 + Sandbox
  ├── packages/memory/         记忆系统
  ├── packages/permission/     权限系统
  ├── packages/config/         配置管理 + FeatureFlag + GlobalConfig
  └── packages/telemetry/      遥测/诊断 (真实实现, 谨慎提取)

Phase 3: packages/agent/                  风险: 中-高
  ├── query() + QueryEngine 核心循环
  ├── Hook 生命周期 (hooks.ts 5177行 + hooks/ 5文件 → 提取, 27种事件)
  ├── Compaction 服务 (services/compact/ 29文件 → 统一)
  ├── Cron/Scheduler (utils/cron* → 提取)
  └── FileHistory (utils/fileHistory → 提取)

Phase 4: packages/provider/ + packages/shell/  风险: 中
  ├── LLM Provider 适配器 (核心价值最高)
  ├── Auth Provider 适配器
  ├── Context Pipeline
  ├── NetworkLayer (proxy/mTLS/CA证书)
  └── Shell 执行层 (bash/powershell → 提取)

Phase 5: 扩展系统                           风险: 中-高
  ├── Tool Registry / Plugin
  ├── Storage Backend / Command System
  ├── Output Target / Feature Flag Provider
  ├── packages/swarm/     多Agent协调 + Worktree
  ├── packages/ide/       IDE/LSP + CodeIndex + Chrome
  ├── packages/server/    服务器 (大部分stub, 可延后)
  ├── packages/teleport/  远程执行
  ├── packages/updater/   自动更新 + 安装器
  └── packages/cli/       CLI 传输层
```

---

## 七、优先级矩阵

| 项目 | 用户价值 | 风险 | 优先级 |
|------|---------|------|--------|
| **LLM Provider 适配器** | 高 (多模型, 已有OpenAI参考实现) | 中 | **P1** |
| **Auth Provider 适配器** | 高 (安全, 7种认证约3857行) | 高 | **P1** |
| **Tool Registry** | 高 (生态, 54个工具) | 低 | **P1** |
| **Hook 生命周期** | 高 (核心扩展点, 27种事件) | 中 | **P1** |
| **LocalMainSessionTask分解** | 高 (15373行巨文件) | 中 | **P1** |
| **Shell 执行层** | 高 (BashTool底层, bash/12310行) | 中 | **P2** |
| **配置管理** | 高 (基础设施, config.ts 1821行) | 低-中 | **P2** |
| **记忆系统** | 高 (跨会话记忆, 24文件 6330行) | 低-中 | **P2** |
| **权限系统** | 高 (安全/可扩展, 24文件 9416行) | 中 | **P2** |
| **Compaction 服务** | 中 (上下文管理, 29文件 4267行) | 低 | **P2** |
| **命令系统** | 中 (可扩展命令, 93目录 96命令) | 低 | P2 |
| Context Pipeline | 中 (自定义prompt) | 低 | P2 |
| Storage Backend | 中 (云同步/测试, 5文件约6968行) | 低-中 | P2 |
| **遥测/诊断** | 中 (可观测性, 真实实现非stub) | 中 | P2 |
| main.tsx 分解 | 中 (可维护性, 4680行) | 低 | P2 |
| REPL.tsx 分解 | 中 (可维护性, 5005行) | 中 | P2 |
| query.ts 分解 | 中 (可维护性, 1732行) | 低 | P3 |
| AppState Slicing | 低 (199行类型) | 低 | P3 |
| mcp/client.ts 分解 | 低 (3351行, services/mcp/) | 低 | P3 |
| Output Target | 中 (596个组件, 范围大) | 中-高 | P3 |
| Feature Flag Provider | 低 (181处使用, 30+文件) | 中 | P3 |
| **Swarm/多Agent** | 高 (并行能力, 22文件 7548行) | 高 | **P3** |
| **IDE/LSP 集成** | 中 (编辑器体验) | 中 | P3 |
| **Server 模式** | 低 (6/11文件为stub, 仅371行有效) | 低 | P4 |
| **Teleport 远程执行** | 中 (远程开发, 约2190行) | 中 | P3 |
| **自动更新/安装器** | 低 (运维, 约3579行) | 低 | P3 |
| **CLI 传输层** | 低 (内部架构, 127文件) | 低 | P3 |

---

## 八、命令系统

```
┌───────────────────────────────────────────────────────────────────┐
│                     用户输入 "/" 触发                               │
│                                                                   │
│  REPL.tsx (用户按 Enter)                                          │
│       │                                                           │
│       ▼                                                           │
│  handlePromptSubmit.ts (610行)                                    │
│       │                                                           │
│       ▼                                                           │
│  processUserInput.ts (605行) ─── 识别 "/" 前缀                    │
│       │                                                           │
│       ▼                                                           │
│  processSlashCommand.tsx (921行) ─── 命令分发器                    │
│       │                                                           │
│       │  解析命令名 + 参数                                         │
│       │  findCommand() → 查找 Command 对象                         │
│       │                                                           │
│       ├──────────────┬──────────────────┬─────────────────┐       │
│       ▼              ▼                  ▼                 ▼       │
│  ┌─────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────┐   │
│  │  local  │  │  local-jsx  │  │    prompt    │  │ 未知命令 │   │
│  │         │  │             │  │              │  │  → 错误  │   │
│  │ load()  │  │  load()     │  │ getPrompt()  │  └──────────┘   │
│  │ →call() │  │  →call()    │  │ → 注入消息   │                  │
│  │ →结果   │  │  → ReactNode│  │ → 发送查询   │                  │
│  └─────────┘  └─────────────┘  └──────────────┘                  │
│       │              │                  │                         │
│       └──────────────┴──────────────────┘                         │
│                      │                                            │
│                      ▼                                            │
│              返回结果给 REPL                                       │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                     命令注册 (src/commands.ts, ~470行)              │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  COMMANDS() ─── 静态注册 ~96 个命令                          │  │
│  │  (71个静态导入 + 条件feature控制 + ~25个INTERNAL_ONLY)       │  │
│  │                                                             │  │
│  │  ┌─ src/commands/ (93个目录, 228文件) ─── 每个命令:          │  │
│  │  │  name, description, aliases, type                       │  │
│  │  │  load: () => import('./impl.js')   ← 懒加载             │  │
│  │  │  isEnabled(), availability                                │  │
│  │  └───────────────────────────────────────────────────────── │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                      +                                            │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  getCommands() ─── 动态源 (合并到最终列表)                    │  │
│  │                                                             │  │
│  │  ├─ getSkillDirCommands()     .claude/commands/ + skills/   │  │
│  │  ├─ getBundledSkills()        内置 skill                    │  │
│  │  ├─ getPluginSkills()         插件 skill                    │  │
│  │  ├─ getPluginCommands()       插件命令                      │  │
│  │  ├─ getWorkflowCommands()     workflow 脚本命令              │  │
│  │  └─ getDynamicSkills()        运行时动态发现                  │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                      │                                            │
│                      ▼                                            │
│  过滤: isEnabled → meetsAvailability → 去重                       │
│                      │                                            │
│                      ▼                                            │
│  findCommand() / getCommand() / hasCommand()                      │
│  (按 name, alias 查找, Fuse.js 模糊匹配)                          │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                     自动补全 (useTypeahead, 1384行)                │
│                                                                   │
│  用户键入 "/"                                                      │
│       │                                                           │
│       ▼                                                           │
│  generateCommandSuggestions() (567行)                             │
│       │                                                           │
│       ▼                                                           │
│  Fuse.js 模糊搜索 ─── 精确 > alias > 前缀 > 模糊                  │
│       │                                                           │
│       ▼                                                           │
│  Ghost Text 补全 / 列表选择 / Tab/Enter 确认                      │
└───────────────────────────────────────────────────────────────────┘

耦合特征:
  ● commands.ts (~470行) 静态导入所有命令, 新增命令必须手动注册
  ● src/commands/ 93个目录 228文件, 每个命令独立目录
  ● processSlashCommand.tsx switch 分发, 新命令类型需改分发器
  ● SkillTool (1109行) 提供第二条路径: 模型直接调用 skill
  ● REMOTE_SAFE_COMMANDS / BRIDGE_SAFE_COMMANDS 硬编码安全列表
```

---

## 九、记忆系统

```
┌───────────────────────────────────────────────────────────────────┐
│                        记忆系统总览                                │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  CLAUDE.md 指令文件 (用户管理)          claudemd.ts (1479行) │  │
│  │                                                             │  │
│  │  加载优先级 (低→高, 后者覆盖前者):                            │  │
│  │  1. Managed   /etc/claude-code/CLAUDE.md                    │  │
│  │  2. User      ~/.claude/CLAUDE.md                           │  │
│  │  3. Project   CLAUDE.md, .claude/CLAUDE.md, .claude/rules/  │  │
│  │  4. Local     CLAUDE.local.md (gitignored)                  │  │
│  │  5. AutoMem   MEMORY.md (agent 管理)                        │  │
│  │  6. TeamMem   MEMORY.md (团队共享)                           │  │
│  │                                                             │  │
│  │  特性:                                                       │  │
│  │  ├─ @include 指令 (递归解析, 最深 5 层)                      │  │
│  │  ├─ frontmatter paths: 条件规则                              │  │
│  │  ├─ HTML 注释剥离, 循环引用防护                               │  │
│  │  └─ MEMORY.md 截断: 200行 / 25KB                            │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  Auto-Memory (Agent 管理)              memdir/ (9文件, 1743行)│  │
│  │                                                             │  │
│  │  存储位置: ~/.claude/projects/<git-root>/memory/             │  │
│  │                                                             │  │
│  │  ┌─────────────────────────────────────────────────────┐    │  │
│  │  │              四类型分类法                              │    │  │
│  │  │                                                     │    │  │
│  │  │  user       用户角色/偏好/知识 (私有)                 │    │  │
│  │  │  feedback   方法指导/纠正/确认 (默认私有)             │    │  │
│  │  │  project   项目工作/目标/决策 (团队共享)              │    │  │
│  │  │  reference  外部系统指针 (团队共享)                    │    │  │
│  │  └─────────────────────────────────────────────────────┘    │  │
│  │                                                             │  │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────┐  │  │
│  │  │ MemoryStore  │  │ MemoryRecall │  │ MemoryExtract    │  │  │
│  │  │ 存储抽象     │  │ 相关性检索   │  │ 后台提取         │  │  │
│  │  │              │  │              │  │                  │  │  │
│  │  │ 写入 .md     │  │ Sonnet 侧查  │  │ 每轮对话后触发   │  │  │
│  │  │ + frontmatter│  │ → 选 5 条最  │  │ → fork subagent  │  │  │
│  │  │ + MEMORY.md  │  │   相关记忆   │  │ → 只读工具+写记忆│  │  │
│  │  └──────────────┘  └──────────────┘  └──────────────────┘  │  │
│  │                                                             │  │
│  │  ┌──────────────────┐                                       │  │
│  │  │ MemoryConsolidate│  autoDream.ts (326行)                 │  │
│  │  │ 合并/清理/修剪    │  后台运行, 防并发锁                  │  │
│  │  └──────────────────┘                                       │  │
│  │                                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐    │  │
│  │  │ extractMemories/ (2文件, 769行)                       │    │  │
│  │  │ 后台异步提取, fork subagent, 只读工具+写记忆          │    │  │
│  │  └──────────────────────────────────────────────────────┘    │  │
│  │                                                             │  │
│  │  ┌──────────────────────────────────────────────────────┐    │  │
│  │  │ teamMemorySync/ (4文件, 2167行)                       │    │  │
│  │  │ 团队记忆同步, 跨会话/跨Agent共享                      │    │  │
│  │  └──────────────────────────────────────────────────────┘    │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │  集成点                                                     │  │
│  │                                                             │  │
│  │  context.ts ─── getMemoryFiles() + getClaudeMds()           │  │
│  │       │                                                     │  │
│  │       ▼                                                     │  │
│  │  每轮对话注入指令上下文                                       │  │
│  │                                                             │  │
│  │  stopHooks.ts ─── handleStopHooks()                        │  │
│  │       │                                                     │  │
│  │       ├─→ executeExtractMemories() (异步提取)               │  │
│  │       └─→ executeAutoDream()        (异步合并)              │  │
│  └─────────────────────────────────────────────────────────────┘  │
│                                                                   │
│  特性门控:                                                        │
│  CLAUDE_CODE_DISABLE_AUTO_MEMORY, autoMemoryEnabled,              │
│  tengu_passport_quail (提取), tengu_moth_copse (附件模式),        │
│  tengu_herring_clock (团队记忆), EXTRACT_MEMORIES, TEAMMEM        │
│                                                                   │
│  总规模: 24文件, 约6330行                                          │
│  ├─ memdir/               (9文件, 1743行)  存储抽象               │
│  ├─ services/autoDream/   (4文件, 552行)   合并/清理              │
│  ├─ services/extractMemories/ (2文件, 769行) 后台提取              │
│  ├─ services/teamMemorySync/  (4文件, 2167行) 团队同步             │
│  ├─ tasks/DreamTask/      (1文件, 157行)   后台任务               │
│  └─ utils/辅助文件        (4文件, ~542行)  检测/操作              │
└───────────────────────────────────────────────────────────────────┘
```

---

## 十、权限系统

```
┌───────────────────────────────────────────────────────────────────┐
│                     权限模式 (PermissionMode)                      │
│                   PermissionMode.ts (141行)                       │
│                                                                   │
│  ┌──────────────┐  Shift+Tab 循环                                 │
│  │   default    │ ←→ acceptEdits ←→ plan ←→ bypassPermissions   │
│  │ (每步确认)   │                  ↑         (YOLO模式)          │
│  └──────────────┘                  │                              │
│                              auto (仅内部)                        │
│                              bubble (子agent)                     │
│                              dontAsk (静默拒绝)                   │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                   权限检查管线 (核心, 1486行)                      │
│                permissions.ts: hasPermissionsToUseToolInner()      │
│                                                                   │
│  Tool 调用请求                                                    │
│       │                                                           │
│  ┌────▼────────────────────────────────────────────────────┐      │
│  │ Step 1: 强制检查 (不可被模式跳过)                         │      │
│  │                                                         │      │
│  │  1a. deny 规则匹配 → 立即拒绝                            │      │
│  │  1b. ask 规则匹配 → 需要确认                             │      │
│  │  1c. tool.checkPermissions() → 工具自检                  │      │
│  │      ├─ 文件工具 → filesystem.ts (1778行)                │      │
│  │      │   读: UNC/Windows/拒绝/工作目录/内部路径          │      │
│  │      │   写: .git/.claude/.bashrc 安全检查               │      │
│  │      └─ Bash → bashPermissions.ts (2621行)               │      │
│  │          子命令级别权限校验                                │      │
│  │  1d. 工具级拒绝                                          │      │
│  │  1e. requiresUserInteraction() → 强制交互                 │      │
│  │  1f. 内容级 ask 规则 (bypass-immune)                      │      │
│  │  1g. 安全路径检查 (.git/ .claude/ .bashrc)               │      │
│  └─────────────────────────────────────────────────────────┘      │
│       │                                                           │
│  ┌────▼────────────────────────────────────────────────────┐      │
│  │ Step 2: 模式决策                                         │      │
│  │                                                         │      │
│  │  2a. bypassPermissions → 放行 (除非被 Step 1 拦截)       │      │
│  │  2b. alwaysAllow 规则匹配 → 放行                        │      │
│  │  2c. 无匹配 → 转为 ask                                   │      │
│  └─────────────────────────────────────────────────────────┘      │
│       │                                                           │
│  ┌────▼────────────────────────────────────────────────────┐      │
│  │ Step 3: 模式后处理                                       │      │
│  │                                                         │      │
│  │  dontAsk   → ask 变 deny (静默拒绝)                     │      │
│  │  auto      → YOLO Classifier (1495行)                   │      │
│  │             ├─ Stage 1: 快速分类 (无 thinking)          │      │
│  │             └─ Stage 2: 深度分析 (chain-of-thought)     │      │
│  │  headless  → 先跑 PermissionRequest hooks, 再 auto-deny│      │
│  └─────────────────────────────────────────────────────────┘      │
│       │                                                           │
│       ▼                                                           │
│  结果: allow / deny / ask                                         │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                   规则来源 (优先级从低到高)                         │
│                permissionSetup.ts (1533行)                        │
│                                                                   │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │ userSettings   │  │ projectSettings │  │ localSettings    │   │
│  │ ~/.claude/     │  │ .claude/        │  │ .claude/local    │   │
│  │ settings.json  │  │ settings.json   │  │ settings.json    │   │
│  └────────────────┘  └─────────────────┘  └──────────────────┘   │
│  ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐   │
│  │ policySettings │  │ flagSettings    │  │ cliArg           │   │
│  │ (企业管理)     │  │ (GrowthBook)    │  │ --allowed-tools  │   │
│  └────────────────┘  └─────────────────┘  └──────────────────┘   │
│  ┌────────────────┐  ┌─────────────────┐                          │
│  │ command        │  │ session         │                          │
│  │ /permissions   │  │ (临时, "始终允许"│                          │
│  │                │  │  按钮产生)      │                          │
│  └────────────────┘  └─────────────────┘                          │
│                                                                   │
│  规则格式: "Bash(git push:*)", "Edit(.claude/**)"                 │
│  解析: permissionRuleParser.ts (198行)                            │
│  三种行为: allow / deny / ask                                     │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│                   交互式审批流 (竞速模式)                           │
│                interactiveHandler.ts (536行)                      │
│                                                                   │
│  ask 结果到达                                                     │
│       │                                                           │
│       ▼                                                           │
│  推送 ToolUseConfirm 到 React 确认队列                            │
│       │                                                           │
│       ├─────────────┬──────────────┬──────────────┐               │
│       ▼             ▼              ▼              ▼               │
│  ┌──────────┐ ┌──────────┐ ┌──────────────┐ ┌──────────────┐    │
│  │ Terminal │ │  Bridge  │ │ Channel Relay│ │ Hooks        │    │
│  │ 本地 Y/N │ │ claude.ai│ │ Telegram/IM  │ │ 外部程序审批  │    │
│  └──────────┘ └──────────┘ └──────────────┘ └──────────────┘    │
│       │             │              │              │               │
│       └─────────────┴──────────────┴──────────────┘               │
│                          │                                        │
│              createResolveOnce 原子竞争                            │
│              第一个响应者胜出                                       │
└───────────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────────┐
│  ToolPermissionContext (核心状态对象)                              │
│  存储于 AppState.toolPermissionContext                            │
│                                                                   │
│  ├─ mode: PermissionMode                                         │
│  ├─ additionalWorkingDirectories: Map                             │
│  ├─ alwaysAllowRules: { [source]: string[] }                     │
│  ├─ alwaysDenyRules: { [source]: string[] }                      │
│  ├─ alwaysAskRules: { [source]: string[] }                       │
│  ├─ isBypassPermissionsModeAvailable: boolean                    │
│  ├─ isAutoModeAvailable?: boolean                                │
│  ├─ strippedDangerousRules?: { [source]: string[] }              │
│  ├─ shouldAvoidPermissionPrompts?: boolean                       │
│  └─ prePlanMode?: PermissionMode                                 │
└───────────────────────────────────────────────────────────────────┘

当前问题:
  ● 权限逻辑集中在 src/utils/permissions/ (24文件, 9416行)
  ● 核心文件: permissions.ts (1486行), permissionSetup.ts (1533行)
  ● filesystem.ts (1778行) 文件工具权限, yoloClassifier.ts (1495行) AI分类
  ● bashPermissions 不在 bash/ 目录, bash分类逻辑在 permissions/bashClassifier.ts
  ● 规则来源 7 种, 优先级隐含在加载顺序中
  ● UI 组件 src/components/permissions/ (79文件) 与逻辑混合
```
