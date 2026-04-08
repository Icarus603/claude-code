# TEAMMEM — 團隊共享記憶

> Feature Flag: `FEATURE_TEAMMEM=1`
> 實現狀態：完整可用（需要 Anthropic OAuth + GitHub remote）
> 引用數：51

## 一、功能概述

TEAMMEM 實現基於 GitHub 倉庫的團隊共享記憶系統。`memory/team/` 目錄中的文件雙向同步到 Anthropic 服務器，團隊所有認證成員可共享專案知識。

### 核心特性

- **增量同步**：只上傳內容哈希變化的文件（delta upload）
- **衝突解決**：基於 ETag 的樂觀鎖 + 412 衝突重試
- **密鑰掃描**：上傳前檢測並跳過包含密鑰的文件（PSR M22174）
- **路徑穿越防護**：所有寫入路徑驗證在 `memory/team/` 邊界內
- **分批上傳**：自動拆分超過 200KB 的 PUT 請求避免網關拒絕

## 二、用戶交互

### 同步行爲

| 事件 | 行爲 |
|------|------|
| 專案啓動 | 自動 pull 團隊記憶到 `memory/team/` |
| 本地檔案編輯 | watcher 檢測變更，自動 push |
| 服務端更新 | 下次 pull 時覆蓋本地（server-wins） |
| 密鑰檢測 | 跳過該文件，記錄警告，不阻止其他文件同步 |

### API 端點

```
GET  /api/claude_code/team_memory?repo={owner/repo}             → 完整資料 + entryChecksums
GET  /api/claude_code/team_memory?repo={owner/repo}&view=hashes → 僅 checksums（衝突解決用）
PUT  /api/claude_code/team_memory?repo={owner/repo}             → 上傳 entries（upsert 語義）
```

## 三、實現架構

### 3.1 同步狀態

```ts
type SyncState = {
  lastKnownChecksum: string | null    // ETag 條件請求
  serverChecksums: Map<string, string> // sha256:<hex> 逐文件哈希
  serverMaxEntries: number | null      // 從 413 學習的服務端容量
}
```

### 3.2 Pull 流程（Server → Local）

文件：`src/services/teamMemorySync/index.ts:770-867`

```
pullTeamMemory(state)
      │
      ▼
檢查 OAuth + GitHub remote
      │
      ▼
fetchTeamMemory(state, repo, etag)
  ├── 304 Not Modified → 返回（無變化）
  ├── 404 → 返回（服務端無資料）
  └── 200 → 解析 TeamMemoryData
      │
      ▼
刷新 serverChecksums（per-key hashes）
      │
      ▼
writeRemoteEntriesToLocal(entries)
  ├── 路徑穿越驗證（validateTeamMemKey）
  ├── 檔案大小檢查（> 250KB 跳過）
  ├── 內容比較（相同則跳過寫入）
  └── 並行寫入（Promise.all）
```

### 3.3 Push 流程（Local → Server）

文件：`src/services/teamMemorySync/index.ts:889-1146`

```
pushTeamMemory(state)
      │
      ▼
readLocalTeamMemory(maxEntries)
  ├── 遞歸掃描 memory/team/ 目錄
  ├── 跳過超大文件（> 250KB）
  ├── 密鑰掃描（scanForSecrets，gitleaks 規則）
  └── 按 serverMaxEntries 截斷（如果已知）
      │
      ▼
計算 delta = 本地文件 - serverChecksums
  （只包含哈希不同的文件）
      │
      ▼
batchDeltaByBytes(delta)
  （拆分爲 ≤200KB 的批次）
      │
      ▼
逐批 uploadTeamMemory(state, repo, batch, etag)
  ├── 200 成功 → 更新 serverChecksums
  ├── 412 衝突 → fetchTeamMemoryHashes() 刷新 checksums
  │              → 重試 delta 計算（最多 2 次）
  └── 413 超容量 → 學習 serverMaxEntries
```

### 3.4 密鑰掃描

文件：`src/services/teamMemorySync/secretScanner.ts`

使用 gitleaks 規則模式掃描檔案內容。檢測到密鑰時：
- 跳過該文件（不上傳）
- 記錄 `tengu_team_mem_secret_skipped` 事件（僅記錄規則 ID，不記錄值）
- 不阻止其他文件同步

### 3.5 文件監視

文件：`src/services/teamMemorySync/watcher.ts`

監視 `memory/team/` 目錄變更，觸發自動 push。抑制由 pull 寫入引起的假變更。

### 3.6 路徑安全

文件：`src/memdir/teamMemPaths.ts`

- `validateTeamMemKey(relPath)` — 驗證相對路徑不超出 `memory/team/` 邊界
- `getTeamMemPath()` — 返回 team memory 根目錄路徑

## 四、關鍵設計決策

1. **Server-wins on pull, Local-wins on push**：pull 時服務端內容覆蓋本地；push 時本地編輯覆蓋服務端。本地用戶正在編輯，不應被靜默丟棄
2. **Delta upload**：只上傳哈希變化的條目，節省帶寬。首次 push 爲全量，後續增量
3. **分批 PUT**：單次 PUT ≤200KB，避免 API 網關（~256-512KB）拒絕。每批獨立 upsert，部分失敗不影響已提交批次
4. **密鑰掃描在上傳前**：PSR M22174 要求密鑰永不離開本機。掃描在 `readLocalTeamMemory` 中執行，密鑰文件不進入上傳集
5. **ETag 樂觀鎖**：push 使用 `If-Match` header。412 時 probe `?view=hashes`（只取得 checksums，不下載內容），刷新後重試
6. **服務端容量動態學習**：不假設客戶端容量上限，從 413 的 `extra_details.max_entries` 學習

## 五、使用方式

```bash
# 啓用 feature
FEATURE_TEAMMEM=1 bun run dev

# 前提條件：
# 1. 已通過 Anthropic OAuth 登錄
# 2. 專案有 GitHub remote（git remote -v 顯示 origin）
# 3. memory/team/ 目錄自動建立
```

## 六、外部依賴

| 依賴 | 說明 |
|------|------|
| Anthropic OAuth | first-party 認證 |
| GitHub Remote | `getGithubRepo()` 取得 `owner/repo` 作爲同步 scope |
| Team Memory API | `/api/claude_code/team_memory` 端點 |

## 七、檔案索引

| 文件 | 行數 | 職責 |
|------|------|------|
| `src/services/teamMemorySync/index.ts` | 1257 | 核心同步邏輯（pull/push/sync） |
| `src/services/teamMemorySync/watcher.ts` | — | 文件監視 + 自動同步觸發 |
| `src/services/teamMemorySync/secretScanner.ts` | — | gitleaks 密鑰掃描 |
| `src/services/teamMemorySync/types.ts` | — | Zod schema + 類型定義 |
| `src/services/teamMemorySync/teamMemSecretGuard.ts` | — | 密鑰防護輔助 |
| `src/memdir/teamMemPaths.ts` | — | 路徑驗證 + 目錄管理 |
