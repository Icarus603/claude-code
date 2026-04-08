# 設定系統測試計劃

## 概述

設定系統包含全局設定（GlobalConfig）、專案設定（ProjectConfig）和設置（Settings）三層。測試重點是純函數校驗邏輯、Zod schema 驗證和設定合併策略。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/utils/config.ts` | `getGlobalConfig`, `saveGlobalConfig`, `getCurrentProjectConfig`, `checkHasTrustDialogAccepted`, `isPathTrusted`, `getOrCreateUserID`, `isAutoUpdaterDisabled` |
| `src/utils/settings/settings.ts` | `getSettingsForSource`, `parseSettingsFile`, `getSettingsFilePathForSource`, `getInitialSettings` |
| `src/utils/settings/types.ts` | `SettingsSchema`（Zod schema） |
| `src/utils/settings/validation.ts` | 設置驗證函數 |
| `src/utils/settings/constants.ts` | 設置常量 |

---

## 測試用例

### src/utils/config.ts — 純函數/常量

#### describe('DEFAULT_GLOBAL_CONFIG')

- test('has all required fields') — 預設設定對象包含所有必需字段
- test('has null auth fields by default') — oauthAccount 等爲 null

#### describe('DEFAULT_PROJECT_CONFIG')

- test('has empty allowedTools') — 預設爲空數組
- test('has empty mcpServers') — 預設爲空對象

#### describe('isAutoUpdaterDisabled')

- test('returns true when CLAUDE_CODE_DISABLE_AUTOUPDATER is set') — env 設置時禁用
- test('returns true when disableAutoUpdater config is true')
- test('returns false by default')

---

### src/utils/config.ts — 需 Mock

#### describe('getGlobalConfig')

- test('returns cached config on subsequent calls') — 快取機制
- test('returns TEST_GLOBAL_CONFIG_FOR_TESTING in test mode')
- test('reads config from ~/.claude.json')
- test('returns default config when file does not exist')

#### describe('saveGlobalConfig')

- test('applies updater function to current config') — updater 修改被保存
- test('creates backup before writing') — 寫入前備份
- test('prevents auth state loss') — `wouldLoseAuthState` 檢查

#### describe('getCurrentProjectConfig')

- test('returns project config for current directory')
- test('returns default config when no project config exists')

#### describe('checkHasTrustDialogAccepted')

- test('returns true when trust is accepted in current directory')
- test('returns true when parent directory is trusted') — 父目錄信任傳遞
- test('returns false when no trust accepted')
- test('caches positive results')

#### describe('isPathTrusted')

- test('returns true for trusted path')
- test('returns false for untrusted path')

#### describe('getOrCreateUserID')

- test('returns existing user ID from config')
- test('creates and persists new ID when none exists')
- test('returns consistent ID across calls')

---

### src/utils/settings/settings.ts

#### describe('getSettingsFilePathForSource')

- test('returns ~/.claude/settings.json for userSettings') — 全局用戶設置路徑
- test('returns .claude/settings.json for projectSettings') — 專案設置路徑
- test('returns .claude/settings.local.json for localSettings') — 本地設置路徑

#### describe('parseSettingsFile')（需 Mock 檔案讀取）

- test('parses valid settings JSON') — 有效 JSON → `{ settings, errors: [] }`
- test('returns errors for invalid fields') — 無效字段 → errors 非空
- test('returns empty settings for non-existent file')
- test('handles JSON with comments') — JSONC 格式支援

#### describe('getInitialSettings')

- test('merges settings from all sources') — user + project + local 合併
- test('later sources override earlier ones') — 優先級：policy > user > project > local

---

### src/utils/settings/types.ts — Zod Schema 驗證

#### describe('SettingsSchema validation')

- test('accepts valid minimal settings') — `{}` → 有效
- test('accepts permissions block') — `{ permissions: { allow: ['Bash(*)'] } }` → 有效
- test('accepts model setting') — `{ model: 'sonnet' }` → 有效
- test('accepts hooks configuration') — 有效的 hooks 對象被接受
- test('accepts env variables') — `{ env: { FOO: 'bar' } }` → 有效
- test('rejects unknown top-level keys') — 未知字段被拒絕或忽略（取決於 schema 設定）
- test('rejects invalid permission mode') — `{ permissions: { defaultMode: 'invalid' } }` → 錯誤
- test('rejects non-string model') — `{ model: 123 }` → 錯誤
- test('accepts mcpServers configuration') — MCP server 設定有效
- test('accepts sandbox configuration')

---

### src/utils/settings/validation.ts

#### describe('settings validation')

- test('validates permission rules format') — `'Bash(npm install)'` 格式正確
- test('rejects malformed permission rules')
- test('validates hook configuration structure')
- test('provides helpful error messages') — 錯誤信息包含字段路徑

---

## Mock 需求

| 依賴 | Mock 方式 | 說明 |
|------|-----------|------|
| 檔案系統 | 臨時目錄 + mock | config 文件讀寫 |
| `lockfile` | mock module | 檔案鎖 |
| `getCwd` | mock module | 專案路徑判斷 |
| `findGitRoot` | mock module | 專案根目錄 |
| `process.env` | 直接設置/恢復 | `CLAUDE_CODE_DISABLE_AUTOUPDATER` 等 |

### 測試用臨時文件結構

```
/tmp/claude-test-xxx/
├── .claude/
│   ├── settings.json        # projectSettings
│   └── settings.local.json  # localSettings
├── home/
│   └── .claude/
│       └── settings.json    # userSettings（mock HOME）
└── project/
    └── .git/
```

## 集成測試場景

### describe('Config + Settings merge pipeline')

- test('user settings + project settings merge correctly') — 驗證合併優先級
- test('deny rules from settings are reflected in tool permission context')
- test('trust dialog state persists across config reads')
