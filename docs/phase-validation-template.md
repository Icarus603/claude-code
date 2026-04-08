# Phase Validation Template

本模板用於 Phase 0 之後的每一個架構調整 PR，確保「先切 seam、再搬實作、最後清相容層」有固定驗收格式。

## 1. Scope

- Phase / PR:
- 目標 seam:
- 本次不處理的範圍:

## 2. Invariants

- 不改變的使用者可見行為:
- 保留中的舊入口 / 相容層:
- 預計何時移除舊入口:

## 3. Implementation

- 新增的中間層 / 模組:
- 依賴方向變更:
- 仍保留的耦合與原因:

## 4. Verification

- 最小驗證:
  - `bun run build`
  - `bun test`
  - `bun run health`
- 真入口驗證:
  - 互動 REPL:
  - headless / print:
  - 指定命令鏈:

## 5. Rollback

- 回退點:
- 可能失效的入口:
- 若回退需要保留的資料 / 設定:
