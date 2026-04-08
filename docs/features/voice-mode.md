# VOICE_MODE — 語音輸入

> Feature Flag: `FEATURE_VOICE_MODE=1`
> 實現狀態：完整可用（需要 Anthropic OAuth）
> 引用數：46

## 一、功能概述

VOICE_MODE 實現"按鍵說話"（Push-to-Talk）語音輸入。用戶按住空格鍵錄音，音頻通過 WebSocket 流式傳輸到 Anthropic STT 端點（Nova 3），實時轉錄顯示在終端中。

### 核心特性

- **Push-to-Talk**：長按空格鍵錄音，釋放後自動發送
- **流式轉錄**：錄音過程中實時顯示中間轉錄結果
- **無縫集成**：轉錄文本直接作爲用戶訊息提交到對話

## 二、用戶交互

| 操作 | 行爲 |
|------|------|
| 長按空格 | 開始錄音，顯示錄音狀態 |
| 釋放空格 | 停止錄音，等待最終轉錄 |
| 轉錄完成 | 自動插入到輸入框並提交 |
| `/voice` 命令 | 切換語音模式開關 |

### UI 反饋

- **錄音指示器**：錄音時顯示紅色/脈衝動畫
- **中間轉錄**：錄音過程中顯示 STT 實時識別文本
- **最終轉錄**：完成後替換中間結果

## 三、實現架構

### 3.1 門控邏輯

文件：`src/voice/voiceModeEnabled.ts`

三層檢查：

```ts
isVoiceModeEnabled() = hasVoiceAuth() && isVoiceGrowthBookEnabled()
```

1. **Feature Flag**：`feature('VOICE_MODE')` — 編譯時/執行時開關
2. **GrowthBook Kill-Switch**：`!getFeatureValue_CACHED_MAY_BE_STALE('tengu_amber_quartz_disabled', false)` — 緊急關閉開關（預設 false = 未禁用）
3. **Auth 檢查**：`hasVoiceAuth()` — 需要 Anthropic OAuth token（非 API key）

### 3.2 核心模組

| 模組 | 職責 |
|------|------|
| `src/voice/voiceModeEnabled.ts` | Feature flag + GrowthBook + Auth 三層門控 |
| `src/hooks/useVoice.ts` | React hook 管理錄音狀態和 WebSocket 連接 |
| `src/services/voiceStreamSTT.ts` | WebSocket 流式傳輸到 Anthropic STT |

### 3.3 資料流

```
用戶按下空格鍵
      │
      ▼
useVoice hook 激活
      │
      ▼
macOS 原生音頻 / SoX 開始錄音
      │
      ▼
WebSocket 連接到 Anthropic STT 端點
      │
      ├──→ 中間轉錄結果 → 實時顯示
      │
      ▼
用戶釋放空格鍵
      │
      ▼
停止錄音，等待最終轉錄
      │
      ▼
轉錄文本 → 插入輸入框 → 自動提交
```

### 3.4 音頻錄製

支援兩種音頻後端：
- **macOS 原生音頻**：優先使用，低延遲
- **SoX（Sound eXchange）**：回退方案，跨平臺

音頻流通過 WebSocket 發送到 Anthropic 的 Nova 3 STT 模型。

## 四、關鍵設計決策

1. **OAuth 獨佔**：語音模式使用 `voice_stream` 端點（claude.ai），僅 Anthropic OAuth 用戶可用。API key、Bedrock、Vertex 用戶無法使用
2. **GrowthBook 負向門控**：`tengu_amber_quartz_disabled` 預設 `false`，新安裝自動可用（無需等 GrowthBook 初始化）
3. **Keychain 快取**：`getClaudeAIOAuthTokens()` 首次呼叫訪問 macOS keychain（~20-50ms），後續快取命中
4. **獨立於主 feature flag**：`isVoiceGrowthBookEnabled()` 在 feature flag 關閉時短路返回 `false`，不觸發任何模組加載

## 五、使用方式

```bash
# 啓用 feature
FEATURE_VOICE_MODE=1 bun run dev

# 在 REPL 中使用
# 1. 確保已通過 OAuth 登錄（claude.ai 訂閱）
# 2. 按住空格鍵說話
# 3. 釋放空格鍵等待轉錄
# 4. 或使用 /voice 命令切換開關
```

## 六、外部依賴

| 依賴 | 說明 |
|------|------|
| Anthropic OAuth | claude.ai 訂閱登錄，非 API key |
| GrowthBook | `tengu_amber_quartz_disabled` 緊急關閉 |
| macOS 原生音頻 或 SoX | 音頻錄製 |
| Nova 3 STT | 語音轉文本模型 |

## 七、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/voice/voiceModeEnabled.ts` | 55 | 三層門控邏輯 |
| `src/hooks/useVoice.ts` | — | React hook（錄音狀態 + WebSocket） |
| `src/services/voiceStreamSTT.ts` | — | STT WebSocket 流式傳輸 |
