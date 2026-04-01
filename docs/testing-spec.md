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

> 更新日期：2026-04-01 | 总计：**517 tests, 25 files, 0 failures**

### P0 — 核心模块

| 测试计划 | 测试文件 | 测试数 | 覆盖范围 |
|----------|----------|--------|----------|
| 01 - Tool 系统 | `src/__tests__/Tool.test.ts` | 25 | buildTool, toolMatchesName, findToolByName, getEmptyToolPermissionContext, filterToolProgressMessages |
| | `src/__tests__/tools.test.ts` | 5 | parseToolPreset |
| | `src/tools/shared/__tests__/gitOperationTracking.test.ts` | 16 | parseGitCommitId, detectGitOperation |
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
| 03 - Context 构建 | `src/utils/__tests__/claudemd.test.ts` | 16 | stripHtmlComments, isMemoryFilePath, getLargeMemoryFiles |
| | `src/utils/__tests__/systemPrompt.test.ts` | 9 | buildEffectiveSystemPrompt |

### P1 — 重要模块

| 测试计划 | 测试文件 | 测试数 | 覆盖范围 |
|----------|----------|--------|----------|
| 04 - 权限系统 | `src/utils/permissions/__tests__/permissionRuleParser.test.ts` | 25 | escapeRuleContent, unescapeRuleContent, permissionRuleValueFromString, permissionRuleValueToString, normalizeLegacyToolName |
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

### 已知限制

以下模块因 ESM 重依赖链导致测试挂起，尚未编写测试：

| 模块 | 问题 | 依赖链 |
|------|------|--------|
| `src/utils/json.ts` | 导入时挂起 | `json.ts` → `log.ts` → `logError` → analytics/bootstrap |
| `src/utils/config.ts` | 导入时挂起 | `config.ts` → `log.ts` → analytics/bootstrap |
| `src/utils/messages.ts` 部分函数 | 需 mock 重依赖 | `withMemoryCorrectionHint` → `getFeatureValue_CACHED_MAY_BE_STALE` |
| `src/tools.ts` 部分函数 | 需 mock 重依赖 | `getAllBaseTools`、`getTools` → 全量 tool 注册 |

**解决方向**：使用 `mock.module()` 在导入前 mock 掉 `log.ts`、`bootstrap/state.ts` 等重依赖模块。

## 12. 参考

- [Bun Test 文档](https://bun.sh/docs/cli/test)
- 现有测试示例：`src/utils/__tests__/set.test.ts`, `src/utils/__tests__/array.test.ts`
