# DEV-LOG

## Computer Use Windows 增强：窗口绑定截图 + UI Automation + OCR (2026-04-03)

在三平台基础实现之上，利用 Windows 原生 API 增强 Computer Use 的 Windows 专属能力。

**新增文件：**

| 文件 | 行数 | 说明 |
|------|------|------|
| `src/utils/computerUse/win32/windowCapture.ts` | — | `PrintWindow` 窗口绑定截图，支持被遮挡/后台窗口 |
| `src/utils/computerUse/win32/windowEnum.ts` | — | `EnumWindows` 精确窗口枚举（HWND + PID + 标题） |
| `src/utils/computerUse/win32/uiAutomation.ts` | — | `IUIAutomation` UI 元素树读取、按钮点击、文本写入、坐标识别 |
| `src/utils/computerUse/win32/ocr.ts` | — | `Windows.Media.Ocr` 截图+文字识别（英语+中文） |

**修改文件：**

| 文件 | 变更 |
|------|------|
| `packages/@ant/computer-use-swift/src/backends/win32.ts` | `listRunning` 改用 EnumWindows；新增 `captureWindowTarget` 窗口级截图 |

**验证结果（Windows x64）：**
- 窗口枚举：38 个可见窗口 ✅
- 窗口截图：VS Code 2575x1415, 444KB ✅（PrintWindow, 即使被遮挡）
- UI Automation：坐标元素识别 ✅
- OCR：识别 VS Code 界面文字，34 行 ✅

---

## Enable Computer Use — macOS + Windows + Linux (2026-04-03)

恢复 Computer Use 屏幕操控功能。参考项目仅 macOS，本次扩展为三平台支持。

**Phase 1 — MCP server stub 替换：**
从参考项目复制 `@ant/computer-use-mcp` 完整实现（12 文件，6517 行）。

**Phase 2 — 移除 src/ 中 8 处 macOS 硬编码：**

| 文件 | 改动 |
|------|------|
| `src/main.tsx:1605` | 去掉 `getPlatform() === 'macos'` |
| `src/utils/computerUse/swiftLoader.ts` | 移除 darwin-only throw |
| `src/utils/computerUse/executor.ts` | 平台守卫扩展为 darwin+win32+linux；剪贴板按平台分发（pbcopy→PowerShell→xclip）；paste 快捷键 command→ctrl |
| `src/utils/computerUse/drainRunLoop.ts` | 非 darwin 直接执行 fn() |
| `src/utils/computerUse/escHotkey.ts` | 非 darwin 返回 false（Ctrl+C fallback） |
| `src/utils/computerUse/hostAdapter.ts` | 非 darwin 权限检查返回 granted |
| `src/utils/computerUse/common.ts` | platform + screenshotFiltering 动态化 |
| `src/utils/computerUse/gates.ts` | enabled:true + hasRequiredSubscription→true |

**Phase 3 — input/swift 包 dispatcher + backends 三平台架构：**

```
packages/@ant/computer-use-{input,swift}/src/
├── index.ts          ← dispatcher
├── types.ts          ← 共享接口
└── backends/
    ├── darwin.ts      ← macOS AppleScript（原样拆出，不改逻辑）
    ├── win32.ts       ← Windows PowerShell
    └── linux.ts       ← Linux xdotool/scrot/xrandr/wmctrl
```

**编译开关：** `CHICAGO_MCP` 加入 DEFAULT_FEATURES + DEFAULT_BUILD_FEATURES

**验证结果（Windows x64）：**
- `isSupported: true` ✅
- 鼠标定位 + 前台窗口信息 ✅
- 双显示器检测 2560x1440 × 2 ✅
- 全屏截图 3MB base64 ✅
- `bun run build` 463 files ✅

---

## Enable Remote Control / BRIDGE_MODE (2026-04-03)

**PR**: [claude-code-best/claude-code#60](https://github.com/claude-code-best/claude-code/pull/60)

Remote Control 功能将本地 CLI 注册为 bridge 环境，生成可分享的 URL（`https://claude.ai/code/session_xxx`），允许从浏览器、手机或其他设备远程查看输出、发送消息、审批工具调用。

**改动文件：**

| 文件 | 变更 |
|------|------|
| `scripts/dev.ts` | `DEFAULT_FEATURES` 加入 `"BRIDGE_MODE"`，dev 模式默认启用 |
| `src/bridge/peerSessions.ts` | stub → 完整实现：通过 bridge API 发送跨会话消息，含三层安全防护（trim + validateBridgeId 白名单 + encodeURIComponent） |
| `src/bridge/webhookSanitizer.ts` | stub → 完整实现：正则 redact 8 类 secret（GitHub/Anthropic/AWS/npm/Slack token），先 redact 再截断，失败返回安全占位符 |
| `src/entrypoints/sdk/controlTypes.ts` | 12 个 `any` stub → `z.infer<ReturnType<typeof XxxSchema>>` 从现有 Zod schema 推导类型 |
| `src/hooks/useReplBridge.tsx` | `tengu_bridge_system_init` 默认值 `false` → `true`，使 app 端显示 "active" 而非卡在 "connecting" |

**关键设计决策：**

1. **不改现有代码逻辑** — 只补全 stub、修正默认值、开启编译开关
2. **`tengu_bridge_system_init`** — Anthropic 通过 GrowthBook 给订阅用户推送 `true`，但我们的 build 收不到推送；改默认值是唯一不侵入其他代码的方案
3. **`peerSessions.ts` 认证** — 使用 `getBridgeAccessToken()` 获取 OAuth Bearer token，与 `bridgeApi.ts`/`codeSessionApi.ts` 认证模式一致
4. **`webhookSanitizer.ts` 安全** — fail-closed（出错返回 `[webhook content redacted due to sanitization error]`），不泄露原始内容

**验证结果：**

- `/remote-control` 命令可见且可用
- CLI 连接 Anthropic CCR，生成可分享 URL
- App 端（claude.ai/code）显示 "Remote Control active"
- 手机端（Claude iOS app）通过 URL 连接，双向消息正常

![Remote Control on Mobile](docs/images/remote-control-mobile.png)

---

## GrowthBook 自定义服务器适配器 (2026-04-03)

GrowthBook 功能开关系统原为 Anthropic 内部构建设计，硬编码 SDK key 和 API 地址，外部构建因 `is1PEventLoggingEnabled()` 门控始终禁用。新增适配器模式，通过环境变量连接自定义 GrowthBook 服务器，无配置时所有 feature 读取返回代码默认值。

**修改文件：**

| 文件 | 变更 |
|------|------|
| `src/constants/keys.ts` | `getGrowthBookClientKey()` 优先读取 `CLAUDE_GB_ADAPTER_KEY` 环境变量 |
| `src/services/analytics/growthbook.ts` | `isGrowthBookEnabled()` 适配器模式下直接返回 `true`，绕过 1P event logging 门控 |
| `src/services/analytics/growthbook.ts` | `getGrowthBookClient()` base URL 优先使用 `CLAUDE_GB_ADAPTER_URL` |
| `docs/internals/growthbook-adapter.mdx` | 新增适配器配置文档，含全部 ~58 个 feature key 列表 |

**用法：** `CLAUDE_GB_ADAPTER_URL=https://gb.example.com/ CLAUDE_GB_ADAPTER_KEY=sdk-xxx bun run dev`

---

## Datadog 日志端点可配置化 (2026-04-03)

将 Datadog 硬编码的 Anthropic 内部端点改为环境变量驱动，默认禁用。

**修改文件：**

| 文件 | 变更 |
|------|------|
| `src/services/analytics/datadog.ts` | `DATADOG_LOGS_ENDPOINT` 和 `DATADOG_CLIENT_TOKEN` 从硬编码常量改为读取 `process.env.DATADOG_LOGS_ENDPOINT` / `process.env.DATADOG_API_KEY`，默认空字符串；`initializeDatadog()` 增加守卫：端点或 Token 未配置时直接返回 `false` |
| `docs/telemetry-remote-config-audit.md` | 更新第 1 节，反映新的环境变量配置方式 |

**效果：** 默认不向任何外部发送数据；设置两个环境变量即可接入自己的 Datadog 实例。原有 `DISABLE_TELEMETRY`、privacy level、sink killswitch 等防线保留。

**用法：** `DATADOG_LOGS_ENDPOINT=https://http-intake.logs.datadoghq.com/api/v2/logs DATADOG_API_KEY=xxx bun run dev`

---

## Sentry 错误上报集成 (2026-04-03)

恢复反编译过程中被移除的 Sentry 集成。通过 `SENTRY_DSN` 环境变量控制，未设置时所有函数为 no-op，不影响正常运行。

**新增文件：**

| 文件 | 说明 |
|------|------|
| `src/utils/sentry.ts` | 核心模块：`initSentry()`、`captureException()`、`setTag()`、`setUser()`、`closeSentry()`；`beforeSend` 过滤 auth headers 等敏感信息；忽略 ECONNREFUSED/AbortError 等非 actionable 错误 |

**修改文件：**

| 文件 | 变更 |
|------|------|
| `src/utils/errorLogSink.ts` | `logErrorImpl` 末尾调用 `captureException()`，所有经 `logError()` 的错误自动上报 |
| `src/components/SentryErrorBoundary.ts` | 添加 `componentDidCatch`，React 组件渲染错误上报到 Sentry（含 componentStack） |
| `src/entrypoints/init.ts` | 网络配置后调用 `initSentry()` |
| `src/utils/gracefulShutdown.ts` | 优雅关闭时 flush Sentry 事件 |
| `src/screens/REPL.tsx:2809` | `fireCompanionObserver` 调用增加 `typeof` 防护，BUDDY feature 启用时不报错（TODO: 待实现） |
| `package.json` | devDependencies 新增 `@sentry/node` |

**用法：** `SENTRY_DSN=https://xxx@xxx.ingest.sentry.io/xxx bun run dev`

---

## 默认关闭自动更新 (2026-04-03)

修改 `src/utils/config.ts` — `getAutoUpdaterDisabledReason()`，在原有检查逻辑前插入默认关闭逻辑。未设置 `ENABLE_AUTOUPDATER=1` 时，自动更新始终返回 `{ type: 'config' }` 被禁用。

**启用方式：** `ENABLE_AUTOUPDATER=1 bun run dev`

**原因：** 本项目为逆向工程/反编译版本，自动更新会覆盖本地修改的代码。

**同时新增文档：** `docs/auto-updater.md` — 自动更新机制完整审计，涵盖三种安装类型的更新策略、后台轮询、版本门控、原生安装器架构、文件锁、配置项等。

---

## WebSearch Bing 适配器补全 (2026-04-03)

原始 `WebSearchTool` 仅支持 Anthropic API 服务端搜索（`web_search_20250305` server tool），在非官方 API 端点（第三方代理）下搜索功能不可用。本次改动引入适配器架构，新增 Bing 搜索页面解析作为 fallback。

**新增文件：**

| 文件 | 说明 |
|------|------|
| `src/tools/WebSearchTool/adapters/types.ts` | 适配器接口定义：`WebSearchAdapter`、`SearchResult`、`SearchOptions`、`SearchProgress` |
| `src/tools/WebSearchTool/adapters/apiAdapter.ts` | API 适配器 — 将原有 `queryModelWithStreaming` 逻辑封装为 `ApiSearchAdapter` |
| `src/tools/WebSearchTool/adapters/bingAdapter.ts` | Bing 适配器 — 直接抓取 Bing HTML，正则提取搜索结果 |
| `src/tools/WebSearchTool/adapters/index.ts` | 适配器工厂 — 根据环境变量 / API Base URL 选择后端 |
| `src/tools/WebSearchTool/__tests__/bingAdapter.test.ts` | Bing 适配器单元测试（32 cases：decodeHtmlEntities、extractBingResults、search mock） |
| `src/tools/WebSearchTool/__tests__/bingAdapter.integration.ts` | Bing 适配器集成测试 — 真实网络请求验证 |

**重构文件：**

| 文件 | 变更 |
|------|------|
| `src/tools/WebSearchTool/WebSearchTool.ts` | 从直接调用 API 改为 `createAdapter()` 工厂模式；`isEnabled()` 始终返回 true；删除 ~200 行内联 API 调用逻辑 |
| `src/tools/WebFetchTool/utils.ts` | `skipWebFetchPreflight` 默认值从 `!undefined`（即 true）改为显式 `=== false`，使域名预检默认启用 |

**Bing 适配器关键技术细节：**

1. **反爬绕过**：使用完整 Edge 浏览器请求头（含 `Sec-Ch-Ua`、`Sec-Fetch-*` 等 13 个标头），避免 Bing 返回 JS 渲染的空页面；`setmkt=en-US` 参数强制美式英语市场，避免 IP 地理定位导致的区域化结果（德语论坛、新加坡金价等不相关内容）
2. **URL 解码**（`resolveBingUrl()`）：Bing 返回的重定向 URL（`bing.com/ck/a?...&u=a1aHR0cHM6Ly9...`）中 `u` 参数为 base64 编码的真实 URL，需解码后使用
3. **摘要提取**（`extractSnippet()`）：三级降级策略 — `b_lineclamp` → `b_caption <p>` → `b_caption` 直接文本
4. **HTML 实体解码**（`decodeHtmlEntities()`）：处理 7 种常见 HTML 实体
5. **域过滤**：客户端侧 `allowedDomains` / `blockedDomains` 过滤，支持子域名匹配

**当前状态**：`adapters/index.ts` 中 `createAdapter()` 硬编码返回 `BingSearchAdapter`，跳过了 API/Bing 自动选择逻辑（原逻辑被注释保留）。未来可通过取消注释恢复自动选择。

---

## 移除反蒸馏机制 (2026-04-02)

项目中发现三处 anti-distillation 相关代码，全部移除。

**移除内容：**
- `src/services/api/claude.ts` — 删除 fake_tools 注入逻辑（原第 302-314 行），该代码通过 `ANTI_DISTILLATION_CC` feature flag 在 API 请求中注入 `anti_distillation: ['fake_tools']`，使服务端在响应中混入虚假工具调用以污染蒸馏数据
- `src/utils/betas.ts` — 删除 connector-text summarization beta 注入块及 `SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER` 导入，该机制让服务端缓冲工具调用间的 assistant 文本并摘要化返回
- `src/constants/betas.ts` — 删除 `SUMMARIZE_CONNECTOR_TEXT_BETA_HEADER` 常量定义（原第 23-25 行）
- `src/utils/streamlinedTransform.ts` — 注释从 "distillation-resistant" 改为 "compact"，streamlined 模式本身是有效的输出压缩功能，仅修正描述

---

## Buddy 命令合入 + Feature Flag 规范修正 (2026-04-02)

合入 `pr/smallflyingpig/36` 分支（支持 buddy 命令 + 修复 rehatch），并修正 feature flag 使用方式。

**合入内容（来自 PR）：**
- `src/commands/buddy/buddy.ts` — 新增 `/buddy` 命令，支持 hatch / rehatch / pet / mute / unmute 子命令
- `src/commands/buddy/index.ts` — 从 stub 改为正确的 `Command` 类型导出
- `src/buddy/companion.ts` — 新增 `generateSeed()`，`getCompanion()` 支持 seed 驱动的可复现 rolling
- `src/buddy/types.ts` — `CompanionSoul` 增加 `seed?` 字段

**合并后修正：**
- `src/entrypoints/cli.tsx` — PR 硬编码了 `const feature = (name) => name === "BUDDY"`，违反 feature flag 规范，恢复为标准 `import { feature } from 'bun:bundle'`
- `src/commands.ts` — PR 用静态 `import buddy` 绕过了 feature gate，恢复为 `feature('BUDDY') ? require(...) : null` + 条件展开
- `src/commands/buddy/buddy.ts` — 删除未使用的 `companionInfoText` 函数和多余的 `Roll`/`SPECIES` import
- `CLAUDE.md` — 重写 Feature Flag System 章节，明确规范：代码中统一用 `import { feature } from 'bun:bundle'`，启用走环境变量 `FEATURE_<NAME>=1`

**用法：** `FEATURE_BUDDY=1 bun run dev`

---

## Auto Mode 补全 (2026-04-02)

反编译丢失了 auto mode 分类器的三个 prompt 模板文件，代码逻辑完整但无法运行。

**新增：**
- `yolo-classifier-prompts/auto_mode_system_prompt.txt` — 主系统提示词
- `yolo-classifier-prompts/permissions_external.txt` — 外部权限模板（用户规则替换默认值）
- `yolo-classifier-prompts/permissions_anthropic.txt` — 内部权限模板（用户规则追加）

**改动：**
- `scripts/dev.ts` + `build.ts` — 扫描 `FEATURE_*` 环境变量注入 Bun `--feature`
- `cli.tsx` — 启动时打印已启用的 feature
- `permissionSetup.ts` — `AUTO_MODE_ENABLED_DEFAULT` 由 `feature('TRANSCRIPT_CLASSIFIER')` 决定，开 feature 即开 auto mode
- `docs/safety/auto-mode.mdx` — 补充 prompt 模板章节

**用法：** `FEATURE_TRANSCRIPT_CLASSIFIER=1 bun run dev`

**注意：** prompt 模板为重建产物。

---

## USER_TYPE=ant TUI 修复 (2026-04-02)

`global.d.ts` 声明的全局函数在反编译版本运行时未定义，导致 `USER_TYPE=ant` 时 TUI 崩溃。

修复方式：显式 import / 本地 stub / 全局 stub / 新建 stub 文件。涉及文件：
`cli.tsx`, `model.ts`, `context.ts`, `effort.ts`, `thinking.ts`, `undercover.ts`, `Spinner.tsx`, `AntModelSwitchCallout.tsx`(新建), `UndercoverAutoCallout.tsx`(新建)

注意：
- `USER_TYPE=ant` 启用 alt-screen 全屏模式，中心区域满屏是预期行为
- `global.d.ts` 中剩余未 stub 的全局函数（`getAntModels` 等）遇到 `X is not defined` 时按同样模式处理

---

## /login 添加 Custom Platform 选项 (2026-04-03)

在 `/login` 命令的登录方式选择列表中新增 "Custom Platform" 选项（位于第一位），允许用户直接在终端配置第三方 API 兼容服务的 Base URL、API Key 和三种模型映射，保存到 `~/.claude/settings.json`。

**修改文件：**

| 文件 | 变更 |
|------|------|
| `src/components/ConsoleOAuthFlow.tsx` | `OAuthStatus` 类型新增 `custom_platform` state（含 `baseUrl`、`apiKey`、`haikuModel`、`sonnetModel`、`opusModel`、`activeField`）；`idle` case Select 选项新增 Custom Platform 并排第一位；新增 `custom_platform` case 渲染 5 字段表单（Tab/Shift+Tab 切换、focus 高亮、Enter 跳转/保存）；Select onChange 处理 `custom_platform` 初始状态（从 `process.env` 预填当前值）；`OAuthStatusMessageProps` 类型及调用处新增 `onDone` prop |
| `src/components/ConsoleOAuthFlow.tsx` | 新增 `updateSettingsForSource` import |

**UI 交互：**
- 5 个字段同屏：Base URL、API Key、Haiku Model、Sonnet Model、Opus Model
- 当前活动字段的标签用 `suggestion` 背景色 + `inverseText` 反色高亮
- Tab / Shift+Tab 在字段间切换，各自保留输入值
- 每个字段按 Enter 跳到下一个，最后一个字段 (Opus) 按 Enter 保存
- 模型字段自动从 `process.env` 读取当前配置作为预填值，无值则空
- 保存时调用 `updateSettingsForSource('userSettings', { env })` 写入 settings.json，同时更新 `process.env`

**保存的 settings.json env 字段：**
```json
{
  "ANTHROPIC_BASE_URL": "...",
  "ANTHROPIC_AUTH_TOKEN": "...",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL": "...",
  "ANTHROPIC_DEFAULT_SONNET_MODEL": "...",
  "ANTHROPIC_DEFAULT_OPUS_MODEL": "..."
}
```

非空字段才写入，保存后立即生效（`onDone()` 触发 `onChangeAPIKey()` 刷新 API 客户端）。
