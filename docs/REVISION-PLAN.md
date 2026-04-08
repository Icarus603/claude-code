# 文件修正計劃

> 目標：補充源碼級洞察，讓每篇文件從"概念科普"升級爲"逆向工程白皮書"水準。

---

## 第一梯隊：空殼頁，需要大幅重寫

### 1. `safety/sandbox.mdx` — 沙箱機制 ✅ DONE

**現狀**：35 行，只列了"檔案系統/網絡/進程/時間"四個維度，沒有任何實現細節。

**修正方向**：
- 補充 macOS `sandbox-exec` 的實際呼叫方式，展示沙箱 profile 的關鍵片段
- 說明 `getSandboxConfig()` 的判定邏輯：哪些命令走沙箱、哪些跳過
- 補充 `dangerouslyDisableSandbox` 參數的設計權衡
- 加入 Linux 平臺的沙箱差異對比（seatbelt vs namespace）
- 展示一次命令執行從權限檢查→沙箱包裹→實際執行的完整鏈路

---

### 2. `introduction/what-is-claude-code.mdx` — 什麼是 Claude Code ✅ DONE

**現狀**：39 行，純營銷文案，和"普通聊天 AI"的對比表太低級。

**修正方向**：
- 砍掉"能做什麼"的泛泛列表，改爲一個具體的端到端示例（從用戶輸入→系統處理→最終輸出）
- 用一張簡化架構圖替代文字描述，讓讀者 30 秒建立直覺
- 補充 Claude Code 的技術定位：不是 IDE 擴充功能、不是 Web Chat，而是 terminal-native agentic system
- 加入與 Cursor / Copilot / Aider 等工具的定位差異（架構層面而非功能清單）

---

### 3. `introduction/why-this-whitepaper.mdx` — 爲什麼寫這份白皮書 ✅ DONE

**現狀**：40 行，全是空話，四張 Card 只是後續章節標題的預告。

**修正方向**：
- 明確定位：這是對 Anthropic 官方 CLI 的逆向工程分析，不是官方文件
- 列出逆向過程中發現的 3-5 個最意外/最精妙的設計決策（吊住讀者胃口）
- 說明白皮書的閱讀路線圖：推薦的閱讀順序和每個章節解決什麼問題
- 補充"這份白皮書不是什麼"——不是使用教程，不是 API 文件

---

### 4. `safety/why-safety-matters.mdx` — 爲什麼安全至關重要 ✅ DONE

**現狀**：40 行，只列了顯而易見的風險，"安全 vs 效率的平衡"只有 3 個 bullet。

**修正方向**：
- 從源碼角度展示安全體系的全景圖：權限規則 → 沙箱 → Plan Mode → 預算上限 → Hooks 的縱深防禦鏈
- 補充 Claude 自身 System Prompt 中的安全指令（"執行前確認"、"優先可逆操作"等），展示 AI 端的安全約束
- 用真實場景說明"安全 vs 效率"的工程權衡：比如 Read 工具爲什麼免審批、Bash 工具爲什麼要逐條確認
- 加入 Prompt Injection 防禦的簡要說明（tool result 中的惡意內容如何被系統標記）

---

## 第二梯隊：有骨架但太淺，需要補肉

### 5. `conversation/streaming.mdx` — 流式響應 ✅ DONE

**現狀**：43 行，只說了"流式好"和 3 行 provider 表。

**修正方向**：
- 補充 `BetaRawMessageStreamEvent` 的核心事件類型及其含義
- 展示文本 chunk 和 tool_use block 交織的狀態機流轉
- 說明流式中的錯誤處理：網絡斷開、API 限流、token 超限時的重試/降級策略
- 補充 `processStreamEvents()` 的核心邏輯：如何從事件流中分離出文本、工具呼叫、usage 統計

---

### 6. `tools/search-and-navigation.mdx` — 搜索與導航 ✅ DONE

**現狀**：43 行，只說 Glob 和 Grep 存在。

**修正方向**：
- 補充 ripgrep 二進制的內嵌方式（vendor 目錄、平臺適配）
- 說明搜索結果的 head_limit 預設 250 的設計原因（token 預算）
- 展示 ToolSearch 的實現：如何用語義匹配在 50+ 工具（含 MCP）中找到最相關的
- 補充 Glob 按修改時間排序的意義：最近修改的文件最可能與當前任務相關

---

### 7. `tools/task-management.mdx` — 任務管理 ✅ DONE

**現狀**：50 行，只有流程 Steps 和狀態展示的 4 個 bullet。

**修正方向**：
- 補充任務的資料模型：id / subject / description / status / blockedBy / blocks / owner
- 說明依賴管理的實現：blockedBy 如何阻止任務被認領、完成一個任務後如何自動解鎖下游
- 展示任務與 Agent 工具的聯動：子 Agent 如何認領任務、報告進度
- 補充 activeForm 字段的 UX 設計：進行中任務的 spinner 動畫文案

---

### 8. `context/token-budget.mdx` — Token 預算管理 ✅ DONE

**現狀**：55 行，預算控制只有 3 張 Card 各一句話。

**修正方向**：
- 補充 `contextWindowTokens` 和 `maxOutputTokens` 的動態計算邏輯
- 說明快取 breakpoint 的放置策略：System Prompt 中不變內容在前、變化內容在後的原因
- 展示工具輸出截斷的具體機制：超長結果如何被 truncate、何時觸發 micro-compact
- 補充 token 計數的實現：`countTokens` 的呼叫時機和近似 vs 精確計數的權衡

---

### 9. `agent/worktree-isolation.mdx` — Worktree 隔離 ✅ DONE

**現狀**：55 行，只描述了 git worktree 的概念。

**修正方向**：
- 展示 `.claude/worktrees/` 的目錄結構和分支命名規則
- 說明 worktree 的生命週期：建立時機（`isolation: "worktree"`）→ 子 Agent 執行 → 完成/放棄 → 自動清理
- 補充 worktree 與子 Agent 的綁定關係：Agent 結束時如何判斷 keep or remove
- 加入 EnterWorktree / ExitWorktree 工具的交互設計

---

### 10. `extensibility/custom-agents.mdx` — 自定義 Agent ✅ DONE

**現狀**：56 行，只有設定表和示例表。

**修正方向**：
- 展示 agent markdown 文件的完整 frontmatter 格式（name / description / model / allowedTools 等）
- 說明 agent 如何被加載和注入 System Prompt：`loadAgentDefinitions()` 的發現和合並邏輯
- 展示工具限制的實現：allowedTools 如何過濾工具列表
- 補充 agent 與 subagent_type 參數的關聯：Agent 工具如何指定使用自定義 Agent
