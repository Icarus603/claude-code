# BRIDGE_MODE — 遠程控制

> Feature Flag: `FEATURE_BRIDGE_MODE=1`
> 實現狀態：完整可用（v1 + v2 實現）
> 引用數：28

## 一、功能概述

BRIDGE_MODE 將本地 CLI 註冊爲"bridge 環境"，可從 claude.ai 或其他控制面遠程驅動。本地終端變爲一個"執行者"，接受遠程指令並執行。

### 核心特性

- **環境註冊**：本地 CLI 向 Anthropic 服務器註冊爲可用的 bridge 環境
- **工作輪詢**：長輪詢（long-poll）等待遠程任務分配
- **會話管理**：建立、恢復、歸檔遠程會話
- **權限透傳**：遠程權限請求發送到控制面，用戶在 claude.ai 上批准/拒絕
- **心跳保活**：定期發送 heartbeat 延長任務租約
- **可信設備**：v2 支援可信設備令牌增強安全性

## 二、實現架構

### 2.1 版本演進

| 版本 | 實現 | 特點 |
|------|------|------|
| v1（env-based） | `src/bridge/replBridge.ts` | 基於環境變量的傳統 bridge |
| v2（env-less） | `src/bridge/remoteBridgeCore.ts` | 無需環境變量，更安全的 bridge |

### 2.2 API 協議

文件：`src/bridge/bridgeApi.ts`

Bridge API Client 提供 7 個核心操作：

| 操作 | HTTP | 說明 |
|------|------|------|
| `registerBridgeEnvironment` | POST `/v1/environments/bridge` | 註冊本地環境，取得 `environment_id` + `environment_secret` |
| `pollForWork` | GET `/v1/environments/{id}/work/poll` | 長輪詢等待任務（10s 超時） |
| `acknowledgeWork` | POST `/v1/environments/{id}/work/{workId}/ack` | 確認接收任務 |
| `stopWork` | POST `/v1/environments/{id}/work/{workId}/stop` | 停止任務 |
| `heartbeatWork` | POST `/v1/environments/{id}/work/{workId}/heartbeat` | 續約任務租約 |
| `deregisterEnvironment` | DELETE `/v1/environments/bridge/{id}` | 註銷環境 |
| `archiveSession` | POST `/v1/sessions/{id}/archive` | 歸檔會話（409 = 已歸檔，冪等） |
| `sendPermissionResponseEvent` | POST `/v1/sessions/{id}/events` | 發送權限審批結果 |
| `reconnectSession` | POST `/v1/environments/{id}/bridge/reconnect` | 重連已存在的會話 |

### 2.3 認證流程

```
註冊: OAuth Bearer Token → 取得 environment_secret
輪詢: environment_secret 作爲 Authorization
  ├── 401 → 嘗試 OAuth token 刷新（onAuth401）
  └── 刷新成功 → 重試一次
```

**OAuth 刷新**：API client 內置 `withOAuthRetry` 機制。401 時呼叫 `handleOAuth401Error`（同 withRetry.ts 的 v1/messages 模式），刷新後重試一次。

### 2.4 安全設計

- **路徑穿越防護**：`validateBridgeId()` 使用 `/^[a-zA-Z0-9_-]+$/` 白名單驗證所有服務端 ID
- **BridgeFatalError**：不可重試的錯誤（401/403/404/410）直接拋出，阻止重試循環
- **可信設備令牌**：v2 通過 `X-Trusted-Device-Token` header 增強安全層級
- **冪等註冊**：支援 `reuseEnvironmentId` 實現會話恢復，避免重複建立環境

### 2.5 資料流

```
claude.ai 用戶選擇遠程環境
         │
         ▼
POST /v1/environments/bridge (註冊)
         │
         ◀── environment_id + environment_secret
         │
         ▼
GET .../work/poll (長輪詢)
         │
         ◀── WorkResponse { id, data: { type, sessionId } }
         │
         ▼
POST .../work/{id}/ack (確認)
         │
         ▼
sessionRunner 建立 REPL session
         │
         ├── 權限請求 → sendPermissionResponseEvent
         ├── 心跳 → heartbeatWork (續約)
         └── 任務完成 → 自動歸檔
```

### 2.6 模組結構

| 模組 | 文件 | 職責 |
|------|------|------|
| API Client | `bridgeApi.ts` | HTTP 通信（註冊/輪詢/確認/心跳/註銷） |
| Session Runner | `sessionRunner.ts` | 建立/恢復 REPL 會話 |
| Bridge Config | `bridgeConfig.ts` | 設定管理（machine name、max sessions 等） |
| Transport | `replBridgeTransport.ts` | Bridge 傳輸層 |
| Permission Callbacks | `bridgePermissionCallbacks.ts` | 權限請求處理 |
| Pointer | `bridgePointer.ts` | 當前活躍 bridge 狀態指針 |
| Flush Gate | `flushGate.ts` | 刷新控制 |
| JWT Utils | `jwtUtils.ts` | JWT 令牌工具 |
| Trusted Device | `trustedDevice.ts` | 可信設備管理 |
| Debug Utils | `debugUtils.ts` | 調試日誌 |
| Types | `types.ts` | 類型定義 |

## 三、關鍵設計決策

1. **長輪詢而非 WebSocket**：`pollForWork` 使用 HTTP GET + 10s 超時。簡單可靠，無需維護 WebSocket 連接
2. **OAuth 刷新內嵌**：API client 自帶 `withOAuthRetry`，無需外層重試邏輯
3. **ETag 條件請求**：註冊時支援 `reuseEnvironmentId` 實現冪等會話恢復
4. **v1/v2 共存**：程式碼中同時存在兩套實現，v2 是更安全的升級版
5. **權限雙向流動**：本地權限請求發送到 claude.ai，用戶在 web 上審批

## 四、使用方式

```bash
# 啓用 bridge mode
FEATURE_BRIDGE_MODE=1 bun run dev

# 從 claude.ai/code 遠程連接
# 在 web 界面選擇已註冊的環境

# 配合 DAEMON 使用（後臺守護）
FEATURE_BRIDGE_MODE=1 FEATURE_DAEMON=1 bun run dev
```

## 五、外部依賴

| 依賴 | 說明 |
|------|------|
| Anthropic OAuth | claude.ai 訂閱登錄 |
| GrowthBook | `tengu_ccr_bridge` 門控 |
| Bridge API | `/v1/environments/bridge` 系列端點 |

## 六、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/bridge/bridgeApi.ts` | 540 | API Client（核心） |
| `src/bridge/sessionRunner.ts` | — | 會話執行器 |
| `src/bridge/bridgeConfig.ts` | — | 設定管理 |
| `src/bridge/replBridgeTransport.ts` | — | 傳輸層 |
| `src/bridge/bridgePermissionCallbacks.ts` | — | 權限回調 |
| `src/bridge/bridgePointer.ts` | — | 狀態指針 |
| `src/bridge/flushGate.ts` | — | 刷新控制 |
| `src/bridge/jwtUtils.ts` | — | JWT 工具 |
| `src/bridge/trustedDevice.ts` | — | 可信設備 |
| `src/bridge/remoteBridgeCore.ts` | — | v2 核心實現 |
| `src/bridge/types.ts` | — | 類型定義 |
| `src/bridge/debugUtils.ts` | — | 調試工具 |
| `src/bridge/pollConfigDefaults.ts` | — | 輪詢設定預設值 |
| `src/bridge/bridgeUI.ts` | — | UI 組件 |
| `src/bridge/codeSessionApi.ts` | — | 程式碼會話 API |
| `src/bridge/peerSessions.ts` | — | 對等會話管理 |
| `src/bridge/sessionIdCompat.ts` | — | Session ID 相容層 |
| `src/bridge/createSession.ts` | — | 會話建立 |
| `src/bridge/replBridgeHandle.ts` | — | Bridge 句柄 |
