# Git 工具測試計劃

## 概述

Git 工具模組提供 git 遠程 URL 規範化、倉庫根目錄查找、裸倉庫安全檢測等功能。測試重點是純函數的 URL 規範化和需要檔案系統 mock 的倉庫發現邏輯。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/utils/git.ts` | `normalizeGitRemoteUrl`, `findGitRoot`, `findCanonicalGitRoot`, `getIsGit`, `isAtGitRoot`, `getRepoRemoteHash`, `isCurrentDirectoryBareGitRepo`, `gitExe`, `getGitState`, `stashToCleanState`, `preserveGitStateForIssue` |

---

## 測試用例

### describe('normalizeGitRemoteUrl')（純函數）

#### SSH 格式

- test('normalizes SSH URL') — `'git@github.com:owner/repo.git'` → `'github.com/owner/repo'`
- test('normalizes SSH URL without .git suffix') — `'git@github.com:owner/repo'` → `'github.com/owner/repo'`
- test('handles GitLab SSH') — `'git@gitlab.com:group/subgroup/repo.git'` → `'gitlab.com/group/subgroup/repo'`

#### HTTPS 格式

- test('normalizes HTTPS URL') — `'https://github.com/owner/repo.git'` → `'github.com/owner/repo'`
- test('normalizes HTTPS URL without .git suffix') — `'https://github.com/owner/repo'` → `'github.com/owner/repo'`
- test('normalizes HTTP URL') — `'http://github.com/owner/repo.git'` → `'github.com/owner/repo'`

#### SSH:// 協議格式

- test('normalizes ssh:// URL') — `'ssh://git@github.com/owner/repo'` → `'github.com/owner/repo'`
- test('handles user prefix in ssh://') — `'ssh://user@host/path'` → `'host/path'`

#### 代理 URL（CCR git proxy）

- test('normalizes legacy proxy URL') — `'http://local_proxy@127.0.0.1:16583/git/owner/repo'` → `'github.com/owner/repo'`
- test('normalizes GHE proxy URL') — `'http://user@127.0.0.1:8080/git/ghe.company.com/owner/repo'` → `'ghe.company.com/owner/repo'`

#### 邊界情況

- test('returns null for empty string') — `''` → null
- test('returns null for whitespace') — `'  '` → null
- test('returns null for unrecognized format') — `'not-a-url'` → null
- test('output is lowercase') — `'git@GitHub.com:Owner/Repo.git'` → `'github.com/owner/repo'`
- test('SSH and HTTPS for same repo produce same result') — 相同倉庫不同協議 → 相同輸出

---

### describe('findGitRoot')（需檔案系統 Mock）

- test('finds git root from nested directory') — `/project/src/utils/` → `/project/`（假設 `/project/.git` 存在）
- test('finds git root from root directory') — `/project/` → `/project/`
- test('returns null for non-git directory') — 無 `.git` → null
- test('handles worktree .git file') — `.git` 爲文件時也識別
- test('memoizes results') — 同一路徑不重複查找

### describe('findCanonicalGitRoot')

- test('returns same as findGitRoot for regular repo')
- test('resolves worktree to main repo root') — worktree 路徑 → 主倉庫根目錄
- test('returns null for non-git directory')

### describe('gitExe')

- test('returns git path string') — 返回字符串
- test('memoizes the result') — 多次呼叫返回同一值

---

### describe('getRepoRemoteHash')（需 Mock）

- test('returns 16-char hex hash') — 返回值爲 16 位十六進制字符串
- test('returns null when no remote') — 無 remote URL 時返回 null
- test('same repo SSH/HTTPS produce same hash') — 不同協議同一倉庫 hash 相同

---

### describe('isCurrentDirectoryBareGitRepo')（需檔案系統 Mock）

- test('detects bare git repo attack vector') — 目錄含 HEAD + objects/ + refs/ 但無有效 .git/HEAD → true
- test('returns false for normal directory') — 普通目錄 → false
- test('returns false for regular git repo') — 有效 .git 目錄 → false

---

## Mock 需求

| 依賴 | Mock 方式 | 說明 |
|------|-----------|------|
| `statSync` | mock module | `findGitRoot` 中的 .git 檢測 |
| `readFileSync` | mock module | worktree .git 檔案讀取 |
| `realpathSync` | mock module | 路徑解析 |
| `execFileNoThrow` | mock module | git 命令執行 |
| `whichSync` | mock module | `gitExe` 中的 git 路徑查找 |
| `getCwd` | mock module | 當前工作目錄 |
| `getRemoteUrl` | mock module | `getRepoRemoteHash` 依賴 |
| 臨時目錄 | `mkdtemp` | 集成測試中建立臨時 git 倉庫 |

## 集成測試場景

### describe('Git repo discovery')（放在 tests/integration/）

- test('findGitRoot works in actual git repo') — 在臨時 git init 的目錄中驗證
- test('normalizeGitRemoteUrl + getRepoRemoteHash produces stable hash') — URL → hash 端到端驗證
