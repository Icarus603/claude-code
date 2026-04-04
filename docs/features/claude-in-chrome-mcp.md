# Claude in Chrome — 用户操作指南

## 1. 功能简介

Claude in Chrome 让 Claude Code 直接控制你的 Chrome 浏览器。你可以用自然语言让 Claude 帮你：

- 打开网页、导航、前进后退
- 填写表单、上传图片
- 截图、录制 GIF
- 读取页面内容（DOM、纯文本）
- 执行 JavaScript
- 监控网络请求和控制台日志
- 管理标签页

## 2. 前置条件

| 条件 | 说明 |
|------|------|
| Claude Code 订阅 | 需要 Claude Pro、Max 或 Team 订阅，浏览器插件功能不向免费用户开放 |
| Chrome 浏览器 | 需已安装 Google Chrome |
| Claude in Chrome 扩展 | 从 Chrome Web Store 安装（`claude.ai/chrome`） |
| Claude Code CLI | 已通过 `bun run dev` 或构建产物运行 |

## 3. 启用方式

### Dev 模式

```bash
bun run dev -- --chrome
```

启动后 Claude 会自动检测 Chrome 扩展是否已安装，并注册浏览器控制工具。

### 构建产物

```bash
node dist/cli.js --chrome
```

### 禁用

```bash
bun run dev -- --no-chrome
```

或在 REPL 中通过 `/chrome` 命令切换启用/禁用状态。

### 通过配置默认启用

在 Claude Code 设置中将 `claudeInChromeDefaultEnabled` 设为 `true`，以后启动无需加 `--chrome` 参数。

## 4. 使用流程

1. **启动 CLI** — 加 `--chrome` 参数启动 Claude Code
2. **确认连接** — REPL 中输入 `/chrome`，查看扩展状态是否显示 "Installed / Connected"
3. **开始对话** — 正常与 Claude 对话，当需要操作浏览器时直接说，例如：
   - "打开 https://example.com 并截图"
   - "在当前页面搜索关键词 xxx"
   - "填写登录表单，用户名 admin"
   - "帮我录制当前操作的 GIF"
4. **权限审批** — 首次执行浏览器操作时，Claude 会请求你的确认
5. **操作完成** — Claude 完成操作后会返回结果（截图、文本、执行结果等）

## 5. 可用操作

### 页面交互

| 操作 | 说明 |
|------|------|
| `navigate` | 导航到指定 URL，或前进/后退 |
| `computer` | 鼠标点击、移动、拖拽、键盘输入、截图等（13 种 action） |
| `form_input` | 填写表单字段 |
| `upload_image` | 上传图片到文件输入框或拖拽区域 |
| `javascript_tool` | 在页面上下文执行 JavaScript |

### 页面读取

| 操作 | 说明 |
|------|------|
| `read_page` | 获取页面可访问性树（DOM 结构） |
| `get_page_text` | 提取页面纯文本内容 |
| `find` | 用自然语言搜索页面元素 |

### 标签页管理

| 操作 | 说明 |
|------|------|
| `tabs_context_mcp` | 获取当前标签组信息 |
| `tabs_create_mcp` | 创建新标签页 |

### 监控与调试

| 操作 | 说明 |
|------|------|
| `read_console_messages` | 读取浏览器控制台日志 |
| `read_network_requests` | 读取网络请求记录 |

### 其他

| 操作 | 说明 |
|------|------|
| `resize_window` | 调整浏览器窗口尺寸 |
| `gif_creator` | 录制 GIF 并导出 |
| `shortcuts_list` | 列出可用快捷方式 |
| `shortcuts_execute` | 执行快捷方式 |
| `update_plan` | 向你提交操作计划供审批 |
| `switch_browser` | 切换到其他 Chrome 浏览器（仅 Bridge 模式） |

## 6. 通信模式

Claude in Chrome 支持两种与浏览器通信的方式：

### 本地 Socket（默认）

Chrome 扩展通过 Native Messaging Host 与 CLI 建立 Unix socket 连接。适用于本地开发，无需额外配置。

### Bridge WebSocket

通过 Anthropic 的 bridge 服务中转，支持远程操控浏览器。需要 claude.ai OAuth 登录。

## 7. 常见问题

### 扩展显示未安装

确认已从 Chrome Web Store 安装 "Claude in Chrome" 扩展，安装后重启浏览器。

### 工具未出现在工具列表

检查启动时是否加了 `--chrome` 参数，或通过 `/chrome` 命令确认状态。

### 连接超时

确保 Chrome 浏览器正在运行且扩展已启用。Native Messaging Host 在扩展安装时自动注册，如果重装过扩展需要重启浏览器。

### 不使用 Chrome 功能时

不带 `--chrome` 参数正常启动即可，不会加载任何浏览器相关模块，不影响其他功能。
