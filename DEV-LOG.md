# DEV-LOG

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
