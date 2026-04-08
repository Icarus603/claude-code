# DAEMON — 後臺守護進程

> Feature Flag: `FEATURE_DAEMON=1`
> 實現狀態：主進程和 worker 註冊爲 Stub，CLI 路由完整
> 引用數：3

## 一、功能概述

DAEMON 將 Claude Code 變爲後臺守護進程。主進程（supervisor）管理多個 worker 進程的生命週期，通過 Unix 域套接字進行 IPC。適用於持續執行的後臺服務場景（如配合 BRIDGE_MODE 提供遠程控制服務）。

## 二、實現架構

### 2.1 模組狀態

| 模組 | 文件 | 狀態 |
|------|------|------|
| 守護主進程 | `src/daemon/main.ts` | **Stub** — `daemonMain: () => Promise.resolve()` |
| Worker 註冊 | `src/daemon/workerRegistry.ts` | **Stub** — `runDaemonWorker: () => Promise.resolve()` |
| CLI 路由 | `src/entrypoints/cli.tsx` | **佈線** — `--daemon-worker` 和 `daemon` 子命令 |
| 命令註冊 | `src/commands.ts` | **佈線** — DAEMON + BRIDGE_MODE 門控 |

### 2.2 CLI 入口

```
# 啓動守護進程
claude daemon

# 以 worker 身份啓動
claude --daemon-worker=<kind>
```

### 2.3 預期架構

```
Supervisor (daemonMain)
      │
      ├── Worker 1: assistant-mode
      │   └── 接收和處理 assistant 會話
      │
      ├── Worker 2: bridge-sync
      │   └── bridge 訊息同步
      │
      └── Worker 3: proactive
          └── 主動任務執行
      │
      ▼
IPC via Unix Domain Sockets
  - 生命週期管理（啓動、停止、重啓）
  - 工作分發
  - 狀態報告
```

### 2.4 與 BRIDGE_MODE 的關係

DAEMON 和 BRIDGE_MODE 常組合使用：

```ts
// src/commands.ts
if (feature('DAEMON') && feature('BRIDGE_MODE')) {
  // 加載 remoteControlServer 命令
}
```

雙重門控：兩個 feature 都需要開啓才能使用遠程控制服務器。

## 三、需要補全的內容

| 模組 | 工作量 | 說明 |
|------|--------|------|
| `daemon/main.ts` | 大 | Supervisor 主進程：啓動 worker、生命週期管理、IPC |
| `daemon/workerRegistry.ts` | 中 | Worker 類型分發（assistant/bridge-sync/proactive） |
| Worker 實現 | 大 | 各類型 worker 的具體實現 |
| IPC 協議 | 中 | Supervisor-Worker 通信層 |

## 四、關鍵設計決策

1. **多進程架構**：一個 supervisor + 多個 worker，進程隔離
2. **Unix 域套接字 IPC**：本地進程間通信，低延遲
3. **與 BRIDGE_MODE 強綁定**：守護進程最常見的用途是提供遠程控制服務
4. **CLI 子命令路由**：`daemon` 子命令和 `--daemon-worker` 參數在 `cli.tsx` 中路由

## 五、使用方式

```bash
# 啓用守護進程模式
FEATURE_DAEMON=1 FEATURE_BRIDGE_MODE=1 bun run dev

# 啓動守護進程
claude daemon

# 以特定 worker 啓動
claude --daemon-worker=assistant
```

## 六、檔案索引

| 文件 | 職責 |
|------|------|
| `src/daemon/main.ts` | Supervisor 主進程（stub） |
| `src/daemon/workerRegistry.ts` | Worker 註冊（stub） |
| `src/entrypoints/cli.tsx:95,149` | CLI 路由 |
| `src/commands.ts:77` | 命令註冊（雙重門控） |
