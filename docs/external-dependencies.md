# Claude Code 遠程服務器依賴

> 只列出程式碼中實際發起網絡請求的遠程服務。本地服務、npm 包依賴、展示用 URL 不包含在內。

## 總覽表

| # | 服務 | 遠程端點 | 協議 | 狀態 |
|---|---|---|---|---|
| 1 | Anthropic API | `api.anthropic.com` | HTTPS | 預設啓用 |
| 2 | AWS Bedrock | `bedrock-runtime.*.amazonaws.com` | HTTPS | 需 `CLAUDE_CODE_USE_BEDROCK=1` |
| 3 | Google Vertex AI | `{region}-aiplatform.googleapis.com` | HTTPS | 需 `CLAUDE_CODE_USE_VERTEX=1` |
| 4 | Azure Foundry | `{resource}.services.ai.azure.com` | HTTPS | 需 `CLAUDE_CODE_USE_FOUNDRY=1` |
| 5 | OAuth (Anthropic) | `platform.claude.com`, `claude.com`, `claude.ai` | HTTPS | 用戶登錄時 |
| 6 | GrowthBook | `api.anthropic.com` (remoteEval) | HTTPS | 預設啓用 |
| 7 | Sentry | 可設定 (`SENTRY_DSN`) | HTTPS | 需設環境變量 |
| 8 | Datadog | 可設定 (`DATADOG_LOGS_ENDPOINT`) | HTTPS | 需設環境變量 |
| 9 | OpenTelemetry Collector | 可設定 (`OTEL_EXPORTER_OTLP_ENDPOINT`) | gRPC/HTTP | 需設環境變量 |
| 10 | 1P Event Logging | `api.anthropic.com/api/event_logging/batch` | HTTPS | 預設啓用 |
| 11 | BigQuery Metrics | `api.anthropic.com/api/claude_code/metrics` | HTTPS | 預設啓用 |
| 12 | MCP Proxy | `mcp-proxy.anthropic.com` | HTTPS+WS | 使用 MCP 工具時 |
| 13 | MCP Registry | `api.anthropic.com/mcp-registry` | HTTPS | 查詢 MCP 服務器時 |
| 14 | Bing Search | `www.bing.com` | HTTPS | WebSearch 工具 |
| 15 | Google Cloud Storage (更新) | `storage.googleapis.com` | HTTPS | 版本檢查 |
| 16 | GitHub Raw (Changelog/Stats) | `raw.githubusercontent.com` | HTTPS | 更新提示 |
| 17 | Claude in Chrome Bridge | `bridge.claudeusercontent.com` | WSS | Chrome 集成 |
| 18 | CCR Upstream Proxy | `api.anthropic.com` | WS | CCR 遠程會話 |
| 19 | Voice STT | `api.anthropic.com/api/ws/...` | WSS | Voice Mode |
| 20 | Desktop App Download | `claude.ai/api/desktop/...` | HTTPS | 下載引導 |

---

## 詳細說明

### 1. Anthropic Messages API

核心 LLM 推理服務，發送對話訊息、接收流式響應。

- **端點**: `https://api.anthropic.com` (生產) / `https://api-staging.anthropic.com` (staging)
- **覆蓋**: `ANTHROPIC_BASE_URL` 環境變量
- **認證**: API Key / OAuth Token
- **文件**: `src/services/api/client.ts`, `src/services/api/claude.ts`

### 2. AWS Bedrock

- **端點**: `bedrock-runtime.{region}.amazonaws.com`
- **認證**: AWS 憑證鏈 / `AWS_BEARER_TOKEN_BEDROCK`
- **文件**: `src/services/api/client.ts:153-190`, `src/utils/aws.ts`

### 3. Google Vertex AI

- **端點**: `{region}-aiplatform.googleapis.com`
- **認證**: `GoogleAuth` + `cloud-platform` scope
- **文件**: `src/services/api/client.ts:228-298`

### 4. Azure Foundry

- **端點**: `https://{resource}.services.ai.azure.com/anthropic/v1/messages`
- **認證**: API Key 或 Azure AD `DefaultAzureCredential`
- **文件**: `src/services/api/client.ts:191-220`

### 5. OAuth

OAuth 2.0 + PKCE 授權碼流程。

- **端點**:
  - `https://platform.claude.com/oauth/authorize` — 授權頁
  - `https://claude.com/cai/oauth/authorize` — Claude.ai 授權
  - `https://platform.claude.com/v1/oauth/token` — Token 交換
  - `https://api.anthropic.com/api/oauth/claude_cli/create_api_key` — 建立 API Key
  - `https://api.anthropic.com/api/oauth/claude_cli/roles` — 取得角色
  - `https://claude.ai/oauth/claude-code-client-metadata` — MCP 客戶端元資料
  - `https://claude.fedstart.com` — FedStart 政府部署
- **文件**: `src/constants/oauth.ts`, `src/services/oauth/`

### 6. GrowthBook (功能開關)

- **端點**: `https://api.anthropic.com/` (remoteEval 模式) 或 `CLAUDE_GB_ADAPTER_URL`
- **SDK Keys**: `sdk-zAZezfDKGoZuXXKe` (外部), `sdk-xRVcrliHIlrg4og4` (ant prod), `sdk-yZQvlplybuXjYh6L` (ant dev)
- **文件**: `src/services/analytics/growthbook.ts`, `src/constants/keys.ts`

### 7. Sentry (錯誤追蹤)

- **激活**: 設置 `SENTRY_DSN` (預設未設定)
- **行爲**: 僅錯誤上報，自動過濾敏感 header
- **文件**: `src/utils/sentry.ts`

### 8. Datadog (日誌)

- **激活**: 同時設 `DATADOG_LOGS_ENDPOINT` + `DATADOG_API_KEY` (預設未設定)
- **文件**: `src/services/analytics/datadog.ts`

### 9. OpenTelemetry Collector

- **激活**: `CLAUDE_CODE_ENABLE_TELEMETRY=1` 或 `OTEL_*` 環境變量
- **協議**: gRPC / HTTP / Protobuf，支援 OTLP 和 Prometheus 導出
- **文件**: `src/utils/telemetry/instrumentation.ts`

### 10. 1P Event Logging (內部事件)

- **端點**: `https://api.anthropic.com/api/event_logging/batch`
- **協議**: 批量導出 (10s 間隔, 每批 200 事件)
- **文件**: `src/services/analytics/firstPartyEventLoggingExporter.ts`

### 11. BigQuery Metrics

- **端點**: `https://api.anthropic.com/api/claude_code/metrics`
- **文件**: `src/utils/telemetry/bigqueryExporter.ts`

### 12. MCP Proxy

Anthropic 託管的 MCP 服務器代理。

- **端點**: `https://mcp-proxy.anthropic.com/v1/mcp/{server_id}`
- **認證**: Claude.ai OAuth tokens
- **文件**: `src/services/mcp/client.ts`, `src/constants/oauth.ts`

### 13. MCP Registry

取得官方 MCP 服務器列表。

- **端點**: `https://api.anthropic.com/mcp-registry/v0/servers?version=latest&visibility=commercial`
- **文件**: `src/services/mcp/officialRegistry.ts`

### 14. Bing Search

WebSearch 工具的預設適配器，抓取 Bing 搜索結果。

- **端點**: `https://www.bing.com/search?q={query}&setmkt=en-US`
- **文件**: `src/tools/WebSearchTool/adapters/bingAdapter.ts`

另外還有 Domain Blocklist 查詢:
- **端點**: `https://api.anthropic.com/api/web/domain_info?domain={domain}`
- **文件**: `src/tools/WebFetchTool/utils.ts`

### 15. Google Cloud Storage (自動更新)

- **端點**: `https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases`
- **文件**: `src/utils/autoUpdater.ts`

### 16. GitHub Raw Content

- **端點**: `https://raw.githubusercontent.com/anthropics/claude-code/refs/heads/main/CHANGELOG.md`
- **端點**: `https://raw.githubusercontent.com/anthropics/claude-plugins-official/refs/heads/stats/stats/plugin-installs.json`
- **文件**: `src/utils/releaseNotes.ts`, `src/utils/plugins/installCounts.ts`

### 17. Claude in Chrome Bridge

- **端點**: `wss://bridge.claudeusercontent.com` (生產) / `wss://bridge-staging.claudeusercontent.com` (staging)
- **文件**: `src/utils/claudeInChrome/mcpServer.ts`

### 18. CCR Upstream Proxy

- **端點**: `ws://api.anthropic.com/v1/code/upstreamproxy/ws`
- **激活**: `CLAUDE_CODE_REMOTE=1` + `CCR_UPSTREAM_PROXY_ENABLED=1`
- **文件**: `src/upstreamproxy/upstreamproxy.ts`

### 19. Voice STT

- **端點**: `wss://api.anthropic.com/api/ws/...`
- **文件**: `src/services/voiceStreamSTT.ts`

### 20. Desktop App Download

- **端點**: `https://claude.ai/api/desktop/win32/x64/exe/latest/redirect` (Windows)
- **端點**: `https://claude.ai/api/desktop/darwin/universal/dmg/latest/redirect` (macOS)
- **文件**: `src/components/DesktopHandoff.tsx`

---

## Anthropic API 輔助端點彙總

以下端點都掛在 `api.anthropic.com` 上，按功能分類:

| 端點路徑 | 用途 | 文件 |
|---|---|---|
| `/api/event_logging/batch` | 事件批量上報 | `src/services/analytics/firstPartyEventLoggingExporter.ts` |
| `/api/claude_code/metrics` | BigQuery 指標導出 | `src/utils/telemetry/bigqueryExporter.ts` |
| `/api/oauth/claude_cli/create_api_key` | 建立 API Key | `src/constants/oauth.ts` |
| `/api/oauth/claude_cli/roles` | 取得用戶角色 | `src/constants/oauth.ts` |
| `/api/oauth/accounts/grove` | 通知設置 | `src/services/api/grove.ts` |
| `/api/oauth/organizations/{id}/referral/*` | 推薦活動 | `src/services/api/referral.ts` |
| `/api/oauth/organizations/{id}/overage_credit_grant` | 超額信用 | `src/services/api/overageCreditGrant.ts` |
| `/api/oauth/organizations/{id}/admin_requests` | 管理請求 | `src/services/api/adminRequests.ts` |
| `/api/web/domain_info?domain={}` | 域名安全檢查 | `src/tools/WebFetchTool/utils.ts` |
| `/api/claude_code/settings` | 設置同步 | `src/services/settingsSync/index.ts` |
| `/api/claude_code/managed_settings` | 企業託管設置 (1h 輪詢) | `src/services/remoteManagedSettings/index.ts` |
| `/api/claude_code/team_memory?repo={}` | 團隊記憶同步 | `src/services/teamMemorySync/index.ts` |
| `/api/auth/trusted_devices` | 可信設備註冊 | `src/bridge/trustedDevice.ts` |
| `/mcp-registry/v0/servers` | MCP 服務器註冊表 | `src/services/mcp/officialRegistry.ts` |
| `/v1/files` | 文件上傳/下載 | `src/services/api/filesApi.ts` |
| `/v1/sessions/{id}/events` | 會話歷史 | `src/assistant/sessionHistory.ts` |
| `/v1/code/triggers` | 遠程觸發器 | `src/tools/RemoteTriggerTool/RemoteTriggerTool.ts` |
| `/v1/organizations/{id}/mcp_servers` | 組織 MCP 設定 | `src/services/mcp/claudeai.ts` |

## 非 Anthropic 遠程域名彙總

| 域名 | 服務 | 協議 |
|---|---|---|
| `bedrock-runtime.*.amazonaws.com` | AWS Bedrock | HTTPS |
| `{region}-aiplatform.googleapis.com` | Google Vertex AI | HTTPS |
| `{resource}.services.ai.azure.com` | Azure Foundry | HTTPS |
| `www.bing.com` | Bing 搜索 | HTTPS |
| `storage.googleapis.com` | 自動更新 | HTTPS |
| `raw.githubusercontent.com` | Changelog / 插件統計 | HTTPS |
| `bridge.claudeusercontent.com` | Chrome Bridge | WSS |
| `platform.claude.com` | OAuth 授權頁 | HTTPS |
| `claude.com` / `claude.ai` | OAuth / 下載 | HTTPS |
| `claude.fedstart.com` | FedStart OAuth | HTTPS |
