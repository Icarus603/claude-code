# 自動更新機制

## 概述

Claude Code 擁有一套複雜的多策略自動更新系統，支援三種安裝方式、後臺靜默更新、手動 CLI 命令、服務端版本門控以及更新日誌展示。系統設計目標是在最小用戶幹預下保持 CLI 最新，同時提供回滾和手動控制的兜底手段。

---

## 安裝類型與更新策略

更新策略由安裝方式決定，通過 `src/utils/doctorDiagnostic.ts` 檢測：

| 安裝類型 | 更新策略 | 自動安裝？ |
|---|---|---|
| `native` | 從 GCS/Artifactory 下載二進制文件，通過符號連結激活 | 是（靜默） |
| `npm-global` | `npm install -g` / `bun install -g` | 是（靜默） |
| `npm-local` | `npm install` 到 `~/.claude/local/` | 是（靜默） |
| `package-manager` | 顯示通知，附帶對應操作系統的升級命令 | 否（僅通知） |
| `development` | 不適用 — 執行 `claude update` 時報錯 | 不適用 |

### 策略路由

`src/components/AutoUpdaterWrapper.tsx` — 掛載在 React/Ink UI 樹中 — 檢測安裝類型並渲染對應的更新組件：

- `native` → `NativeAutoUpdater`（二進制下載 + 符號連結）
- `package-manager` → `PackageManagerAutoUpdater`（僅通知）
- 其他 → `AutoUpdater`（基於 JS/npm）

---

## 後臺自動更新循環

三個更新組件共享相同的輪詢模式：

```typescript
useInterval(checkForUpdates, 30 * 60 * 1000); // 每 30 分鐘
```

組件掛載時（即啓動時）也會執行一次檢查。

### 前置檢查門控

任何更新嘗試之前，系統會依次檢查：

1. **自動更新是否被禁用？** — `getAutoUpdaterDisabledReason()`（`src/utils/config.ts:1735`）
   - `NODE_ENV === 'development'`
   - 設置了 `DISABLE_AUTOUPDATER` 環境變量
   - 僅限必要流量模式
   - `config.autoUpdates === false`（native 安裝的保護模式除外）
2. **最大版本上限？** — `getMaxVersion()`（`src/utils/autoUpdater.ts:108`）— 服務端熔斷開關，防止更新到已知有問題的版本
3. **是否跳過該版本？** — `shouldSkipVersion()`（`src/utils/autoUpdater.ts:145`）— 尊重用戶的 `minimumVersion` 設置，防止切換到 stable 頻道時發生意外的版本降級

### Native 自動更新器（`src/components/NativeAutoUpdater.tsx`）

1. 呼叫 `src/utils/nativeInstaller/installer.ts` 中的 `installLatest()`
2. 通過 `src/utils/nativeInstaller/download.ts` 下載二進制文件（GCS 或 Artifactory）
3. 驗證 SHA256 校驗和（3 次重試，60 秒卡頓檢測）
4. 將版本化二進制文件存儲到 XDG 目錄
5. 更新符號連結（`~/.local/bin/claude` → 新版本二進制文件）
6. 保留最近 2 個版本，清理舊版本
7. 將錯誤分類上報分析（超時、校驗和、權限、磁盤空間不足、npm、網絡）

### JS/npm 自動更新器（`src/components/AutoUpdater.tsx`）

1. 呼叫 `getLatestVersion()` 取得當前 npm dist-tag
2. 通過 semver `gte()` 比較版本
3. 根據安裝類型路由到本地或全局安裝
4. 使用檔案鎖（`acquireLock()` / `releaseLock()`）防止併發更新

### 包管理器通知器（`src/components/PackageManagerAutoUpdater.tsx`）

每 30 分鐘通過 GCS 存儲桶（非 npm）檢查更新。**不會自動安裝** — 僅顯示對應操作系統的升級命令：

- macOS: `brew upgrade claude-code`
- Windows: `winget upgrade Anthropic.ClaudeCode`
- Alpine: `apk upgrade claude-code`

---

## 啓動版本門控

`src/utils/autoUpdater.ts:70` — `assertMinVersion()`

從 `src/main.tsx:1775` 在啓動時呼叫：

```typescript
void assertMinVersion();
```

1. 從 GrowthBook 動態設定取得 `tengu_version_config`
2. 如果 `MACRO.VERSION < minVersion`，打印錯誤信息並呼叫 `gracefulShutdownSync(1)` — 強制用戶更新
3. 這是一個**硬性門控** — 低於最低版本的 CLI 將無法啓動

---

## 手動 CLI 命令

### `claude update` / `claude upgrade`

**文件**: `src/cli/update.ts`

完整流程：
1. 執行 `getDoctorDiagnostic()` 檢查系統健康狀態
2. 檢查是否存在多個安裝及設定不一致
3. 根據安裝類型路由：
   - `development` → 報錯（"開發版本不支援自動更新"）
   - `package-manager` → 打印對應操作系統的更新命令
   - `native` → 使用原生安裝器的 `updateLatest()`
   - `npm-local` → 在 `~/.claude/local/` 執行 `npm install`
   - `npm-global` → 執行 `npm install -g`（含權限檢查）
4. 報告當前版本、最新版本、成功/失敗狀態

### `claude rollback [target]`（僅限內部）

回滾到之前的版本。支援 `--list`、`--dry-run`、`--safe` 標誌。

### `claude install [target]`

安裝或重新安裝原生構建版本。接受可選的版本目標參數。

### `claude doctor`

檢查自動更新器的健康狀態，報告狀態、權限和設定信息。

---

## 原生安裝器架構

**文件**: `src/utils/nativeInstaller/installer.ts`

### 二進制文件存儲佈局

```
~/.local/share/claude-code/
├── versions/          # 版本化二進制文件 (claude-1.0.3, claude-1.0.4, ...)
├── staging/           # 臨時下載暫存區
└── locks/             # 基於 PID 和 mtime 的鎖文件

~/.local/bin/claude    # 指向當前版本二進制文件的符號連結
```

Windows 系統使用文件複製而非符號連結。

### 核心操作

| 函數 | 說明 |
|---|---|
| `updateLatest()` | 核心更新流程：最大版本上限 → 跳過檢查 → 加鎖 → 下載 → 安裝 → 更新符號連結 |
| `installLatest()` | Singleflight 包裝版本，防止重複的進行中安裝 |
| `cleanupOldVersions()` | 保留最近 2 個版本，清理過期的暫存區和臨時文件 |
| `lockCurrentVersion()` | 進程生命週期鎖，防止正在執行的版本被刪除 |
| `cleanupNpmInstallations()` | 遷移到原生安裝時清理舊的 npm 安裝 |

### 下載與校驗

**文件**: `src/utils/nativeInstaller/download.ts`

1. 路由到 Artifactory（內部用戶）或 GCS 存儲桶（外部用戶）
2. 下載二進制文件並跟蹤進度
3. SHA256 校驗和驗證
4. 60 秒卡頓檢測（中止停滯的下載）
5. 失敗時自動重試 3 次

---

## 檔案鎖機制

**文件**: `src/utils/autoUpdater.ts:176-268`

防止併發更新進程破壞安裝：

- 鎖文件：`~/.claude/update.lock`（或等效路徑）
- 5 分鐘超時 — 超過 5 分鐘的鎖被視爲過期，強制取得
- 進程將其 PID 寫入鎖文件
- `acquireLock()` 和 `releaseLock()` 同時被 JS/npm 和原生安裝器使用

---

## 設定

### 設置項

**文件**: `src/utils/settings/types.ts`

| 設置項 | 類型 | 說明 |
|---|---|---|
| `autoUpdatesChannel` | `'latest' \| 'stable'` | 自動更新的發佈頻道 |
| `minimumVersion` | string | 最低版本要求，防止意外的版本降級 |

### 全局設定

**文件**: `src/utils/config.ts:191-193`

| 字段 | 類型 | 說明 |
|---|---|---|
| `autoUpdates` | boolean | 啓用/禁用自動更新（舊版） |
| `autoUpdatesProtectedForNative` | boolean | 原生安裝始終自動更新 |

### 設定遷移

**文件**: `src/migrations/migrateAutoUpdatesToSettings.ts`

一次性將舊版 `globalConfig.autoUpdates = false` 遷移爲 settings 中的 `DISABLE_AUTOUPDATER=1` 環境變量。從 `src/main.tsx:325` 在啓動時呼叫。

---

## 更新通知去重

**文件**: `src/hooks/useUpdateNotification.ts`

React hook `useUpdateNotification(updatedVersion)` — 確保每次 semver 變更（major.minor.patch）只顯示一次"重啓以更新"訊息，避免同一版本的重複通知。

---

## 更新日誌

**文件**: `src/utils/releaseNotes.ts`

1. 從 `src/setup.ts:387` 在每次啓動時呼叫
2. 從 GitHub 取得 changelog
3. 快取到 `~/.claude/cache/changelog.md`
4. 展示比 `lastReleaseNotesSeen` 更新的版本的更新日誌
5. 使用 semver 比較確定需要展示哪些日誌

---

## 版本比較

**文件**: `src/utils/semver.ts`

- 提供 `gt()`、`gte()`、`lt()`、`lte()`、`satisfies()`、`order()`
- 在 Bun 環境下使用 `Bun.semver.order()`（快 20 倍）
- 在 Node.js 環境下回退到 npm `semver` 包

---

## 分析事件

所有更新相關的遙測資料使用 `tengu_` 前綴的事件：

| 類別 | 事件 |
|---|---|
| 版本檢查 | `tengu_version_check_success`、`tengu_version_check_failure` |
| JS 自動更新器 | `tengu_auto_updater_start/success/fail/up_to_date/lock_contention` |
| 原生自動更新器 | `tengu_native_auto_updater_start/success/fail` |
| 原生更新 | `tengu_native_update_complete/skipped_max_version/skipped_minimum_version` |
| 鎖機制 | `tengu_version_lock_acquired/failed`、`tengu_native_update_lock_failed` |
| 二進制下載 | `tengu_binary_download_attempt/success/failure`、`tengu_binary_manifest_fetch_failure` |
| 清理 | `tengu_native_version_cleanup`、`tengu_native_staging_cleanup`、`tengu_native_stale_locks_cleanup` |
| 安裝 | `tengu_native_install_package_success/failure`、`tengu_native_install_binary_success/failure` |
| 手動更新 | `tengu_update_check` |
| 遷移 | `tengu_migrate_autoupdates_to_settings`、`tengu_migrate_autoupdates_error` |

---

## 關鍵檔案索引

| 文件 | 職責 |
|---|---|
| `src/utils/autoUpdater.ts` | 核心邏輯：版本檢查、npm 安裝、檔案鎖、最低/最高版本門控 |
| `src/cli/update.ts` | `claude update` 命令處理 |
| `src/utils/nativeInstaller/installer.ts` | 原生二進制安裝器：下載、版本管理、符號連結、清理 |
| `src/utils/nativeInstaller/download.ts` | 從 GCS/Artifactory 下載二進制文件並校驗 |
| `src/utils/localInstaller.ts` | 本地安裝器（`~/.claude/local/`）基於 npm |
| `src/components/AutoUpdaterWrapper.tsx` | 基於安裝類型的策略路由 |
| `src/components/AutoUpdater.tsx` | JS/npm 後臺自動更新器（30 分鐘間隔） |
| `src/components/NativeAutoUpdater.tsx` | 原生二進制後臺自動更新器（30 分鐘間隔） |
| `src/components/PackageManagerAutoUpdater.tsx` | 包管理器通知（30 分鐘，僅展示） |
| `src/hooks/useUpdateNotification.ts` | 按 semver 去重更新通知 |
| `src/utils/releaseNotes.ts` | Changelog 取得、快取與展示 |
| `src/utils/semver.ts` | Semver 版本比較（Bun 原生 + npm 回退） |
| `src/utils/doctorDiagnostic.ts` | 安裝類型檢測與健康診斷 |
| `src/utils/config.ts:1735` | `getAutoUpdaterDisabledReason()` — 禁用檢查邏輯 |
| `src/migrations/migrateAutoUpdatesToSettings.ts` | 舊版設定遷移 |
| `src/screens/Doctor.tsx` | Doctor 命令 UI，展示自動更新狀態 |

---

## 流程圖

```
啓動階段
  ├── assertMinVersion() → 版本過低時硬性攔截，拒絕啓動
  ├── migrateAutoUpdatesToSettings() → 一次性設定遷移
  └── checkForReleaseNotes() → 展示新版本的更新日誌

REPL 執行中（每 30 分鐘）
  ├── AutoUpdaterWrapper 檢測安裝類型
  │
  ├── native → NativeAutoUpdater
  │     ├── 從 GCS/Artifactory 取得版本
  │     ├── 檢查最大版本上限（服務端控制）
  │     ├── 檢查 minimumVersion 設置（跳過）
  │     ├── acquireLock()
  │     ├── downloadAndVerifyBinary()（SHA256 校驗，3 次重試）
  │     ├── 安裝到 versions/ 目錄
  │     ├── 更新符號連結
  │     └── cleanupOldVersions()（保留 2 個版本）
  │
  ├── npm-global/local → AutoUpdater
  │     ├── 從 npm registry 取得最新版本
  │     ├── semver 版本比較
  │     ├── acquireLock()
  │     └── npm install -g / 本地安裝
  │
  └── package-manager → PackageManagerAutoUpdater
        ├── 從 GCS 取得版本
        └── 顯示 "Run: brew upgrade ..."（不自動安裝）

手動操作
  └── claude update → 完整診斷 + 安裝編排
```
