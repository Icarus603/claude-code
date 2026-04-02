# Testing Specification

本文档定义了 claude-code 项目的测试规范，作为编写和维护测试代码的统一标准。

## 1. 测试目标

| 目标 | 说明 |
|------|------|
| **防止回归** | 确保已有功能不被新改动破坏，每次 PR 必须通过全部测试 |
| **验证核心流程** | 覆盖 CLI 核心交互流程：Tool 调用链、Context 构建、消息处理 |
| **文档化行为** | 通过测试用例记录各模块的预期行为，作为活文档供开发者参考 |

## 2. 技术栈

| 项 | 选型 | 说明 |
|----|------|------|
| 测试框架 | `bun:test` | Bun 内置，零配置，与运行时一致 |
| 断言库 | `bun:test` 内置 `expect` | 兼容 Jest `expect` API |
| Mock | `bun:test` 内置 `mock`/`spyOn` | 配合手动 mock fixtures |
| 覆盖率 | `bun test --coverage` | 内置覆盖率报告 |

## 3. 测试层次

本项目采用 **单元测试 + 集成测试** 两层结构，不做 E2E 或快照测试。

### 3.1 单元测试

- **对象**：纯函数、工具类、解析器、独立模块
- **特征**：无外部依赖、执行快、可并行
- **示例场景**：
  - `src/utils/array.ts` — 数组操作函数
  - `src/utils/path.ts` — 路径解析
  - `src/utils/diff.ts` — diff 算法
  - `src/utils/permissions/` — 权限判断逻辑
  - `src/utils/model/` — 模型选择与 provider 路由
  - Tool 的 `inputSchema` 校验逻辑

### 3.2 集成测试

- **对象**：多模块协作流程
- **特征**：可能需要 mock 外部服务（API、文件系统），测试模块间协作
- **示例场景**：
  - Tool 调用链：`tools.ts` 注册 → `findToolByName` → tool `call()` 执行
  - Context 构建：`context.ts` 组装系统提示（CLAUDE.md 加载 + git status + 日期）
  - 消息处理管线：用户输入 → 消息格式化 → API 请求构建

## 4. 文件结构

采用 **混合模式**：单元测试就近放置，集成测试集中管理。

```
src/
├── utils/
│   ├── array.ts
│   ├── __tests__/              # 单元测试：就近放置
│   │   ├── array.test.ts
│   │   ├── set.test.ts
│   │   └── path.test.ts
│   ├── model/
│   │   ├── providers.ts
│   │   └── __tests__/
│   │       └── providers.test.ts
│   └── permissions/
│       ├── index.ts
│       └── __tests__/
│           └── permissions.test.ts
├── tools/
│   ├── BashTool/
│   │   ├── index.ts
│   │   └── __tests__/
│   │       └── BashTool.test.ts
│   └── FileEditTool/
│       ├── index.ts
│       └── __tests__/
│           └── FileEditTool.test.ts
tests/                          # 集成测试：集中管理
├── integration/
│   ├── tool-chain.test.ts
│   ├── context-build.test.ts
│   └── message-pipeline.test.ts
├── mocks/                      # 通用 mock / fixtures
│   ├── api-responses.ts        # Claude API mock 响应
│   ├── file-system.ts          # 文件系统 mock 工具
│   └── fixtures/
│       ├── sample-claudemd.md
│       └── sample-messages.json
└── helpers/                    # 测试辅助函数
    └── setup.ts
```

### 命名规则

| 项 | 规则 |
|----|------|
| 测试文件 | `<module-name>.test.ts` |
| 测试目录 | `__tests__/`（单元）、`tests/integration/`（集成） |
| Fixture 文件 | `tests/mocks/fixtures/` 下按用途命名 |
| Helper 文件 | `tests/helpers/` 下按功能命名 |

## 5. 命名与编写规范

### 5.1 命名风格

使用 `describe` + `it`/`test` 英文描述：

```typescript
import { describe, expect, test } from "bun:test";

describe("findToolByName", () => {
  test("returns the tool when name matches exactly", () => {
    // ...
  });

  test("returns undefined when no tool matches", () => {
    // ...
  });

  test("is case-insensitive for tool name lookup", () => {
    // ...
  });
});
```

### 5.2 describe 块组织原则

- 顶层 `describe` 对应被测函数/类/模块名
- 可嵌套 `describe` 对分支场景分组（如 `describe("when input is empty", ...)`)
- 每个 `test` 应测试一个行为，命名采用 **"动作 + 预期结果"** 格式

### 5.3 编写原则

| 原则 | 说明 |
|------|------|
| **Arrange-Act-Assert** | 每个测试分三段：准备数据、执行操作、验证结果 |
| **单一职责** | 一个 `test` 只验证一个行为 |
| **独立性** | 测试之间无顺序依赖，无共享可变状态 |
| **可读性优先** | 测试代码是文档，宁可重复也不过度抽象 |
| **边界覆盖** | 空值、边界值、异常输入必须覆盖 |

### 5.4 异步测试

```typescript
test("reads file content correctly", async () => {
  const content = await readFile("/tmp/test.txt");
  expect(content).toContain("expected");
});
```

## 6. Mock 策略

采用 **混合管理**：通用 mock 集中于 `tests/mocks/`，专用 mock 就近定义。

### 6.1 Claude API Mock（集中管理）

所有 API 测试全部使用 mock，不调用真实 API。

```typescript
// tests/mocks/api-responses.ts
export const mockStreamResponse = {
  type: "message_start",
  message: {
    id: "msg_mock_001",
    type: "message",
    role: "assistant",
    content: [],
    model: "claude-sonnet-4-20250514",
    // ...
  },
};

export const mockToolUseResponse = {
  type: "content_block_start",
  content_block: {
    type: "tool_use",
    id: "toolu_mock_001",
    name: "Read",
    input: { file_path: "/tmp/test.txt" },
  },
};
```

### 6.2 模块级 Mock（就近定义）

```typescript
import { mock } from "bun:test";

// mock 整个模块
mock.module("src/services/api/claude.ts", () => ({
  createApiClient: () => ({
    stream: mock(() => mockStreamResponse),
  }),
}));
```

### 6.3 文件系统 Mock

对于需要文件系统交互的测试，使用临时目录：

```typescript
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll } from "bun:test";

let tempDir: string;

beforeAll(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "claude-test-"));
});

afterAll(async () => {
  await rm(tempDir, { recursive: true });
});
```

## 7. 优先测试模块

按优先级从高到低排列，括号内为目标覆盖率：

### P0 — 核心（行覆盖率 >= 80%）

| 模块 | 路径 | 测试重点 |
|------|------|----------|
| **Tool 系统** | `src/tools/`, `src/Tool.ts`, `src/tools.ts` | tool 注册/发现、inputSchema 校验、call() 执行与错误处理 |
| **工具函数** | `src/utils/` 下纯函数 | 各种 utility 的正确性与边界情况 |
| **Context 构建** | `src/context.ts`, `src/utils/claudemd.ts` | 系统提示拼装、CLAUDE.md 发现与加载、context 内容完整性 |

### P1 — 重要（行覆盖率 >= 60%）

| 模块 | 路径 | 测试重点 |
|------|------|----------|
| **权限系统** | `src/utils/permissions/` | 权限模式判断、tool 许可/拒绝逻辑 |
| **模型路由** | `src/utils/model/` | provider 选择、模型名映射、fallback 逻辑 |
| **消息处理** | `src/types/message.ts`, `src/utils/messages.ts` | 消息类型构造、格式化、过滤 |
| **CLI 参数** | `src/main.tsx` 中的 Commander 配置 | 参数解析、模式切换（REPL/pipe） |

### P2 — 补充

| 模块 | 路径 | 测试重点 |
|------|------|----------|
| **Cron 调度** | `src/utils/cron*.ts` | cron 表达式解析、任务调度逻辑 |
| **Git 工具** | `src/utils/git.ts` | git 命令构造、输出解析 |
| **Config** | `src/utils/config.ts`, `src/utils/settings/` | 配置加载、合并、默认值 |

## 8. 覆盖率要求

| 范围 | 目标 | 说明 |
|------|------|------|
| P0 核心模块 | **>= 80%** 行覆盖率 | Tool 系统、工具函数、Context 构建 |
| P1 重要模块 | **>= 60%** 行覆盖率 | 权限、模型路由、消息处理 |
| 整体 | 不设强制指标 | 逐步提升，不追求数字 |

运行覆盖率报告：

```bash
bun test --coverage
```

## 9. CI 集成

已有 GitHub Actions 配置（`.github/workflows/ci.yml`），`bun test` 步骤已就位。

### CI 中测试的运行条件

- **push** 到 `main` 或 `feature/*` 分支时自动运行
- **pull_request** 到 `main` 分支时自动运行
- 测试失败将阻止合并

### 本地运行

```bash
# 运行全部测试
bun test

# 运行特定文件
bun test src/utils/__tests__/array.test.ts

# 运行匹配模式
bun test --filter "findToolByName"

# 带覆盖率
bun test --coverage

# watch 模式（开发时）
bun test --watch
```

## 10. 编写测试 Checklist

每次新增或修改测试时，确认以下事项：

- [ ] 测试文件位置正确（单元 → `__tests__/`，集成 → `tests/integration/`）
- [ ] 命名遵循 `describe` + `test` 英文格式
- [ ] 每个 test 只验证一个行为
- [ ] 覆盖了正常路径、边界情况和错误情况
- [ ] 无硬编码的绝对路径或系统特定值
- [ ] Mock 使用得当（通用 → `tests/mocks/`，专用 → 就近）
- [ ] 测试可独立运行，无顺序依赖
- [ ] `bun test` 本地全部通过后再提交

## 11. 当前测试覆盖状态

> 更新日期：2026-04-02 | 总计：**1177 tests, 64 files, 0 failures**

### P0 — 核心模块

| 测试计划 | 测试文件 | 测试数 | 覆盖范围 |
|----------|----------|--------|----------|
| 01 - Tool 系统 | `src/__tests__/Tool.test.ts` | 25 | buildTool, toolMatchesName, findToolByName, getEmptyToolPermissionContext, filterToolProgressMessages |
| | `src/__tests__/tools.test.ts` | 10 | parseToolPreset, filterToolsByDenyRules |
| | `src/tools/shared/__tests__/gitOperationTracking.test.ts` | 16 | parseGitCommitId, detectGitOperation |
| | `src/tools/FileEditTool/__tests__/utils.test.ts` | 24 | normalizeQuotes, stripTrailingWhitespace, findActualString, preserveQuoteStyle, applyEditToFile |
| 02 - Utils 纯函数 | `src/utils/__tests__/array.test.ts` | 12 | intersperse, count, uniq |
| | `src/utils/__tests__/set.test.ts` | 12 | difference, intersects, every, union |
| | `src/utils/__tests__/xml.test.ts` | 9 | escapeXml, escapeXmlAttr |
| | `src/utils/__tests__/hash.test.ts` | 12 | djb2Hash, hashContent, hashPair |
| | `src/utils/__tests__/stringUtils.test.ts` | 35 | escapeRegExp, capitalize, plural, firstLineOf, countCharInString, normalizeFullWidthDigits/Space, safeJoinLines, EndTruncatingAccumulator, truncateToLines |
| | `src/utils/__tests__/semver.test.ts` | 21 | gt, gte, lt, lte, satisfies, order |
| | `src/utils/__tests__/uuid.test.ts` | 6 | validateUuid |
| | `src/utils/__tests__/format.test.ts` | 24 | formatFileSize, formatSecondsShort, formatDuration, formatNumber, formatTokens, formatRelativeTime |
| | `src/utils/__tests__/frontmatterParser.test.ts` | 28 | parseFrontmatter, splitPathInFrontmatter, parsePositiveIntFromFrontmatter, parseBooleanFrontmatter, parseShellFrontmatter |
| | `src/utils/__tests__/file.test.ts` | 17 | convertLeadingTabsToSpaces, addLineNumbers, stripLineNumberPrefix, normalizePathForComparison, pathsEqual |
| | `src/utils/__tests__/glob.test.ts` | 6 | extractGlobBaseDirectory |
| | `src/utils/__tests__/diff.test.ts` | 8 | adjustHunkLineNumbers, getPatchFromContents |
| | `src/utils/__tests__/json.test.ts` | 27 | safeParseJSON, safeParseJSONC, parseJSONL, addItemToJSONCArray (mock log.ts) |
| | `src/utils/__tests__/truncate.test.ts` | 24 | truncateToWidth, truncateStartToWidth, truncateToWidthNoEllipsis, truncatePathMiddle, truncate, wrapText |
| | `src/utils/__tests__/path.test.ts` | 15 | containsPathTraversal, normalizePathForConfigKey |
| | `src/utils/__tests__/tokens.test.ts` | 22 | getTokenCountFromUsage, getTokenUsage, tokenCountFromLastAPIResponse, messageTokenCountFromLastAPIResponse, getCurrentUsage, doesMostRecentAssistantMessageExceed200k, getAssistantMessageContentLength (mock log.ts, tokenEstimation, slowOperations) |
| 03 - Context 构建 | `src/utils/__tests__/claudemd.test.ts` | 16 | stripHtmlComments, isMemoryFilePath, getLargeMemoryFiles |
| | `src/utils/__tests__/systemPrompt.test.ts` | 9 | buildEffectiveSystemPrompt |

### P1 — 重要模块

| 测试计划 | 测试文件 | 测试数 | 覆盖范围 |
|----------|----------|--------|----------|
| 04 - 权限系统 | `src/utils/permissions/__tests__/permissionRuleParser.test.ts` | 25 | escapeRuleContent, unescapeRuleContent, permissionRuleValueFromString, permissionRuleValueToString, normalizeLegacyToolName |
| | `src/utils/permissions/__tests__/permissions.test.ts` | 13 | getDenyRuleForTool, getAskRuleForTool, getDenyRuleForAgent, filterDeniedAgents (mock log.ts, slowOperations) |
| 05 - 模型路由 | `src/utils/model/__tests__/aliases.test.ts` | 16 | isModelAlias, isModelFamilyAlias |
| | `src/utils/model/__tests__/model.test.ts` | 14 | firstPartyNameToCanonical |
| | `src/utils/model/__tests__/providers.test.ts` | 10 | getAPIProvider, isFirstPartyAnthropicBaseUrl |
| 06 - 消息处理 | `src/utils/__tests__/messages.test.ts` | 56 | createAssistantMessage, createUserMessage, isSyntheticMessage, getLastAssistantMessage, hasToolCallsInLastAssistantTurn, extractTag, isNotEmptyMessage, normalizeMessages, deriveUUID, isClassifierDenial 等 |

### P2 — 补充模块

| 测试计划 | 测试文件 | 测试数 | 覆盖范围 |
|----------|----------|--------|----------|
| 07 - Cron 调度 | `src/utils/__tests__/cron.test.ts` | 38 | parseCronExpression, computeNextCronRun, cronToHuman |
| 08 - Git 工具 | `src/utils/__tests__/git.test.ts` | 18 | normalizeGitRemoteUrl (SSH/HTTPS/ssh:///代理URL/大小写规范化) |
| 09 - 配置与设置 | `src/utils/settings/__tests__/config.test.ts` | 62 | SettingsSchema, PermissionsSchema, AllowedMcpServerEntrySchema, MCP 类型守卫, 设置常量函数, filterInvalidPermissionRules, validateSettingsFileContent, formatZodError |

### P3 — Phase 1 纯函数扩展

| 测试文件 | 测试数 | 覆盖范围 |
|----------|--------|----------|
| `src/utils/__tests__/errors.test.ts` | 28 | ClaudeError, AbortError, ConfigParseError, ShellError, TelemetrySafeError, isAbortError, hasExactErrorMessage, toError, errorMessage, getErrnoCode, isENOENT, getErrnoPath, shortErrorStack, isFsInaccessible, classifyAxiosError |
| `src/utils/permissions/__tests__/shellRuleMatching.test.ts` | 22 | permissionRuleExtractPrefix, hasWildcards, matchWildcardPattern, parsePermissionRule, suggestionForExactCommand, suggestionForPrefix |
| `src/utils/__tests__/argumentSubstitution.test.ts` | 18 | parseArguments, parseArgumentNames, generateProgressiveArgumentHint, substituteArguments |
| `src/utils/__tests__/CircularBuffer.test.ts` | 12 | CircularBuffer class: add, addAll, getRecent, toArray, clear, length |
| `src/utils/__tests__/sanitization.test.ts` | 14 | partiallySanitizeUnicode, recursivelySanitizeUnicode |
| `src/utils/__tests__/slashCommandParsing.test.ts` | 8 | parseSlashCommand |
| `src/utils/__tests__/contentArray.test.ts` | 6 | insertBlockAfterToolResults |
| `src/utils/__tests__/objectGroupBy.test.ts` | 5 | objectGroupBy |

### P4 — Phase 2 轻 Mock 扩展

| 测试文件 | 测试数 | 覆盖范围 |
|----------|--------|----------|
| `src/utils/__tests__/envUtils.test.ts` | 34 | isEnvTruthy, isEnvDefinedFalsy, parseEnvVars, hasNodeOption, getAWSRegion, getDefaultVertexRegion, getVertexRegionForModel, isBareMode, shouldMaintainProjectWorkingDir, getClaudeConfigHomeDir |
| `src/utils/__tests__/sleep.test.ts` | 14 | sleep (abort, throwOnAbort, abortError), withTimeout, sequential |
| `src/utils/__tests__/memoize.test.ts` | 16 | memoizeWithTTL, memoizeWithTTLAsync (dedup/cache/clear), memoizeWithLRU (eviction/cache methods) |
| `src/utils/__tests__/groupToolUses.test.ts` | 10 | applyGrouping (verbose, grouping, result collection, mixed messages) |
| `src/utils/permissions/__tests__/dangerousPatterns.test.ts` | 7 | CROSS_PLATFORM_CODE_EXEC, DANGEROUS_BASH_PATTERNS 常量验证 |
| `src/utils/shell/__tests__/outputLimits.test.ts` | 7 | getMaxOutputLength, BASH_MAX_OUTPUT_UPPER_LIMIT, BASH_MAX_OUTPUT_DEFAULT |

### P5 — Phase 3 补全 + Phase 4 工具模块

| 测试文件 | 测试数 | 覆盖范围 |
|----------|--------|----------|
| `src/utils/__tests__/zodToJsonSchema.test.ts` | 9 | zodToJsonSchema (string/number/object/enum/optional/array/boolean + caching) |
| `src/utils/permissions/__tests__/PermissionMode.test.ts` | 19 | PERMISSION_MODES, permissionModeFromString, permissionModeTitle, permissionModeShortTitle, permissionModeSymbol, getModeColor, isDefaultMode, toExternalPermissionMode, isExternalPermissionMode |
| `src/utils/__tests__/envValidation.test.ts` | 9 | validateBoundedIntEnvVar (default/valid/capped/invalid/boundary) |
| `src/services/mcp/__tests__/mcpStringUtils.test.ts` | 18 | mcpInfoFromString, getMcpPrefix, buildMcpToolName, getMcpDisplayName, getToolNameForPermissionCheck, extractMcpToolDisplayName |
| `src/tools/BashTool/__tests__/destructiveCommandWarning.test.ts` | 22 | getDestructiveCommandWarning (git/rm/database/infrastructure patterns) |
| `src/tools/BashTool/__tests__/commandSemantics.test.ts` | 11 | interpretCommandResult (grep/diff/test/rg/find exit code semantics) |

### P6 — Phase 5 扩展覆盖

| 测试文件 | 测试数 | 覆盖范围 |
|----------|--------|----------|
| `src/utils/__tests__/tokenBudget.test.ts` | 20 | parseTokenBudget, findTokenBudgetPositions, getBudgetContinuationMessage |
| `src/utils/__tests__/displayTags.test.ts` | 17 | stripDisplayTags, stripDisplayTagsAllowEmpty, stripIdeContextTags |
| `src/utils/__tests__/taggedId.test.ts` | 10 | toTaggedId (prefix/uniqueness/format) |
| `src/utils/__tests__/controlMessageCompat.test.ts` | 15 | normalizeControlMessageKeys (snake_case→camelCase 转换) |
| `src/services/mcp/__tests__/normalization.test.ts` | 11 | normalizeNameForMCP (特殊字符/截断/空字符串/Unicode) |
| `src/services/mcp/__tests__/envExpansion.test.ts` | 14 | expandEnvVarsInString ($VAR/${VAR}/嵌套/未定义/转义) |
| `src/utils/git/__tests__/gitConfigParser.test.ts` | 20 | parseConfigString (key=value/section/subsection/多行/注释/引号) |
| `src/utils/__tests__/formatBriefTimestamp.test.ts` | 10 | formatBriefTimestamp (秒/分/时/天/周/月/年) |
| `src/utils/__tests__/hyperlink.test.ts` | 10 | createHyperlink (OSC 8 序列/file:///path/fallback) |
| `src/utils/__tests__/windowsPaths.test.ts` | 20 | windowsPathToPosixPath, posixPathToWindowsPath (驱动器/UNC/相对路径) |
| `src/utils/__tests__/notebook.test.ts` | 14 | parseCellId, mapNotebookCellsToToolResult (code/markdown/output) |
| `src/utils/__tests__/effort.test.ts` | 38 | isEffortLevel, parseEffortValue, isValidNumericEffort, convertEffortValueToLevel, getEffortLevelDescription, resolvePickerEffortPersistence |

### 已知限制

以下模块因 Bun 运行时限制或极重依赖链，暂时无法或不适合测试：

| 模块 | 问题 | 说明 |
|------|------|------|
| `Bun.JSONL.parseChunk` | 处理畸形行时无限挂起 | Bun 1.3.10 bug，错误恢复循环卡死；已跳过 parseJSONL 畸形行测试 |
| `src/tools.ts` 部分函数 | `getAllBaseTools`/`getTools` 加载全量 tool | 导入链过重，mock 难度大 |
| `src/tools/shared/spawnMultiAgent.ts` | 依赖 bootstrap/state + AppState + 50+ 模块 | mock 成本极高，投入产出比低 |
| `src/utils/messages.ts` 部分函数 | `withMemoryCorrectionHint` 等 | 依赖 `getFeatureValue_CACHED_MAY_BE_STALE` |

### Mock 策略总结

通过 `mock.module()` + `await import()` 模式成功解锁了以下重依赖模块的测试：

| 被 Mock 模块 | 解锁的测试 |
|-------------|-----------|
| `src/utils/log.ts` | json.ts, tokens.ts, FileEditTool/utils.ts, permissions.ts, memoize.ts, PermissionMode.ts |
| `src/services/tokenEstimation.ts` | tokens.ts |
| `src/utils/slowOperations.ts` | tokens.ts, permissions.ts, memoize.ts, PermissionMode.ts |
| `src/utils/debug.ts` | envValidation.ts, outputLimits.ts |
| `src/utils/bash/commands.ts` | commandSemantics.ts |
| `src/utils/thinking.js` | effort.ts |
| `src/utils/settings/settings.js` | effort.ts |
| `src/utils/auth.js` | effort.ts |
| `src/services/analytics/growthbook.js` | effort.ts, tokenBudget.ts |
| `src/utils/model/modelSupportOverrides.js` | effort.ts |

**关键约束**：`mock.module()` 必须在每个测试文件中内联调用，不能从共享 helper 导入（Bun 在 mock 生效前就解析了 helper 的导入）。

## 12. 后续测试覆盖计划

> **已完成** — Phase 1-4 增加 321 tests (647 → 968)，Phase 5 增加 209 tests (968 → 1177)
>
> Phase 1-4 全部完成，详见上方 P3-P5 表格。
> Phase 5 新增 12 个测试文件覆盖：effort、tokenBudget、displayTags、taggedId、controlMessageCompat、MCP normalization/envExpansion、gitConfigParser、formatBriefTimestamp、hyperlink、windowsPaths、notebook，详见 P6 表格。
> 实际调整：Phase 3 中 `context.ts` 因极重依赖链（bootstrap/state + claudemd + git 等）且 `getGitStatus` 在 test 环境直接返回 null，替换为 `envValidation.ts`（更实用）；Phase 4 中 GlobTool 纯函数不足，替换为 `commandSemantics.ts` + `destructiveCommandWarning.ts`。

### 不纳入计划的模块

| 模块 | 原因 |
|------|------|
| `query.ts` / `QueryEngine.ts` | 核心循环，需集成测试环境 |
| `services/api/claude.ts` | 需 mock SDK 流式响应 |
| `spawnMultiAgent.ts` | 50+ 依赖，mock 不可行 |
| `modelCost.ts` | 依赖 bootstrap/state + analytics |
| `mcp/dateTimeParser.ts` | 调用 Haiku API |
| `screens/` / `components/` | UI 组件，需 Ink 渲染测试 |

## 13. 参考

- [Bun Test 文档](https://bun.sh/docs/cli/test)
- 现有测试示例：`src/utils/__tests__/set.test.ts`, `src/utils/__tests__/array.test.ts`
