# 遙測與遠程設定下發系統審計（除 Sentry 外）

## 1. Datadog 日誌

**文件**: `src/services/analytics/datadog.ts`

- **端點**: 通過環境變量 `DATADOG_LOGS_ENDPOINT` 設定（預設爲空，即禁用）
- **客戶端 token**: 通過環境變量 `DATADOG_API_KEY` 設定（預設爲空，即禁用）
- **行爲**: 批量發送日誌（15s flush 間隔，100 條上限），僅限 1P（直連 Anthropic API）用戶
- **事件白名單**: `tengu_*` 系列事件（啓動、錯誤、OAuth、工具呼叫等 ~35 種）
- **基線資料**: 收集 model、platform、arch、version、userBucket（用戶 hash 到 30 個桶）等
- **僅限**: `NODE_ENV === 'production'`
- **設定示例**: `DATADOG_LOGS_ENDPOINT=https://http-intake.logs.datadoghq.com/api/v2/logs DATADOG_API_KEY=xxx bun run dev`

## 2. 1P 事件日誌（BigQuery）

**文件**: `src/services/analytics/firstPartyEventLogger.ts` + `firstPartyEventLoggingExporter.ts`

- **端點**: `https://api.anthropic.com/api/event_logging/batch`（staging 可切換）
- **行爲**: 使用 OpenTelemetry SDK 的 `BatchLogRecordProcessor`，批量導出到 Anthropic 自有的 BQ 管道
- **資料**: 完整事件 metadata（session、model、env context、用戶資料、subscription type 等）
- **彈性**: 本地磁盤持久化失敗事件（JSONL），二次退避重試，最多 8 次嘗試
- **Proto schema**: 事件序列化爲 `ClaudeCodeInternalEvent` / `GrowthbookExperimentEvent` protobuf 格式
- **Auth fallback**: 401 時自動去掉 auth header 重試

## 3. GrowthBook 遠程 Feature Flags / 動態設定

**文件**: `src/services/analytics/growthbook.ts`

- **服務端**: `https://api.anthropic.com/`（remote eval 模式）
- **行爲**: 啓動時拉取全量 feature flags，每 6h（外部用戶）/ 20min（ant）定時刷新
- **磁盤快取**: feature values 寫入 `~/.claude.json` 的 `cachedGrowthBookFeatures`
- **用途**:
  - 控制 Datadog 開關（`tengu_log_datadog_events`）
  - 控制事件採樣率（`tengu_event_sampling_config`）
  - 控制 sink killswitch（`tengu_frond_boric`）
  - 控制 BQ batch 設定（`tengu_1p_event_batch_config`）
  - 控制版本上限/自動更新 kill switch
  - 控制遠程管理設置的安全檢查 gate
- **用戶屬性**: 發送 deviceId, sessionId, organizationUUID, accountUUID, email, subscriptionType 等

## 4. Remote Managed Settings（企業遠程設定下發）

**文件**: `src/services/remoteManagedSettings/index.ts`

- **端點**: `{BASE_API_URL}/api/claude_code/settings`
- **行爲**: 企業用戶設定下發，支援 ETag/304 快取，每小時後臺輪詢
- **安全**: 變更包含"危險設置"時彈窗讓用戶確認
- **適用**: API key 用戶全部可拉取；OAuth 用戶僅 Enterprise/C4E/Team
- **Fail-open**: 請求失敗時使用本地快取，無快取則跳過

## 5. Settings Sync（設置同步）

**文件**: `src/services/settingsSync/index.ts`

- **端點**: `{BASE_API_URL}/api/claude_code/user_settings`
- **行爲**: CLI 上傳本地設置/memory 到遠程；CCR 模式從遠程下載
- **同步內容**: userSettings、userMemory、projectSettings、projectMemory
- **Feature gate**: `UPLOAD_USER_SETTINGS` / `DOWNLOAD_USER_SETTINGS`
- **檔案大小限制**: 500KB/文件

## 6. OpenTelemetry 三方遙測

**文件**: `src/utils/telemetry/instrumentation.ts`

- **行爲**: 完整的 OTEL SDK 初始化，支援 metrics / logs / traces 三種信號
- **協議**: gRPC / http-json / http-protobuf（通過 `OTEL_EXPORTER_OTLP_PROTOCOL` 選擇）
- **exporter**: console / otlp / prometheus
- **觸發**: `CLAUDE_CODE_ENABLE_TELEMETRY=1` 環境變量
- **增強 trace**: `feature('ENHANCED_TELEMETRY_BETA')` + GrowthBook gate `enhanced_telemetry_beta`

## 7. BigQuery Metrics Exporter（內部指標）

**文件**: `src/utils/telemetry/bigqueryExporter.ts`

- **端點**: `https://api.anthropic.com/api/claude_code/metrics`
- **行爲**: 定期（5min 間隔）導出 OTel metrics 到內部 BQ
- **適用**: API 客戶、C4E/Team 訂閱者
- **組織級 opt-out**: 通過 `checkMetricsEnabled()` API 查詢（見下方第 8 項）

## 8. 組織級 Metrics Opt-out 查詢

**文件**: `src/services/api/metricsOptOut.ts`

- **端點**: `https://api.anthropic.com/api/claude_code/organizations/metrics_enabled`
- **行爲**: 查詢組織是否啓用了 metrics，二級快取（內存 1h + 磁盤 24h）
- **作用**: 控制 BigQuery metrics exporter 是否導出

## 9. Startup Profiling

**文件**: `src/utils/startupProfiler.ts`

- **行爲**: 採樣啓動性能資料（100% ant / 0.5% 外部），通過 `logEvent('tengu_startup_perf')` 上報
- **詳細模式**: `CLAUDE_CODE_PROFILE_STARTUP=1` 輸出完整性能報告到文件

## 10. Beta Session Tracing

**文件**: `src/utils/telemetry/betaSessionTracing.ts`

- **行爲**: 詳細調試 trace，發送 system prompt、model output、tool schema 等
- **觸發**: `ENABLE_BETA_TRACING_DETAILED=1` + `BETA_TRACING_ENDPOINT`
- **外部用戶**: SDK/headless 模式自動啓用，交互模式需要 GrowthBook gate `tengu_trace_lantern`

## 11. Bridge Poll Config（遠程輪詢間隔設定）

**文件**: `src/bridge/pollConfig.ts`

- **行爲**: 從 GrowthBook 拉取 bridge 輪詢間隔設定（`tengu_bridge_poll_interval_config`）
- **控制**: 單會話和多會話的各種 poll interval

## 12. Plugin/MCP 遙測

**文件**: `src/utils/plugins/fetchTelemetry.ts`

- **行爲**: 記錄 plugin/marketplace 的網絡請求（安裝計數、marketplace clone/pull 等）
- **事件**: `tengu_plugin_remote_fetch`，包含 host（已脫敏）、outcome、duration

---

## 全局禁用方式

```bash
# 禁用所有遙測（Datadog + 1P + 調查問卷）
DISABLE_TELEMETRY=1

# 更激進：禁用所有非必要網絡（包括自動更新、grove、release notes 等）
CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1

# 3P 提供商自動禁用
CLAUDE_CODE_USE_BEDROCK=1  # 或 VERTEX/FOUNDRY
```

`src/utils/privacyLevel.ts` 是集中控制點，三個級別：`default < no-telemetry < essential-traffic`。

---

## 資料流架構

```
用戶操作 → logEvent()
              ↓
         sink.ts (路由層)
           ↙        ↘
   trackDatadogEvent()   logEventTo1P()
          ↓                      ↓
   Datadog HTTP API     OTel BatchLogRecordProcessor
   (us5.datadoghq.com)       ↓
                    FirstPartyEventLoggingExporter
                             ↓
                    api.anthropic.com/api/event_logging/batch
                             ↓
                    BigQuery (ClaudeCodeInternalEvent proto)
```

GrowthBook 作爲獨立通道，同時驅動上述兩個 sink 的開關和設定。
