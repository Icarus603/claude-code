# GrowthBook 功能啓用計劃

> 編制日期: 2026-04-06
> 基於: feature-flags-codex-review.md + 4 個並行研究代理的深度分析
> 前提: 我們是付費訂閱用戶，擁有有效的 Anthropic API key

---

## 背景

Claude Code 使用三層門控系統：
1. **編譯時 feature flag** — `feature('FLAG_NAME')` from `bun:bundle`
2. **GrowthBook 遠程開關** — `tengu_*` 前綴，通過 SDK 連接 Anthropic 服務端
3. **執行時環境變量** — `USER_TYPE`、`CLAUDE_CODE_*` 等

在我們的反編譯版本中，GrowthBook 不啓動（analytics 鏈空實現），導致所有 `tengu_*` 檢查預設返回 `false`。

**核心發現：所有被 GrowthBook 門控的功能程式碼都是真實現，沒有 stub。**

---

## 啓用方式說明

### 方式 1：硬編碼繞過（推薦先用）
在 `src/services/analytics/growthbook.ts` 的 `getFeatureValueInternal()` 函數中添加預設值映射。

### 方式 2：自建 GrowthBook 服務器
```bash
docker run -p 3100:3100 growthbook/growthbook
# 設置環境變量
CLAUDE_GB_ADAPTER_URL=http://localhost:3100
CLAUDE_GB_ADAPTER_KEY=sdk-xxx
```

### 方式 3：恢復原生 1P 連接
讓 `is1PEventLoggingEnabled()` 返回 `true`，連接 Anthropic 的 GrowthBook 服務端。
注意：會發送使用統計（不含程式碼/對話內容）。

---

## 優先級 P0：純本地功能（零外部依賴，立即可用）

這些功能不需要 API 呼叫，開啓 gate 即可工作。

### P0-1. 自定義快捷鍵
- **Gate**: `tengu_keybinding_customization_release` → `true`
- **編譯 flag**: 無（已內置）
- **程式碼量**: 473 行，完整實現
- **功能**: 加載 `~/.claude/keybindings.json`，支援熱重載、重複鍵檢測、結構驗證
- **效果**: 用戶可自定義所有快捷鍵
- **風險**: 無

### P0-2. 流式工具執行
- **Gate**: `tengu_streaming_tool_execution2` → `true`
- **編譯 flag**: 無（已內置）
- **程式碼量**: 577 行（StreamingToolExecutor），完整實現
- **功能**: API 響應還在流式返回時就開始執行工具，減少等待時間
- **效果**: 顯著提升交互速度
- **風險**: 低（生產級程式碼，有錯誤處理）

### P0-3. 定時任務系統
- **Gate**: `tengu_kairos_cron` → `true`（額外：`tengu_kairos_cron_durable` 預設 `true`）
- **編譯 flag**: `AGENT_TRIGGERS`（需新增）或 `AGENT_TRIGGERS_REMOTE`（已啓用）
- **程式碼量**: 1025 行（cronTasks + cronScheduler），完整實現
- **功能**: 本地 cron 調度，支援一次性/週期性任務、防雷羣效應 jitter、自動過期
- **效果**: 可設置定時執行的 Claude 任務
- **風險**: 低

### P0-4. Agent 團隊 / Swarm
- **Gate**: `tengu_amber_flint` → `true`（這是 kill switch，預設已 `true`）
- **編譯 flag**: 無（已內置）
- **程式碼量**: 45 行（gate 層），實際 swarm 實現在 teammate tools 中
- **功能**: 多 agent 協作，需額外設置 `--agent-teams` 或 `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`
- **效果**: 允許建立和管理 agent 團隊
- **風險**: 無（kill switch 預設就是 true）

### P0-5. Token 高效 JSON 工具格式
- **Gate**: `tengu_amber_json_tools` → `true`
- **編譯 flag**: 無（已內置）
- **程式碼量**: betas.ts 中幾行 gate 檢查
- **功能**: 啓用 FC v3 格式，減少約 4.5% 的輸出 token
- **效果**: 省錢
- **風險**: 低（需要模型支援該 beta header）

### P0-6. Ultrathink 擴展思考
- **Gate**: `tengu_turtle_carbon` → `true`（預設已 `true`，kill switch）
- **編譯 flag**: 無
- **功能**: 通過關鍵詞觸發擴展思考模式
- **效果**: 已預設啓用，確保不被遠程關閉即可
- **風險**: 無

### P0-7. 即時模型切換
- **Gate**: `tengu_immediate_model_command` → `true`
- **編譯 flag**: 無
- **功能**: 在 query 執行過程中即時執行 `/model`、`/fast`、`/effort` 命令
- **效果**: 無需等當前任務完成就能切換
- **風險**: 低

---

## 優先級 P1：需要 Claude API 的功能（有 API key 即可用）

這些功能需要呼叫 Claude API（使用 forked subagent 或 queryModel），有訂閱即可。

### P1-1. 會話記憶
- **Gate**: `tengu_session_memory` → `true`（設定：`tengu_sm_config` → `{}`）
- **編譯 flag**: 無（已內置）
- **程式碼量**: 1127 行，完整實現
- **功能**: 跨會話上下文持久化。用 forked agent 定期提取會話筆記到 markdown 文件
- **效果**: Claude 記住跨會話的工作上下文
- **依賴**: Claude API（forked subagent）
- **風險**: 低（額外 API token 消耗）

### P1-2. 自動記憶提取
- **Gate**: `tengu_passport_quail` → `true`（相關：`tengu_moth_copse`、`tengu_coral_fern`）
- **編譯 flag**: `EXTRACT_MEMORIES`（需新增）
- **程式碼量**: 616 行，完整實現
- **功能**: 對話中自動提取持久記憶到 `~/.claude/projects/<path>/memory/`
- **效果**: 自動構建專案知識庫
- **依賴**: Claude API（forked subagent）
- **風險**: 低

### P1-3. 提示建議
- **Gate**: `tengu_chomp_inflection` → `true`
- **編譯 flag**: 無（已內置）
- **程式碼量**: 525 行，完整實現
- **功能**: 自動生成下一步操作建議，帶投機預取（speculation prefetch）
- **效果**: 更流暢的交互體驗
- **依賴**: Claude API（forked subagent）
- **風險**: 低（額外 API 消耗，但有快取感知）

### P1-4. 驗證代理
- **Gate**: `tengu_hive_evidence` → `true`
- **編譯 flag**: `VERIFICATION_AGENT`（需新增）
- **程式碼量**: 153 行（agent 定義），完整實現
- **功能**: 對抗性驗證 agent，主動嘗試打破你的實現（只讀模式）
- **效果**: 自動化程式碼驗證
- **依賴**: Claude API（subagent）
- **風險**: 低（只讀，不修改程式碼）

### P1-5. Brief 模式
- **Gate**: `tengu_kairos_brief` → `true`
- **編譯 flag**: `KAIROS` 或 `KAIROS_BRIEF`（需新增）
- **程式碼量**: 335 行，完整實現
- **功能**: `/brief` 命令切換精簡輸出模式
- **效果**: 減少冗餘輸出
- **依賴**: Claude API
- **風險**: 低

### P1-6. 離開摘要
- **Gate**: `tengu_sedge_lantern` → `true`
- **編譯 flag**: `AWAY_SUMMARY`（需新增）
- **程式碼量**: 176 行，完整實現
- **功能**: 離開終端 5 分鐘後返回時自動總結期間發生了什麼
- **效果**: 快速恢復上下文
- **依賴**: Claude API + 終端焦點事件支援
- **風險**: 低

### P1-7. 自動夢境
- **Gate**: `tengu_onyx_plover` → `{"enabled": true}`
- **編譯 flag**: 無（已內置，但檢查 auto-memory 是否啓用）
- **程式碼量**: 349 行，完整實現
- **功能**: 後臺自動整理/鞏固記憶（等同於自動執行 `/dream`）
- **效果**: 記憶自動保持整潔有序
- **依賴**: Claude API（forked subagent）+ auto-memory 啓用
- **風險**: 低

### P1-8. 空閒返回提示
- **Gate**: `tengu_willow_mode` → `"dialog"` 或 `"hint"`
- **編譯 flag**: 無
- **功能**: 對話太大且快取過期時，提示用戶開新會話
- **效果**: 避免在過期快取上浪費 token
- **風險**: 無

---

## 優先級 P2：增強型功能（提升體驗但非必須）

### P2-1. MCP 指令增量傳輸
- **Gate**: `tengu_basalt_3kr` → `true`
- **功能**: 只發送變化的 MCP 指令而非全量
- **效果**: 減少 token 消耗
- **風險**: 低

### P2-2. 葉剪枝優化
- **Gate**: `tengu_pebble_leaf_prune` → `true`
- **功能**: 會話存儲中移除死衚衕訊息分支
- **效果**: 減少存儲和加載時間
- **風險**: 低

### P2-3. 訊息合併
- **Gate**: `tengu_chair_sermon` → `true`
- **功能**: 合併相鄰的 tool_result + text 塊
- **效果**: 減少 token 消耗
- **風險**: 低

### P2-4. 深度連結
- **Gate**: `tengu_lodestone_enabled` → `true`
- **功能**: 註冊 `claude://` URL 協議處理器
- **效果**: 可從瀏覽器直接打開 Claude Code
- **風險**: 低

### P2-5. Agent 自動轉後臺
- **Gate**: `tengu_auto_background_agents` → `true`
- **功能**: Agent 任務執行 120s 後自動轉爲後臺
- **效果**: 不再阻塞主交互
- **風險**: 低

### P2-6. 細粒度工具狀態
- **Gate**: `tengu_fgts` → `true`
- **功能**: 系統提示中包含細粒度工具狀態信息
- **效果**: 模型更好地理解工具可用性
- **風險**: 低

### P2-7. 檔案操作 git diff
- **Gate**: `tengu_quartz_lantern` → `true`
- **功能**: 檔案寫入/編輯時計算 git diff（僅遠程會話）
- **效果**: 更好的變更追蹤
- **風險**: 低

---

## 優先級 P3：需要自建服務或 Anthropic OAuth

### P3-1. 團隊記憶
- **Gate**: `tengu_herring_clock` → `true`
- **編譯 flag**: `TEAMMEM`（需新增）
- **程式碼量**: 1180+ 行，完整實現
- **功能**: 跨 agent 共享記憶，同步到 Anthropic API
- **依賴**: Anthropic OAuth + GitHub remote
- **狀態**: 需要 Anthropic 的 `/api/claude_code/team_memory` 端點
- **可行性**: 除非自建相容 API，否則無法使用

### P3-2. 設置同步
- **Gate**: `tengu_enable_settings_sync_push` + `tengu_strap_foyer` → `true`
- **編譯 flag**: `UPLOAD_USER_SETTINGS` / `DOWNLOAD_USER_SETTINGS`（需新增）
- **程式碼量**: 582 行，完整實現
- **功能**: 跨設備設置同步
- **依賴**: Anthropic OAuth + `/api/claude_code/user_settings`
- **可行性**: 同上

### P3-3. Bridge 遠程控制
- **Gate**: `tengu_ccr_bridge` → `true`（已有編譯 flag `BRIDGE_MODE` dev 模式啓用）
- **程式碼量**: 12,619 行，完整實現
- **功能**: claude.ai 網頁端遠程控制 CLI
- **依賴**: claude.ai 訂閱 + WebSocket 後端
- **可行性**: 需要 Anthropic 的 CCR 後端

### P3-4. 遠程定時 Agent
- **Gate**: `tengu_surreal_dali` → `true`
- **功能**: 建立在遠程執行的定時 agent
- **依賴**: Anthropic CCR 基礎設施
- **可行性**: 需要遠程服務

---

## Kill Switch 清單（確保不被遠程關閉）

這些 gate 預設爲 `true`，是 kill switch。應確保它們保持 `true`：

| Gate | 預設 | 控制什麼 |
|---|---|---|
| `tengu_turtle_carbon` | `true` | Ultrathink 擴展思考 |
| `tengu_amber_stoat` | `true` | 內置 Explore/Plan agent |
| `tengu_amber_flint` | `true` | Agent 團隊/Swarm |
| `tengu_slim_subagent_claudemd` | `true` | 子 agent 精簡 CLAUDE.md |
| `tengu_birch_trellis` | `true` | tree-sitter bash 安全分析 |
| `tengu_collage_kaleidoscope` | `true` | macOS 剪貼板圖片讀取 |
| `tengu_compact_cache_prefix` | `true` | 壓縮時複用 prompt cache |
| `tengu_kairos_cron_durable` | `true` | 持久化 cron 任務 |
| `tengu_attribution_header` | `true` | API 請求署名 |
| `tengu_slate_prism` | `true` | Agent 進度摘要 |

---

## 需要新增的編譯 flag

以下編譯時 flag 尚未在 `build.ts` / `scripts/dev.ts` 中啓用，但功能程式碼完整：

| Flag | 用於 | 優先級 |
|---|---|---|
| `AGENT_TRIGGERS` | 定時任務系統（P0-3） | P0 |
| `EXTRACT_MEMORIES` | 自動記憶提取（P1-2） | P1 |
| `VERIFICATION_AGENT` | 驗證代理（P1-4） | P1 |
| `KAIROS` 或 `KAIROS_BRIEF` | Brief 模式（P1-5） | P1 |
| `AWAY_SUMMARY` | 離開摘要（P1-6） | P1 |
| `TEAMMEM` | 團隊記憶（P3-1） | P3 |

---

## 實施路線圖

### Phase 1：硬編碼 P0 純本地 gate（最快見效）
1. 在 growthbook.ts 添加預設值映射
2. 在 build.ts / dev.ts 添加 `AGENT_TRIGGERS` 編譯 flag
3. 驗證 7 個 P0 功能正常工作
4. 預計工作量：1-2 小時

### Phase 2：啓用 P1 API 依賴功能
1. 添加編譯 flag：`EXTRACT_MEMORIES`、`VERIFICATION_AGENT`、`KAIROS_BRIEF`、`AWAY_SUMMARY`
2. 添加 P1 gate 預設值
3. 驗證 8 個 P1 功能正常工作
4. 預計工作量：2-3 小時

### Phase 3：評估自建 GrowthBook（可選）
1. Docker 部署 GrowthBook 服務器
2. 遷移硬編碼值到 GrowthBook 後臺管理
3. 獲得 Web UI 管理所有 flag 的能力
4. 預計工作量：半天

### Phase 4：評估遠程功能（可選）
1. 研究是否可以使用 Anthropic OAuth
2. 評估團隊記憶、設置同步的自建可行性
3. 預計工作量：待評估

---

## 隱私說明

### 硬編碼繞過（方案 A）
- **零資料外發**
- GrowthBook SDK 不啓動
- 完全離線執行

### 自建 GrowthBook（方案 B）
- 資料僅發送到你自己的服務器
- Anthropic 無法取得任何資料
- 可通過 Web UI 實時管理所有 flag

### 恢復原生 1P（方案 C）
- 會發送使用統計到 `api.anthropic.com`
- **不發送**：程式碼、對話內容、API key
- **會發送**：郵箱、設備 ID、機器指紋、倉庫哈希、訂閱類型
- 可用 `DISABLE_TELEMETRY=1` 關閉遙測（但同時關閉 GrowthBook）
