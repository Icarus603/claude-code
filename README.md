# Claude Code Best V3 (CCB)

牢 A (Anthropic) 官方 [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI 工具的源码反编译/逆向还原项目。目标是将 Claude Code 大部分功能及工程化能力复现 (问就是老佛爷已经付过钱了)。虽然很难绷, 但是它叫做 CCB(踩踩背)...

[文档在这里, 支持投稿 PR](https://ccb.agent-aura.top/)

赞助商占位符

- [x] v1 会完成跑通及基本的类型检查通过;
- [x] V2 会完整实现工程化配套设施;
  - [ ] Biome 格式化可能不会先实施, 避免代码冲突
  - [x] 构建流水线完成, 产物 Node/Bun 都可以运行
- [x] V3 会写大量文档, 完善文档站点
- [ ] V4 会完成大量的测试文件, 以提高稳定性
  - [x] Buddy 小宠物回来啦
  - [x] Auto Mode 回归
  - [x] 所有 Feature 现在可以通过环境变量配置, 而不是垃圾的 bun --feature
  - [x] 移除牢 A 的反蒸馏代码!!!
- [ ] V5 大规模重构石山代码, 全面模块分包
  - [ ] V5 将会为全新分支, 届时 main 分支将会封存为历史版本

> 我不知道这个项目还会存在多久, Star + Fork + git clone + .zip 包最稳健; 说白了就是扛旗项目, 看看能走多远
>
> 这个项目更新很快, 后台有 Opus 持续优化, 几乎几个小时就有新变化;
>
> Claude 已经烧了 1000$ 以上, 没钱了, 换成 GLM 继续玩; @zai-org GLM 5.1 非常可以;
>

存活记录:

1. 开源后 36 小时, 9.7k star; 特权模式可以开启了, 新 feature 调控也加上了;加把劲明天就 10k 了;
2. 开源后 48 小时: 突破 7k Star; 测试代码小有成效;
3. 开源后 24 小时: 突破 6k Star, 感谢各位支持. 完成 docs 文档的站点构建, 达到 v3 版本, 后续开始进行测试用例维护, 完成之后可以接受 PR; 看来牢 A 是不想理我们了;
4. 开源后 15 小时: 完成了构建产物的 node 支持, 现在是完全体了; star 快到 3k 了; 等待牢 A 的邮件
5. 开源后 12 小时: 愚人节, star 破 1k, 并且牢 A 没有发邮件搞这个项目

## 快速开始

### 环境要求

一定要最新版本的 bun 啊, 不然一堆奇奇怪怪的 BUG!!! bun upgrade!!!

- [Bun](https://bun.sh/) >= 1.3.11
- 常规的配置 CC 的方式, 各大提供商都有自己的配置方式

### 安装

```bash
bun install
```

### 运行

```bash
# 开发模式, 看到版本号 888 说明就是对了
bun run dev

# 构建
bun run build
```

构建采用 code splitting 多文件打包（`build.ts`），产物输出到 `dist/` 目录（入口 `dist/cli.js` + 约 450 个 chunk 文件）。

构建出的版本 bun 和 node 都可以启动, 你 publish 到私有源可以直接启动

如果遇到 bug 请直接提一个 issues, 我们优先解决

## 相关文档及网站

<https://deepwiki.com/claude-code-best/claude-code>

## Star History

<a href="https://www.star-history.com/?repos=claude-code-best%2Fclaude-code&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=claude-code-best/claude-code&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=claude-code-best/claude-code&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=claude-code-best/claude-code&type=date&legend=top-left" />
 </picture>
</a>

## 许可证

本项目仅供学习研究用途。Claude Code 的所有权利归 [Anthropic](https://www.anthropic.com/) 所有。
