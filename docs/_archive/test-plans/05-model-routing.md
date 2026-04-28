# 模型路由測試計劃

## 概述

模型路由系統負責 API provider 選擇、模型別名解析、模型名規範化和執行時模型決策。測試重點是純函數和環境變量驅動的邏輯。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/utils/model/aliases.ts` | `MODEL_ALIASES`, `MODEL_FAMILY_ALIASES`, `isModelAlias`, `isModelFamilyAlias` |
| `src/utils/model/providers.ts` | `APIProvider`, `getAPIProvider`, `isFirstPartyAnthropicBaseUrl` |
| `src/utils/model/model.ts` | `firstPartyNameToCanonical`, `getCanonicalName`, `parseUserSpecifiedModel`, `normalizeModelStringForAPI`, `getRuntimeMainLoopModel`, `getDefaultMainLoopModelSetting` |

---

## 測試用例

### src/utils/model/aliases.ts

#### describe('isModelAlias')

- test('returns true for "sonnet"') — 有效別名
- test('returns true for "opus"')
- test('returns true for "haiku"')
- test('returns true for "best"')
- test('returns true for "sonnet[1m]"')
- test('returns true for "opus[1m]"')
- test('returns true for "opusplan"')
- test('returns false for full model ID') — `'claude-sonnet-4-6-20250514'` → false
- test('returns false for unknown string') — `'gpt-4'` → false
- test('is case-sensitive') — `'Sonnet'` → false（別名是小寫）

#### describe('isModelFamilyAlias')

- test('returns true for "sonnet"')
- test('returns true for "opus"')
- test('returns true for "haiku"')
- test('returns false for "best"') — best 不是 family alias
- test('returns false for "opusplan"')
- test('returns false for "sonnet[1m]"')

---

### src/utils/model/providers.ts

#### describe('getAPIProvider')

- test('returns "firstParty" by default') — 無相關 env 時返回 firstParty
- test('returns "bedrock" when CLAUDE_CODE_USE_BEDROCK is set') — env 爲 truthy 值
- test('returns "vertex" when CLAUDE_CODE_USE_VERTEX is set')
- test('returns "foundry" when CLAUDE_CODE_USE_FOUNDRY is set')
- test('bedrock takes precedence over vertex') — 多個 env 同時設置時 bedrock 優先

#### describe('isFirstPartyAnthropicBaseUrl')

- test('returns true when ANTHROPIC_BASE_URL is not set') — 預設 API
- test('returns true for api.anthropic.com') — `'https://api.anthropic.com'` → true
- test('returns false for custom URL') — `'https://my-proxy.com'` → false
- test('returns false for invalid URL') — 非法 URL → false
- test('returns true for staging URL when USER_TYPE is ant') — `'https://api-staging.anthropic.com'` + ant → true

---

### src/utils/model/model.ts

#### describe('firstPartyNameToCanonical')

- test('maps opus-4-6 full name to canonical') — `'claude-opus-4-6-20250514'` → `'claude-opus-4-6'`
- test('maps sonnet-4-6 full name') — `'claude-sonnet-4-6-20250514'` → `'claude-sonnet-4-6'`
- test('maps haiku-4-5') — `'claude-haiku-4-5-20251001'` → `'claude-haiku-4-5'`
- test('maps 3P provider format') — `'us.anthropic.claude-opus-4-6-v1:0'` → `'claude-opus-4-6'`
- test('maps claude-3-7-sonnet') — `'claude-3-7-sonnet-20250219'` → `'claude-3-7-sonnet'`
- test('maps claude-3-5-sonnet') → `'claude-3-5-sonnet'`
- test('maps claude-3-5-haiku') → `'claude-3-5-haiku'`
- test('maps claude-3-opus') → `'claude-3-opus'`
- test('is case insensitive') — `'Claude-Opus-4-6'` → `'claude-opus-4-6'`
- test('falls back to input for unknown model') — `'unknown-model'` → `'unknown-model'`
- test('differentiates opus-4 vs opus-4-5 vs opus-4-6') — 更具體的版本優先匹配

#### describe('parseUserSpecifiedModel')

- test('resolves "sonnet" to default sonnet model')
- test('resolves "opus" to default opus model')
- test('resolves "haiku" to default haiku model')
- test('resolves "best" to best model')
- test('resolves "opusplan" to default sonnet model') — opusplan 預設用 sonnet
- test('appends [1m] suffix when alias has [1m]') — `'sonnet[1m]'` → 模型名 + `'[1m]'`
- test('preserves original case for custom model names') — `'my-Custom-Model'` 保留大小寫
- test('handles [1m] suffix on non-alias models') — `'custom-model[1m]'` → `'custom-model[1m]'`
- test('trims whitespace') — `'  sonnet  '` → 正確解析

#### describe('getRuntimeMainLoopModel')

- test('returns mainLoopModel by default') — 無特殊條件時原樣返回
- test('returns opus in plan mode when opusplan is set') — opusplan + plan mode → opus
- test('returns sonnet in plan mode when haiku is set') — haiku + plan mode → sonnet 升級
- test('returns mainLoopModel in non-plan mode') — 非 plan 模式不做替換

---

## Mock 需求

| 依賴 | Mock 方式 | 說明 |
|------|-----------|------|
| `process.env.CLAUDE_CODE_USE_BEDROCK/VERTEX/FOUNDRY` | 直接設置/恢復 | provider 選擇 |
| `process.env.ANTHROPIC_BASE_URL` | 直接設置/恢復 | URL 檢測 |
| `process.env.USER_TYPE` | 直接設置/恢復 | staging URL 和 ant 功能 |
| `getModelStrings()` | mock.module | 返回固定模型 ID |
| `getMainLoopModelOverride` | mock.module | 會話中模型覆蓋 |
| `getSettings_DEPRECATED` | mock.module | 用戶設置中的模型 |
| `getUserSpecifiedModelSetting` | mock.module | `getRuntimeMainLoopModel` 依賴 |
| `isModelAllowed` | mock.module | allowlist 檢查 |
