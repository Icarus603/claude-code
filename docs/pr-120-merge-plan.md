# PR #120 分批合入方案

> 分支: `pr-sobird-120` → `main`
> 总计: 558 files / +102,830 / -101,373

## 执行进度

### B1: 552 文件格式化 — 拆分为 6 个子批次

#### B1-1: ink + buddy + cli + context + screens + tasks + services + keybindings (43 files) ✓
- [x] 合入: src/ink/ (17), src/buddy/ (2), src/cli/ (2), src/context/ (9), src/screens/ (3), src/tasks/ (4), src/services/ (3), src/keybindings/ (2), src/state/ (1)
- [x] 验证 `bun run build` 通过 ✓ (475 files)

#### B1-2: commands (79 files) ✓
- [x] 合入: src/commands/ (79 files)
- [x] 验证 `bun run build` 通过 ✓

#### B1-3: components/messages + permissions + mcp + sandbox + shell (104 files) ✓
- [x] 合入: src/components/messages/ (39), src/components/permissions/ (39), src/components/mcp/ (11), src/components/sandbox/ (5), src/components/shell/ (4)
- [x] 验证 `bun run build` 通过 ✓

#### B1-4: components/PromptInput,FeedbackSurvey,tasks,agents,skills,design-system,wizard (73 files) ✓
- [x] 合入: src/components/PromptInput/ (13), src/components/FeedbackSurvey/ (6), src/components/tasks/ (12), src/components/agents/ (17), src/components/skills/ (1), src/components/design-system/ (14), src/components/wizard/ (3)
- [x] 验证 `bun run build` 通过 ✓

#### B1-5: components 其余 + hooks + tools (232 files) ✓
- [x] 合入: src/components/ 其余目录 (~169), src/hooks/ (28), src/tools/ (35)
- [x] 验证 `bun run build` 通过 ✓

#### B1-6: 根目录 + utils + 其他零散文件 (21 files) ✓
- [x] 合入: src/main.tsx, src/dialogLaunchers.tsx, src/replLauncher.tsx, src/interactiveHelpers.tsx, src/entrypoints/, src/moreright/, src/utils/ (15)
- [x] 验证 `bun run build` 通过 ✓

### B2: 45 文件 USER_TYPE 替换 (commit `fc200fd`)
- [ ] cherry-pick USER_TYPE 提交
- [ ] 检查替换是否完整无遗漏
- [ ] 验证 `bun run build` 通过

### B3: 文档变更 (README / Run.ps1 / TODO.md / V6.md)
- [ ] 合入 README.md, Run.ps1, TODO.md
- [ ] 删除 V6.md
- [ ] 验证无破坏

### B4: 构建配置变更 — 跳过

### 最终验证
- [ ] `bun run build` 完整构建
- [ ] `bun test` 测试通过
- [ ] git log 确认提交历史清晰
