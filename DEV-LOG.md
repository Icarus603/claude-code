# DEV-LOG

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
