# TODO

尽可能实现下面的包, 使得与主包的关系完全吻合

## Packages

- [x] `url-handler-napi` — URL 处理 NAPI 模块 (签名修正，保持 null fallback)
- [x] `modifiers-napi` — 修饰键检测 NAPI 模块 (Bun FFI + Carbon)
- [x] `audio-capture-napi` — 音频捕获 NAPI 模块 (SoX/arecord)
- [x] `color-diff-napi` — 颜色差异计算 NAPI 模块 (纯 TS 实现)
- [x] `image-processor-napi` — 图像处理 NAPI 模块 (sharp + osascript 剪贴板)

- [x] `@ant/computer-use-swift` — Computer Use Swift 原生模块 (macOS JXA/screencapture 实现)
- [x] `@ant/computer-use-mcp` — Computer Use MCP 服务 (类型安全 stub + sentinel apps + targetImageSize)
- [x] `@ant/computer-use-input` — Computer Use 输入模块 (macOS AppleScript/JXA 实现)
<!-- - [ ] `@ant/claude-for-chrome-mcp` — Chrome MCP 扩展 -->

## 工程化能力

- [x] 代码格式化与校验
- [x] 冗余代码检查
- [x] git hook 的配置
- [x] 代码健康度检查
- [x] Biome lint 规则调优（适配反编译代码，关闭格式化避免大规模 diff）
- [x] 单元测试基础设施搭建 (test runner 配置)
- [x] CI/CD 流水线 (GitHub Actions)
