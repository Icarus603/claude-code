# Milestone Plan — State Dissolution Wave 1

## Context

`src/bootstrap/state.ts`（1,752 行）是整個 V7 重構的**根耦合點**。它是一個
session-global god-singleton,持有 session id / cwd / model / cost / tokens /
permission / hooks / telemetry / 請求捕獲 / 60+ misc 欄位的所有狀態,被 16 個
`src/` 檔案直接匯入,並且 `packages/cli`、`packages/swarm`、`packages/config`、
`packages/agent` 都透過 `@claude-code/app-compat/bootstrap/state.js` 反向相依它。

只要它還在, `packages/cli` 的 229 次 src/ 反向匯入就無法歸零, `doctor:arch`
的 `verify-app-state-boundaries` / `verify-runtime-boundaries` / `verify-ratchet`
就無法進一步收緊,V7.md §3.4「State Lives With Its Owner」也無法達成。

本里程碑是一個**單一 Wave(1–3 天)**, 對 `state.ts` 動三個**乾淨切片**,
每個切片搬到**既有 owner package**, 保留 `state.ts` 為 back-compat facade
(16 個 src 呼叫點完全不動), 搬前先寫 characterization tests(TDD 風)。
完全照搬 commit `4e63221`(config owns allowedSettingSources)的 precedent。

**不做的事**:不拆 session id / cwd / model / cost/tokens / hooks / misc
(這些 owner 不乾淨或 consumer 太多,留給未來 waves)。不新開 package。
不動 `packages/cli` 的 229 次反向匯入(那是下一個里程碑)。

---

## Section 1 — Task Goal & Scope

**Objective**:把 `src/bootstrap/state.ts` 的 3 個最乾淨切片(telemetry、
request-capture、bypass-mode)遷移到 owner package,保留 facade,每個切片先
寫 characterization tests。

**Success criteria(可驗證)**:
1. `src/bootstrap/state.ts` 行數從 1,752 降到 ≤ 1,600(砍掉 telemetry ~50 行
   + request-capture ~40 行 + bypass-mode ~10 行 ≈ 100–150 行;其餘是
   boilerplate + facade re-export)
2. 3 個新檔案存在並通過 TS type-check:
   - `packages/local-observability/src/internal/meterState.ts`
   - `packages/provider/src/internal/requestCaptureState.ts`
   - `packages/permission/src/internal/bypassModeState.ts`
3. 3 個 owner package 的 `package.json` 各新增一條 subpath export(
   `./meterState` / `./requestCaptureState` / `./bypassModeState`)
4. 3 份 characterization 測試存在且全綠,覆蓋每個切片所有 getter/setter 的
   默認值、round-trip、`_resetForTesting()` 語意
5. `bun run doctor:arch` — 所有既有檢查持平或更綠(不允許任何檢查從
   PASS 翻 FAIL)
6. `bun test` — 既有 1,623 個 tests 全綠 + 新增 3 份測試通過
7. `bun run build` 成功 + `echo "say hello" | bun run src/entrypoints/cli.tsx -p` smoke 通過
8. `verify-ratchet` 的 `src/bootstrap/state.ts` budget 或等價指標**收緊至少 1 個點**
9. 16 個 src/ importers **完全不改** — 所有 import 路徑保留為
   `import { ... } from 'src/bootstrap/state.js'`(這是 back-compat 驗證)

**明確 out-of-scope**:
- 拆 session id / cwd / model — owner 不夠乾淨,留未來
- 搬 cost/tokens — `provider` 是 consumer 不是 owner,等專屬 cost package
- 碰 hooks registry — 同時跨 agent / config,需要更大設計
- 解耦 `packages/cli` 的 229 次 src/ 反向匯入 — 下一個里程碑
- 拆 `src/screens/REPLView.tsx`(6,066 行) / `src/utils/messages.ts`(5,543 行) — 未來里程碑
- 移除 15+ 個 `_DEPRECATED` exports — 未來里程碑
- 為 `packages/cli` / `packages/shell` / `packages/swarm` 等補 `index.ts` — 未來里程碑
- 新增任何 feature flag、新 API、新 package

---

## Section 2 — Architecture Decisions

### 2.1 三個切片的定義

**Slice A — Telemetry**(移入 `packages/local-observability`)
- 欄位(state.ts 內):`meter`、`sessionCounter`、`locCounter`、`prCounter`、
  `commitCounter`、`costCounter`、`tokenCounter`、`codeEditToolDecisionCounter`、
  `activeTimeCounter`、`statsStore`、`loggerProvider`、`eventLogger`、
  `meterProvider`、`tracerProvider`(14 個欄位)
- 函式(18 個 export):`setMeter`、`getMeter`、`getSessionCounter`、
  `getLocCounter`、`getPrCounter`、`getCommitCounter`、`getCostCounter`、
  `getTokenCounter`、`getCodeEditToolDecisionCounter`、`getActiveTimeCounter`、
  `getStatsStore`、`setStatsStore`、`getLoggerProvider`、`setLoggerProvider`、
  `getEventLogger`、`setEventLogger`、`getMeterProvider`、`setMeterProvider`、
  `getTracerProvider`、`setTracerProvider`
- 跨切片 state 依賴:**無**
- Src importers:`src/entrypoints/init.ts`、`src/cost-tracker.ts`(只有 2 個)
- Owner fit:`packages/local-observability` 已 own OTel instrumentation
  (`src/telemetry/instrumentation.ts`),counters 是它的自然延伸
- 風險點:`setMeter` 本身也是 constructor — 它不只是存 meter,還會呼叫
  `createCounter(...)` 8 次建出所有 counter。搬動代表 owner package 現在
  擁有 counter 命名權,這是語意變更。必須先寫 snapshot test 鎖 counter 名稱

**Slice B — Request Capture**(移入 `packages/provider`)
- 欄位:`lastAPIRequest`、`lastAPIRequestMessages`、`lastClassifierRequests`、
  `lastMainRequestId`、`lastApiCompletionTimestamp`、`pendingPostCompaction`、
  `cachedClaudeMdContent`(7 個欄位)
- 函式(14 個 export):`setLastAPIRequest`、`getLastAPIRequest`、
  `setLastAPIRequestMessages`、`getLastAPIRequestMessages`、
  `setLastClassifierRequests`、`getLastClassifierRequests`、
  `getLastMainRequestId`、`setLastMainRequestId`、
  `getLastApiCompletionTimestamp`、`setLastApiCompletionTimestamp`、
  `markPostCompaction`、`consumePostCompaction`、加上 `cachedClaudeMdContent`
  的兩個 accessor(如有)
- 跨切片依賴:`cachedClaudeMdContent` 只被 `src/context.ts` 碰到,獨立
- Src importers:`src/services/api/logging.ts`、`src/services/compact/compact.ts`、
  `src/services/compact/autoCompact.ts`、`src/commands/compact/compact.ts`、
  `src/components/Feedback.tsx`(5 個)
- Owner fit:provider 的網路層**產出**這些 capture state,compact / feedback
  **消費**。屬於 provider 的 session-accounting
- 風險點:`markPostCompaction` / `consumePostCompaction` 是 once-latch
  semantics,測試時要覆蓋「consume 後再 mark 才會 true」的行為

**Slice C — Bypass Mode**(移入 `packages/permission`)
- 欄位:`sessionBypassPermissionsMode`(1 個 bool)
- 函式:`setSessionBypassPermissionsMode`、`getSessionBypassPermissionsMode`
  (2 個 export)
- 跨切片依賴:**無**
- Src importers:4 個(掃描結果)
- Owner fit:`packages/permission` 已 own permission 決策,bypass mode 是它的自然擴展
  (`packages/permission/src/autoModeState.ts` 是同類 precedent)
- 風險點:極低。這是一個 half-day 的熱身切片,建立 permission package 的
  state-module pattern 以利未來

### 2.2 Facade 範本(完全照 4e63221 precedent)

**新增 owner-internal state module**,遵循每個 package 既有目錄約定:

```ts
// packages/local-observability/src/internal/meterState.ts
// V7 §3.4 — local-observability owns meter/counter state.
// This is a module-scope singleton. See src/bootstrap/state.ts for back-compat facade.

import type { Meter, Counter, LoggerProvider, EventLogger } from '@opentelemetry/api-*'
// ...type-only imports; zero runtime imports to avoid TDZ in bootstrap load

let meter: Meter | null = null
let sessionCounter: Counter | null = null
// ... 14 fields

export function setMeter(m: Meter, createCounter: (...) => Counter): void {
  meter = m
  sessionCounter = createCounter('claude_code.session.count', { description: '...' })
  // ... 7 more counters with exact same names/units as today
}

export function getMeter(): Meter | null { return meter }
// ... 17 more getters/setters

export function _resetForTesting(): void {
  meter = null
  sessionCounter = null
  // ... zero out all 14 fields
}
```

**package.json 新增 subpath export**(每個 package 一條):

```jsonc
// packages/local-observability/package.json
"exports": {
  ".": "./src/index.ts",
  "./meterState": "./src/internal/meterState.ts",  // ← new
  // ...existing entries
}
```

**src/bootstrap/state.ts facade**(每個切片一個 block):

```ts
// V7 §3.4 — local-observability owns meter/counter state. Re-exported here
// for back-compat with src/* call sites still importing from
// src/bootstrap/state.js. Single singleton lives in the owner package.
// Imported via the dedicated /meterState subpath (not the barrel) so
// bootstrap load order does not pull in the full telemetry tree.
export {
  setMeter, getMeter,
  getSessionCounter, getLocCounter, getPrCounter, getCommitCounter,
  getCostCounter, getTokenCounter, getCodeEditToolDecisionCounter, getActiveTimeCounter,
  getStatsStore, setStatsStore,
  getLoggerProvider, setLoggerProvider,
  getEventLogger, setEventLogger,
  getMeterProvider, setMeterProvider,
  getTracerProvider, setTracerProvider,
} from '@claude-code/local-observability/meterState'
```

### 2.3 resetStateForTests 修正(必做)

現在 `resetStateForTests` 靠 `Object.entries(getInitialState()).forEach(...)`
全域覆蓋 STATE。切片移出去後,那些欄位不再存在於 STATE,這個 reset loop
會**silently skip** — 測試之間會洩漏 meter/requestCapture state。

**Mitigation**:每個新的 owner-state module 都 export `_resetForTesting()`
(同 `autoModeState.ts` pattern),然後在 `src/bootstrap/state.ts` 的
`resetStateForTests` 裡顯式呼叫這 3 個:

```ts
import { _resetForTesting as _resetMeterForTesting } from '@claude-code/local-observability/meterState'
import { _resetForTesting as _resetRequestCaptureForTesting } from '@claude-code/provider/requestCaptureState'
import { _resetForTesting as _resetBypassModeForTesting } from '@claude-code/permission/bypassModeState'

export function resetStateForTests(): void {
  Object.entries(getInitialState()).forEach(/* ... */)
  _resetMeterForTesting()
  _resetRequestCaptureForTesting()
  _resetBypassModeForTesting()
}
```

### 2.4 Characterization 測試策略

每個切片一份測試檔,位置在 owner package:
- `packages/local-observability/src/internal/__tests__/meterState.test.ts`
- `packages/provider/src/internal/__tests__/requestCaptureState.test.ts`
- `packages/permission/src/internal/__tests__/bypassModeState.test.ts`

每份測試至少涵蓋:
1. **Initial state**:所有 getter 在未 set 時回傳 `null`(或預設值)
2. **Round-trip**:set 後 get 回原值
3. **Singleton**:同一個 getter 連續呼叫回同一實體(telemetry 特別重要)
4. **Counter 名稱 snapshot**(僅 telemetry):`setMeter` 建出的 8 個 counter
   名稱與 unit **完全等同搬動前**。用 fake `createCounter` 記錄呼叫
5. **Once-latch 語意**(僅 request-capture):`markPostCompaction` → `consumePostCompaction` → true → 再 consume → false → mark 再 consume → true
6. **_resetForTesting**:呼叫後所有欄位回到初始狀態
7. **從 facade import 與從 owner import 行為一致**:`import { getCostCounter } from 'src/bootstrap/state.js'` 跟 `import { getCostCounter } from '@claude-code/local-observability/meterState'` 回傳同一 instance

Template 參考:`packages/permission/src/autoModeState.ts` 是最接近的既有 pattern
(但目前它自己也沒有 test — 本 Wave 會建立新的 test pattern 供未來 state 搬遷複用)。
行為 oracle 參考:`src/cost-tracker.ts` 的現有 call sites(驗證 counter 名稱 / 呼叫時機)。

---

## Section 3 — Phase Breakdown

### Phase overview

| Phase | Goal | Teammates | 預計時間 | Blocks |
|-------|------|-----------|---------|--------|
| 1. Test Authoring | 3 份 characterization tests 全綠(對**當前** state.ts) | Test-Author | 0.5 day | — |
| 2. Slice A (Telemetry) | Migrate + facade + test pass | Migrator-Alpha | 0.5 day | Phase 1 |
| 3. Slice B (Request Capture) | Migrate + facade + test pass | Migrator-Beta | 0.5 day | Phase 2 |
| 4. Slice C (Bypass Mode) | Migrate + facade + test pass | Migrator-Gamma | 0.25 day | Phase 3 |
| 5. Verification & Ratchet | doctor:arch + build + smoke + budget 收緊 | Verifier | 0.25 day | Phase 4 |

**Team size justification**:Small team(4–6 teammates,1 lead)。三個
migrator 無法真的並行(都要改 `src/bootstrap/state.ts` 同一檔案),所以
serialize 為 Phase 2 → 3 → 4。Test-Author 在 Phase 1 獨立完成所有測試
以便每個 Migrator 在 Phase 開始時就有 baseline。

### 共享檔案衝突防護

`src/bootstrap/state.ts`**只有**三個 Migrator 會碰, 但三人都碰 → 必須
**嚴格序列化**。透過 `addBlockedBy` 強制 Phase 2 完成才開 Phase 3, Phase 3
完成才開 Phase 4。任何時刻只有一個 migrator 改 state.ts。

`src/bootstrap/state.ts` 裡會有 3 個 facade block, 位置慣例(從上到下):
1. Telemetry re-export block(Phase 2 加入)
2. Request capture re-export block(Phase 3 加入,接在 telemetry 下方)
3. Bypass mode re-export block(Phase 4 加入,接在 request capture 下方)

各 Migrator 只 touch 自己 slice 的欄位/函式 + 加入自己的 facade block +
在 `resetStateForTests` 加入自己的 `_resetForTesting()` 呼叫。**不允許**
碰別人 slice 的內容或重排別人的 facade block。

Phase 5 的 Verifier **不改 state.ts** — 只跑 doctor/build/test + 調整
`scripts/verify-ratchet.ts`(如果有數值 budget)。

---

## Section 4 — Shared Conventions & Convergence Criteria

### 4.1 File / module conventions

- **Owner package 內部 state 模組路徑**:
  - `packages/local-observability/src/internal/meterState.ts`(因為該 package 的其他 exports 都用 `./src/` 前綴)
  - `packages/provider/src/internal/requestCaptureState.ts`(同上)
  - `packages/permission/src/internal/bypassModeState.ts`(同上)
  - **注意**:`4e63221` 的 `packages/config/internal/allowedSourcesState.ts` 沒有 `src/` 前綴 — 那是 config 的個別慣例。本 Wave 尊重每個 package 既有慣例。
- **Subpath export 名稱**:就叫 `/meterState`、`/requestCaptureState`、`/bypassModeState`(對應檔名,不加 `State` 以外的後綴)
- **Owner state module 內 runtime imports**:**禁止**(只允許 `import type`)。原因:bootstrap 載入時觸發 TDZ 經 `src/utils/startupProfiler` 迴圈(見 4e63221 commit message)
- **`_resetForTesting` export**:每個 state module 都必須 export,供 `src/bootstrap/state.ts:resetStateForTests` 顯式呼叫
- **測試檔位置**:`packages/<owner>/src/internal/__tests__/<slice>State.test.ts`(跟著 owner package 的 testing convention)

### 4.2 Commit message convention(照 4e63221 範本)

每個 Migrator 完成後,lead 會做一次 commit,訊息格式:

```
refactor(v7): <owner-package> owns <slice-name> state (V7 §3.4)

V7 §3.4 — <owner-package> is the canonical owner of <slice concept>, so
the state should live there, not on the src/bootstrap STATE singleton.

Move:
- New packages/<owner>/src/internal/<slice>State.ts holds the singleton.
- src/bootstrap/state.ts removes the STATE fields + local getters/setters,
  and re-exports the same names from @claude-code/<owner>/<slice>State.
  Existing src/* call sites keep working unchanged.
- packages/<owner>/package.json adds ./<slice>State subpath export.

The re-export goes through a dedicated /<slice>State subpath (not the
@claude-code/<owner> barrel) because bootstrap loads during early init
and pulling in the full <owner> tree triggers a TDZ in
src/utils/startupProfiler.

Budget: <before> → <after>.

doctor:arch <N>/<N>, bun test <pass>/<fail>, build OK, pipe smoke OK.
```

### 4.3 Per-phase "Done" definition

- **Phase 1**(Test Authoring):3 份測試檔存在且**對目前未改動的 state.ts** 全綠
  (確保測試先描述當前行為,再來是 behavior-preserving migration)
- **Phase 2/3/4**(每個 Slice):
  - 新 `packages/.../internal/<slice>State.ts` 存在且只含 type imports
  - `packages/.../package.json` 新增對應 subpath export
  - `src/bootstrap/state.ts` 移除該 slice 欄位 + 加入 facade re-export block + 加入 `_resetForTesting` 呼叫
  - 對應測試檔全綠 + 既有 1,623 tests 全綠
  - `bun run build` 成功
  - `bun run doctor:arch` 無新 FAIL
  - `echo "say hello" | bun run src/entrypoints/cli.tsx -p` smoke 成功
  - 16 個 src/ importers **完全沒改**(`git diff` 裡沒有它們)
- **Phase 5**(Verifier):doctor:arch 所有 32 檢查 pass,`verify-ratchet` budget
  至少收緊 1 點,寫成總結報告給 lead

### 4.4 Lead 驗證清單(用來確認 teammate 真的完成)

每個 Phase 結束後, lead **親自**執行:
1. `git diff --stat packages/<owner>/ src/bootstrap/state.ts` — 檢查 scope 吻合
2. `git diff src/` 只能有 `src/bootstrap/state.ts` — 其他 src/ 檔**都不該動**
3. `bun test packages/<owner>/src/internal/__tests__/<slice>State.test.ts` — 綠
4. `bun test` — 綠
5. `bun run doctor:arch --json | jq '[.checks[] | select(.status != "pass")]'` — 空陣列
6. `bun run build && echo "say hello" | bun run src/entrypoints/cli.tsx -p` — 兩個都成功
7. `wc -l src/bootstrap/state.ts` — 確認每 slice 該減少的行數有減少

---

## Section 5 — Spawn Prompt Templates(Phase 6 執行時使用)

每個 prompt 都必須包含 6 項要素:role & file scope / task assignment /
collaboration triggers / plan reference / convergence criteria / conflict protocol。

### 5.1 Test-Author (Phase 1)

```
ROLE & FILE SCOPE
你是 Test-Author, 負責為即將遷移的 3 個 state slices 寫 characterization
tests。你專屬擁有:
- packages/local-observability/src/internal/__tests__/meterState.test.ts (新建)
- packages/provider/src/internal/__tests__/requestCaptureState.test.ts (新建)
- packages/permission/src/internal/__tests__/bypassModeState.test.ts (新建)

⚠️ 禁止觸碰 src/bootstrap/state.ts 本身、或任何 packages/*/internal/*State.ts
實作檔。你的測試應該目前 import 自 src/bootstrap/state.js (在未遷移前),
等遷移完成後不需要改測試 — import path 保持不變 (因為 facade)。

TASK ASSIGNMENT
你的指定任務是 Task #1 (已 mark in_progress)。不要自取其他 task。完成後
向 lead 匯報並等待下一步指示。

COLLABORATION TRIGGERS
- 當你發現 state.ts 裡某個 slice 欄位的初始值或 getter 語意跟 Plan 文件
  描述不符, 立刻 message lead 澄清, 不要自己修改 Plan
- 當你寫完測試發現它對現在 state.ts 不綠, 立刻 message lead, 不要調整
  測試去迎合 — 這是 characterization, 要描述當前真實行為

PLAN REFERENCE
先讀 ./TEAM_PLAN/mellow-booping-waffle.md §2.4 (測試策略) 和 §4.1 (檔名/
位置慣例)。三個 slice 的欄位/函式清單在 §2.1。測試範本參考
packages/permission/src/autoModeState.ts (但它自己沒有 test — 你正在
建立新 pattern)。行為 oracle 看 src/cost-tracker.ts (驗證 counter 名稱/
呼叫時機) 和 src/services/compact/compact.ts (驗證 markPostCompaction 
語意)。

CONVERGENCE CRITERIA (what "done" means)
- 3 個測試檔存在
- 每個檔案至少覆蓋 §2.4 列的 7 類 assertion
- bun test packages/{local-observability,provider,permission}/ — 全綠
- bun test (全 repo) — 全綠 (不破壞既有 1,623 tests)
- 在 state.ts 尚未修改的情況下三份測試已通過 (characterization 真的
  描述當前行為)
- 匯報給 lead: 「Phase 1 完成, 3 test files + N assertions, bun test X/Y pass」

CONFLICT PROTOCOL
如果發現跟其他 teammate 的工作衝突, 直接 message 對方先解決, 然後通知 lead。
```

### 5.2 Migrator-Alpha (Phase 2 — Telemetry)

```
ROLE & FILE SCOPE
你是 Migrator-Alpha, 負責 Slice A (Telemetry) 的完整遷移。你專屬擁有:
- packages/local-observability/src/internal/meterState.ts (新建)
- packages/local-observability/package.json (只改 exports 欄位)
- src/bootstrap/state.ts 中**只限**於 telemetry 相關的 14 欄位 + 18 函式
  + 對應的 facade re-export block + resetStateForTests 裡的 _resetMeter
  呼叫

⚠️ 禁止觸碰:其他 2 個 slice 的 state.ts 內容、任何 packages/provider/*、
packages/permission/*、或 src/ 其他檔案。16 個 src/ importers 必須原封不動。

TASK ASSIGNMENT
你的指定任務是 Task #2 (已 mark in_progress)。Task #2 blocked by Task #1。
不要自取 Task #3 或 Task #4 — 那是別人的 slice。完成後匯報等指示。

COLLABORATION TRIGGERS
- 開始前, 先執行 bun test packages/local-observability/ 確認 Test-Author
  的 meterState.test.ts 對當前 state.ts 全綠 (baseline)
- 完成後, 先 message Verifier 跑 doctor:arch + build + smoke, 通過才
  向 lead 匯報
- 如果發現 setMeter 的 counter 名稱需要變更, **先 message lead** — 這
  會 break snapshot test, 不可自作主張

PLAN REFERENCE
讀 ./TEAM_PLAN/mellow-booping-waffle.md §2.1 (Slice A 定義) + §2.2 
(facade 範本) + §2.3 (resetStateForTests 修正) + §4.2 (commit message
格式)。Precedent commit: 4e63221 — 用 git show 4e63221 看完整 diff 當
範本。

CONVERGENCE CRITERIA
- packages/local-observability/src/internal/meterState.ts 存在, 含
  14 fields + 18 exports + _resetForTesting
- 該檔案**只有** import type (沒有 runtime imports), 否則會 TDZ
- package.json 的 exports 新增 "./meterState": "./src/internal/meterState.ts"
- src/bootstrap/state.ts 移除對應 14 欄位 + 18 函式, 加入 facade block
  + resetStateForTests 改動
- bun test packages/local-observability/ 全綠
- bun test (全 repo) 全綠
- bun run doctor:arch 無 FAIL
- bun run build 成功
- echo "say hello" | bun run src/entrypoints/cli.tsx -p 成功
- git diff --name-only 只列 3 個檔案
- wc -l src/bootstrap/state.ts 減少約 50 行
- 匯報: 「Slice A done. state.ts 1752 → <N>. doctor/test/build/smoke 全綠」

CONFLICT PROTOCOL
同 Test-Author。
```

### 5.3 Migrator-Beta (Phase 3 — Request Capture)

```
ROLE & FILE SCOPE
你是 Migrator-Beta, 負責 Slice B (Request Capture) 的完整遷移。你專屬擁有:
- packages/provider/src/internal/requestCaptureState.ts (新建)
- packages/provider/package.json (只改 exports 欄位)
- src/bootstrap/state.ts 中**只限**於 request-capture 相關的 7 欄位 + 14
  函式 + 對應的 facade re-export block + resetStateForTests 的
  _resetRequestCapture 呼叫

⚠️ 禁止觸碰:Slice A 已搬的 telemetry 內容 (Phase 2 已完成, 不可 regress)、
Slice C 的 bypass-mode 內容、任何 packages/local-observability/*、
packages/permission/*、或 src/ 其他檔案。

TASK ASSIGNMENT
你的指定任務是 Task #3 (已 mark in_progress)。Task #3 blocked by Task #2。
不要自取其他 task。

COLLABORATION TRIGGERS
- 開始前, 執行 bun test packages/provider/ 確認 Test-Author 的
  requestCaptureState.test.ts 全綠
- 完成後, message Verifier 做 Phase 檢驗, 再向 lead 匯報
- 如果發現 markPostCompaction / consumePostCompaction 的 once-latch 語意
  在當前 state.ts 實作上跟測試預期不一致, message Test-Author + lead

PLAN REFERENCE
./TEAM_PLAN/mellow-booping-waffle.md §2.1 (Slice B 定義) + §2.2 + §2.3 + §4.2。
Precedent: 4e63221 + Phase 2 剛完成的 commit。

CONVERGENCE CRITERIA
- packages/provider/src/internal/requestCaptureState.ts 存在, 7 fields +
  14 exports + _resetForTesting
- 只有 import type, 無 runtime imports
- package.json 加入 "./requestCaptureState": "./src/internal/requestCaptureState.ts"
- src/bootstrap/state.ts 移除欄位 + 加 facade block + reset 呼叫
- bun test / doctor:arch / build / smoke 全綠
- git diff 只列 3 個檔案
- state.ts 再減少約 40 行
- 匯報格式同 Migrator-Alpha

CONFLICT PROTOCOL
同上。
```

### 5.4 Migrator-Gamma (Phase 4 — Bypass Mode)

```
ROLE & FILE SCOPE
你是 Migrator-Gamma, 負責 Slice C (Bypass Mode) 的完整遷移。你專屬擁有:
- packages/permission/src/internal/bypassModeState.ts (新建)
- packages/permission/package.json (只改 exports 欄位)
- src/bootstrap/state.ts 中**只限**於 sessionBypassPermissionsMode 的
  1 欄位 + 2 函式 + facade block + reset 呼叫

⚠️ 禁止觸碰:Slice A/B 已搬的內容、其他 package、其他 src/ 檔案。

TASK ASSIGNMENT
Task #4 (已 mark in_progress)。Blocked by Task #3。

COLLABORATION TRIGGERS
- 開始前確認 bypassModeState.test.ts 全綠
- 完成後 message Verifier 做最終 Phase 檢驗

PLAN REFERENCE
./TEAM_PLAN/mellow-booping-waffle.md §2.1 (Slice C) + §2.2 + §2.3 + §4.2。
這是最小最簡的 slice — 不要 over-engineer, 照 precedent 走。

CONVERGENCE CRITERIA
- bypassModeState.ts 存在, 1 field + 2 exports + _resetForTesting
- package.json + src/bootstrap/state.ts 小幅修改
- 全部測試 / doctor / build / smoke 綠
- 匯報格式同上

CONFLICT PROTOCOL
同上。
```

### 5.5 Verifier (Phase 5)

```
ROLE & FILE SCOPE
你是 Verifier, 負責最終驗收 + ratchet 收緊。你專屬擁有:
- scripts/verify-ratchet.ts (**如果**它有跟 state.ts 相關的 budget 數值
  需要收緊, 只改對應數字)

⚠️ 禁止觸碰:任何 packages/* 實作、src/bootstrap/state.ts、任何測試檔。
你只跑命令、寫報告, 除非要調 ratchet budget。

TASK ASSIGNMENT
Task #5 (已 mark in_progress)。Blocked by Task #4。

COLLABORATION TRIGGERS
- 若有任何 doctor 檢查失敗, 立刻 message 對應 Migrator + lead, 不要自己
  修正對方的工作
- 若 ratchet budget 已經最緊 (無法再降), 向 lead 確認是否需要手動加一條
  新的 budget line

PLAN REFERENCE
./TEAM_PLAN/mellow-booping-waffle.md §1 (Success criteria 9 項) + §4.4 
(Lead 驗證清單)。

CONVERGENCE CRITERIA
產出一份報告包含:
1. bun run doctor:arch --json 結果 (0 failures 確認)
2. bun test 結果 (pass/fail count)
3. bun run build 結果
4. pipe smoke 結果
5. state.ts 行數: before=1752, after=<N>, delta=<N - 1752>
6. 16 個 src/ importers 的 diff 摘要 (應該是空的)
7. ratchet budget 收緊項目 (如果有的話: X → Y)
8. Success criteria §1 的 9 項逐項勾選
匯報: 「Wave 完成。<報告摘要>」

CONFLICT PROTOCOL
同上。
```

---

## Section 6 — Verification Plan

### 6.1 Per-slice verification(每個 Migrator 完成後)

```bash
# 1. Unit tests for the slice
bun test packages/<owner>/src/internal/__tests__/<slice>State.test.ts

# 2. Full test suite (既有 1,623 + 新增)
bun test

# 3. Architecture doctor (32 checks)
bun run doctor:arch --json | jq '[.checks[] | select(.status != "pass")] | length'
# Expected: 0

# 4. Build
bun run build

# 5. Pipe smoke
echo "say hello" | bun run src/entrypoints/cli.tsx -p

# 6. State.ts line count
wc -l src/bootstrap/state.ts

# 7. 16 importers unchanged
git diff src/ | grep -E '^\+\+\+ b/src/' | grep -v '^\+\+\+ b/src/bootstrap/state.ts'
# Expected: empty
```

### 6.2 Final milestone verification

1. `src/bootstrap/state.ts` ≤ 1,600 行
2. 3 份新 state modules 存在, 只含 type imports
3. 3 條新 subpath exports
4. 3 份測試檔, 全綠
5. `bun run doctor:arch` 32/32 pass
6. `bun test` — 1,623 + N 全綠
7. `bun run build` 成功
8. Pipe smoke 成功
9. `verify-ratchet` budget 收緊至少 1 點
10. 無 src/ importer 被改動

### 6.3 Rollback

每個 Slice 一個獨立 commit,若 Phase 5 發現問題:
- 若 doctor 某檢查 regress:`git revert <slice-commit>` 單獨回退
- 若 test regression:先嘗試修, 3 次失敗才 revert

---

## Section 7 — Risk Register

| # | 風險 | 可能性 | 影響 | 緩解 |
|---|------|--------|------|------|
| 1 | Bootstrap TDZ 經 `src/utils/startupProfiler` 迴圈 | 高(4e63221 已遇過) | 中(啟動 crash) | 新 state modules **只** import type; 用 dedicated subpath export (不經 barrel); 每個 Slice 都跑 pipe smoke 驗證 |
| 2 | `resetStateForTests` silent-skip 導致測試洩漏狀態 | 高 | 中(隨機 test 失敗) | §2.3 的顯式 `_resetForTesting()` 呼叫; 每個 state module 必 export |
| 3 | `setMeter` counter 名稱被不小心改動 | 中 | 高(telemetry 數據 break) | Phase 1 的 snapshot test 鎖名稱 + unit |
| 4 | 並發改 state.ts 導致 merge conflict | 低(已序列化) | 低 | Phase 2→3→4 嚴格 addBlockedBy; Verifier Phase 不改 state.ts |
| 5 | 16 importers 某個改了而沒發現 | 低 | 中(back-compat 破) | §4.4 Lead 驗證清單第 2 項強制 git diff 檢查 |
| 6 | Phase 1 characterization test 描述錯誤行為 | 中 | 高(migration 按錯誤行為做) | Phase 1 完成後 lead 親自 code-review 測試 **對應到** 當前 state.ts 語意才放行 |
| 7 | `markPostCompaction` once-latch 的 edge case | 中 | 中 | 測試覆蓋 mark→consume→consume→mark→consume 完整序列 |
| 8 | 某個 src/ 檔案其實也從 `@claude-code/app-compat/bootstrap/state.js` import 同名 symbol | 低 | 低 | Verifier 跑 `grep -r "bootstrap/state" packages/ src/` 對照 facade export 清單 |

---

## Section 8 — Execution Notes

- Plan ID: `mellow-booping-waffle`
- TEAM_PLAN 檔案位置(Phase 6 執行時建立):`./TEAM_PLAN/mellow-booping-waffle.md`
  (內容跟本 plan 一致,供 teammates 讀取)
- 預計總時間:2–3 個工作天(Phase 1 半天 + 3 個 Slice × 0.5 天 + Verifier 0.25 天)
- 每個 Phase 結束都有一個獨立 commit — 可 ship-ready、可 revert
- 本 Wave 不做:cli 解耦、REPL 拆分、deprecations 清理、新 package 建立
- 下一個里程碑的起點:state.ts 進一步繼續拆(session id / cwd / model / hooks),
  或轉向 cli 解耦(229 → 0),由當時 `doctor:arch` 結果和 ratchet 狀態決定

---

## Section 9 — Critical Files Reference

**讀取/理解**:
- `V7.md` §3.1/3.4/3.5(ownership 原則 + state locality + package boundaries)
- `scripts/doctor-architecture.ts`(32 checks 編排)
- `scripts/verify-runtime-boundaries.ts`(runtime boundary check)
- `scripts/verify-app-state-boundaries.ts`(state boundary check)
- `scripts/verify-ratchet.ts`(monotonicity budget)
- Commit `4e63221` 完整 diff(唯一 precedent)

**新建**:
- `packages/local-observability/src/internal/meterState.ts`
- `packages/local-observability/src/internal/__tests__/meterState.test.ts`
- `packages/provider/src/internal/requestCaptureState.ts`
- `packages/provider/src/internal/__tests__/requestCaptureState.test.ts`
- `packages/permission/src/internal/bypassModeState.ts`
- `packages/permission/src/internal/__tests__/bypassModeState.test.ts`
- `./TEAM_PLAN/mellow-booping-waffle.md`(Phase 6 執行時)

**修改**:
- `packages/local-observability/package.json`(新增 `./meterState` subpath)
- `packages/provider/package.json`(新增 `./requestCaptureState` subpath)
- `packages/permission/package.json`(新增 `./bypassModeState` subpath)
- `src/bootstrap/state.ts`(移除 3 個 slice 的欄位 + 加入 3 個 facade block + 3 個 `_resetForTesting` 呼叫)
- `scripts/verify-ratchet.ts`(可能:收緊 state.ts 行數 budget,具體視當前 budget 設計)

**不得碰**:
- `src/entrypoints/init.ts`、`src/cost-tracker.ts`、`src/services/api/logging.ts`、
  `src/services/compact/*.ts`、`src/commands/compact/compact.ts`、
  `src/components/Feedback.tsx`、以及其他 10+ 個 src/ importers — facade 保證它們完全不需改動
- `packages/cli`、`packages/agent`、`packages/swarm` 等其他 package(不在此 Wave 範圍)
- `src/screens/REPLView.tsx`、`src/utils/messages.ts`(god files,未來 Wave)
