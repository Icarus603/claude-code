# Cron 調度測試計劃

## 概述

Cron 模組提供 cron 表達式解析、下次執行時間計算和人類可讀描述。全部爲純函數，無外部依賴，是最適合單元測試的模組之一。

## 被測文件

| 文件 | 關鍵導出 |
|------|----------|
| `src/utils/cron.ts` | `CronFields`, `parseCronExpression`, `computeNextCronRun`, `cronToHuman` |

---

## 測試用例

### describe('parseCronExpression')

#### 有效表達式

- test('parses wildcard fields') — `'* * * * *'` → 每個字段爲完整範圍
- test('parses specific values') — `'30 14 1 6 3'` → minute=[30], hour=[14], dom=[1], month=[6], dow=[3]
- test('parses step syntax') — `'*/5 * * * *'` → minute=[0,5,10,...,55]
- test('parses range syntax') — `'1-5 * * * *'` → minute=[1,2,3,4,5]
- test('parses range with step') — `'1-10/3 * * * *'` → minute=[1,4,7,10]
- test('parses comma-separated list') — `'1,15,30 * * * *'` → minute=[1,15,30]
- test('parses day-of-week 7 as Sunday alias') — `'0 0 * * 7'` → dow=[0]
- test('parses range with day-of-week 7') — `'0 0 * * 5-7'` → dow=[0,5,6]
- test('parses complex combined expression') — `'0,30 9-17 * * 1-5'` → 工作日 9-17 每半小時

#### 無效表達式

- test('returns null for wrong field count') — `'* * *'` → null
- test('returns null for out-of-range values') — `'60 * * * *'` → null（minute max=59）
- test('returns null for invalid step') — `'*/0 * * * *'` → null（step=0）
- test('returns null for reversed range') — `'10-5 * * * *'` → null（lo>hi）
- test('returns null for empty string') — `''` → null
- test('returns null for non-numeric tokens') — `'abc * * * *'` → null

#### 字段範圍驗證

- test('minute: 0-59')
- test('hour: 0-23')
- test('dayOfMonth: 1-31')
- test('month: 1-12')
- test('dayOfWeek: 0-6 (plus 7 alias)')

---

### describe('computeNextCronRun')

#### 基本匹配

- test('finds next minute') — from 14:30:45, cron `'31 14 * * *'` → 14:31:00 同天
- test('finds next hour') — from 14:30, cron `'0 15 * * *'` → 15:00 同天
- test('rolls to next day') — from 14:30, cron `'0 10 * * *'` → 10:00 次日
- test('rolls to next month') — from 1月31日, cron `'0 0 1 * *'` → 2月1日
- test('is strictly after from date') — from 恰好匹配時應返回下一次而非當前時間

#### DOM/DOW 語義

- test('OR semantics when both dom and dow constrained') — dom=15, dow=3 → 匹配 15 號 OR 週三
- test('only dom constrained uses dom') — dom=15, dow=* → 只匹配 15 號
- test('only dow constrained uses dow') — dom=*, dow=3 → 只匹配週三
- test('both wildcarded matches every day') — dom=*, dow=* → 每天

#### 邊界情況

- test('handles month boundary') — 從 2 月 28 日尋找 2 月 29 日或 3 月 1 日
- test('returns null after 366-day search') — 不可能匹配的表達式返回 null（理論上不會發生）
- test('handles step across midnight') — `'0 0 * * *'` 從 23:59 → 次日 0:00

#### 每 N 分鐘

- test('every 5 minutes from arbitrary time') — `'*/5 * * * *'` from 14:32 → 14:35
- test('every minute') — `'* * * * *'` from 14:32:45 → 14:33:00

---

### describe('cronToHuman')

#### 常見模式

- test('every N minutes') — `'*/5 * * * *'` → `'Every 5 minutes'`
- test('every minute') — `'*/1 * * * *'` → `'Every minute'`
- test('every hour at :00') — `'0 * * * *'` → `'Every hour'`
- test('every hour at :30') — `'30 * * * *'` → `'Every hour at :30'`
- test('every N hours') — `'0 */2 * * *'` → `'Every 2 hours'`
- test('daily at specific time') — `'30 9 * * *'` → `'Every day at 9:30 AM'`
- test('specific day of week') — `'0 9 * * 3'` → `'Every Wednesday at 9:00 AM'`
- test('weekdays') — `'0 9 * * 1-5'` → `'Weekdays at 9:00 AM'`

#### Fallback

- test('returns raw cron for complex patterns') — 非常見模式返回原始 cron 字符串
- test('returns raw cron for wrong field count') — `'* * *'` → 原樣返回

#### UTC 模式

- test('UTC option formats time in local timezone') — `{ utc: true }` 時 UTC 時間轉本地顯示
- test('UTC midnight crossing adjusts day name') — UTC 時間跨天時本地星期名正確

---

## Mock 需求

**無需 Mock**。所有函數爲純函數，唯一的外部依賴是 `Date` 構造器和 `toLocaleTimeString`，可通過傳入確定性的 `from` 參數控制。

## 注意事項

- `cronToHuman` 的時間格式化依賴系統 locale，測試中建議使用 `'en-US'` locale 或只驗證部分輸出
- `computeNextCronRun` 使用本地時區，DST 相關測試需注意執行環境
