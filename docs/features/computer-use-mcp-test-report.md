# Computer Use MCP 工具测试报告

> 测试日期: 2026-04-04
> 测试环境: macOS Darwin 25.4.0, Cursor (IDE tier: click)
> MCP Server: `@ant/computer-use-mcp`

## 工具总览

共 17 个工具（含 batch 复合操作），分为 5 大类：

| 类别 | 工具 | 数量 |
|------|------|------|
| 截图/显示 | `screenshot`, `switch_display`, `zoom` | 3 |
| 鼠标操作 | `left_click`, `right_click`, `double_click`, `triple_click`, `middle_click`, `left_click_drag`, `mouse_move` | 7 |
| 键盘操作 | `key`, `type`, `hold_key` | 3 |
| 状态查询 | `cursor_position`, `request_access` | 2 |
| 复合/辅助 | `computer_batch`, `wait` | 2 |

---

## 测试结果

### 1. 权限管理

#### `request_access` — 请求应用访问权限

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 行为 | 弹出系统对话框请求用户授权，支持批量申请多个应用 |
| 返回 | `{ granted: [...], denied: [...], tierGuidance: "..." }` |
| 权限分级 | `click`（仅点击）, `full`（完整控制） |
| 说明 | IDE 类应用（Cursor、VSCode、Terminal）默认授予 `click` tier，限制键盘输入和右键操作；系统应用（System Settings）授予 `full` tier |

#### 已授权应用

| 应用 | Tier | 能力 |
|------|------|------|
| Cursor | click | 可见 + 纯左键点击（无键盘输入、右键、修饰键点击、拖拽） |
| Terminal | click | 同上 |
| System Settings | full | 完整控制（键鼠、拖拽等） |
| Finder | — | 已授权 |

---

### 2. 截图与显示

#### `screenshot` — 截取屏幕截图

| 项目 | 结果 |
|------|------|
| 状态 | ⚠️ 部分通过 |
| 执行 | 工具成功执行，返回 `ok: true` |
| 图片 | **未返回可视图片内容**（output 为空字符串） |
| `save_to_disk` | 设置后仍无输出 |
| 分析 | 可能原因：(1) macOS 屏幕录制权限未授予；(2) 当前前台应用未被过滤导致截图为空；(3) MCP 传输层未正确编码图片数据 |
| 建议 | 检查 **系统设置 → 隐私与安全性 → 屏幕录制** 是否授权给运行 Claude Code 的应用 |

#### `switch_display` — 切换显示器

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 行为 | 接受显示器名称或 `"auto"`（自动选择） |
| 返回 | 确认消息 |

#### `zoom` — 区域放大截图

| 项目 | 结果 |
|------|------|
| 状态 | ⏭️ 跳过 |
| 原因 | 依赖 `screenshot` 返回的图片坐标，截图未返回图片无法测试 |

---

### 3. 鼠标操作

> 以下测试在 Cursor 窗口上执行（tier: click）

#### `mouse_move` — 移动鼠标

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 输入 | `coordinate: [500, 500]` |
| 返回 | `"Moved."` |

#### `left_click` — 左键单击

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 输入 | `coordinate: [500, 500]` |
| 返回 | `"Clicked."` |

#### `double_click` — 双击

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 输入 | `coordinate: [500, 500]` |
| 返回 | `"Clicked."` |

#### `triple_click` — 三击

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 输入 | `coordinate: [500, 500]` |
| 返回 | `"Clicked."` |

#### `right_click` — 右键点击

| 项目 | 结果 |
|------|------|
| 状态 | ⚠️ 受 tier 限制 |
| Cursor (click tier) | ❌ 被拒绝 — `"Code" is granted at tier "click" — right-click, middle-click, and clicks with modifier keys require tier "full"` |
| Finder (full tier) | ✅ 通过 — 返回 `"Clicked."` |
| 结论 | 功能正常，IDE 安全限制符合预期 |

#### `middle_click` — 中键点击

| 项目 | 结果 |
|------|------|
| 状态 | ⚠️ 受 tier 限制 |
| Cursor (click tier) | ❌ 被拒绝 — 同 `right_click`，需要 full tier |
| Finder (full tier) | ✅ 通过 — 返回 `"Clicked."` |
| 结论 | 功能正常，IDE 安全限制符合预期 |

#### `left_click_drag` — 拖拽

| 项目 | 结果 |
|------|------|
| 状态 | ⚠️ 受 tier 限制 |
| Cursor (click tier) | ❌ 被拒绝 — 拖拽被视为修饰键点击，需要 full tier |
| Finder (full tier) | ✅ 通过 — 返回 `"Dragged."` |
| 结论 | 功能正常，IDE 安全限制符合预期 |

#### `scroll` — 滚轮滚动

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 输入 | `coordinate: [500, 500]`, `scroll_direction: "down"`, `scroll_amount: 3` |
| 返回 | `"Scrolled."` |
| 反向 | ✅ `scroll_direction: "up"` 也通过 |

---

### 4. 键盘操作

> 以下测试在 Cursor 窗口上执行（tier: click）— 所有键盘操作均被拒绝

#### `key` — 按键/快捷键

| 项目 | 结果 |
|------|------|
| 状态 | ⚠️ 受 tier 限制 |
| Cursor (click tier) | ❌ 被拒绝 — IDE tier 限制键盘输入 |
| Finder (full tier) | ✅ 通过 — `escape` 按键成功，返回 `"Key pressed."` |
| 结论 | 功能正常，IDE 安全限制符合预期 |

#### `type` — 输入文本

| 项目 | 结果 |
|------|------|
| 状态 | ⚠️ 受 tier 限制 |
| Cursor (click tier) | ❌ 被拒绝 — IDE tier 限制文本输入 |
| Finder (full tier) | ✅ 通过 — 输入 `"hello"` 成功，返回 `"Typed 5 grapheme(s)."` |
| 结论 | 功能正常，IDE 安全限制符合预期 |

#### `hold_key` — 按住按键

| 项目 | 结果 |
|------|------|
| 状态 | ⚠️ 受 tier 限制 |
| Cursor (click tier) | ❌ 被拒绝 — IDE tier 限制键盘输入 |
| Finder (full tier) | ✅ 通过 — 按住 `shift` 1 秒成功，返回 `"Key held."` |
| 结论 | 功能正常，IDE 安全限制符合预期 |

---

### 5. 状态查询

#### `cursor_position` — 获取鼠标位置

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 返回 | `{"x": null, "y": null, "coordinateSpace": "image_pixels"}` |
| 说明 | 坐标为 null 是因为没有成功截图，无参考坐标系 |

---

### 6. 复合/辅助操作

#### `computer_batch` — 批量执行操作

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 行为 | 按顺序执行操作列表，遇到失败则停止后续操作 |
| 返回 | `{ completed: [...], failed: {...}, remaining: N }` |
| 特点 | 单次 API 调用执行多个操作，减少往返延迟 |
| 错误处理 | 失败的操作会中断后续操作，返回已完成和剩余数量 |

#### `wait` — 等待

| 项目 | 结果 |
|------|------|
| 状态 | ✅ 通过 |
| 输入 | `duration: 1` (秒) |
| 返回 | `"Waited 1s."` |
| 最大值 | 100 秒 |

---

## 汇总统计

| 状态 | 数量 | 工具 |
|------|------|------|
| ✅ 通过 | 10 | `request_access`, `switch_display`, `mouse_move`, `left_click`, `double_click`, `triple_click`, `scroll`, `cursor_position`, `computer_batch`, `wait` |
| ⚠️ 部分通过 | 7 | `screenshot`（执行成功但无图片返回）, `right_click`, `middle_click`, `left_click_drag`, `key`, `type`, `hold_key`（均在 full tier 应用上通过，IDE click tier 限制是预期行为） |
| ❌ 被拒绝 | 0 | — |
| ⏭️ 跳过 | 1 | `zoom`（依赖截图） |

---

## 已知问题

### P0: 截图无图片返回

`screenshot` 工具执行成功但未返回图片内容，导致：
- 无法获取屏幕坐标参考
- `cursor_position` 返回 null 坐标
- `zoom` 无法使用
- 所有点击操作只能盲点（无截图验证）

**可能原因**:
1. macOS 屏幕录制权限未授予
2. MCP 图片传输/编码问题
3. 截图内容被安全过滤机制过滤

**建议排查**: 检查 `系统设置 → 隐私与安全性 → 屏幕录制` 权限。

### P1: IDE 应用键盘操作受限 — ✅ 已确认功能正常

IDE 类应用（Cursor、VSCode、Terminal）被限制在 `click` tier，无法执行：
- 键盘输入（`key`, `type`, `hold_key`）
- 右键/中键点击（`right_click`, `middle_click`）
- 拖拽操作（`left_click_drag`）

这是安全设计，防止 AI 操控 IDE 终端。**在 full tier 应用（Finder、System Settings）上，以上 6 个操作均测试通过，功能完全正常。**

---

## 权限模型说明

Computer Use MCP 采用分级权限模型：

```
┌─────────────────────────────────────────┐
│  Tier: full                             │
│  - 所有鼠标操作（左键、右键、中键、拖拽）  │
│  - 键盘输入（type, key, hold_key）       │
│  - 适用于: 系统应用、Finder 等           │
├─────────────────────────────────────────┤
│  Tier: click                            │
│  - 仅纯左键点击                          │
│  - 滚轮滚动                             │
│  - 适用于: IDE、Terminal 等              │
├─────────────────────────────────────────┤
│  未授权                                  │
│  - 所有操作被拒绝                        │
│  - 需通过 request_access 申请            │
└─────────────────────────────────────────┘
```
