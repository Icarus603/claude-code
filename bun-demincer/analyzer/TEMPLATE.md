# TEMPLATE: structure of every analysis.md

This is the exact skeleton you must follow. Section order is fixed.
If a section has no findings, write `此版本未發現相關變化` — never
omit the heading.

The frontmatter block is mandatory and machine-read by the human's
tooling — keep the keys exactly as shown.

---

```markdown
---
versionA: 2.1.131
versionB: 2.1.132
generatedAt: 2026-05-09T01:23:45Z
analyzer: claude-opus-4-7
analyzerEffort: max
sourceDelta: deltas/2.1.131-to-2.1.132.json
coverage:
  changed_input: 412      # total .changed[] count from delta
  changed_analyzed: 30    # how many you individually examined
  new_input: 22           # total .new[] count
  new_analyzed: 22        # all of them, ideally
  removed_input: 8
  removed_analyzed: 8
  rule_based_complete: true   # did you finish all rule-based extractions
incomplete: false           # set true if any blocker prevented a section
---

# ant claude-code v{A} → v{B}

> ⚠️ INCOMPLETE — {reason}             ← only if `incomplete: true` above

## TL;DR

3-5 bullets, each ≤ 1 line. For Icarus scanning at 09:10 over coffee.
Examples of good TL;DR bullets:

- 新增 `managed-agents-2026-04-01` beta + 7 個 `/v1/agents` API endpoints — managed-agent surface 上線
- 移除 `lE` (config helper) — 配置流程改寫
- Provider 路由邏輯重大變更（4 個 module 集中改動）
- `tengu_grey_step2` flag 新增，控制 Opus 預設 effort 行為

Examples of bad TL;DR bullets:
- 「有 855 個 module 改了」（沒有信息）
- 「主要在 plugin 系統」（vague）

---

## 重大變更 (Major changes)

1-3 paragraph(s). The "if you read nothing else, read this" section.
Synthesises the biggest themes — what this version is about. Written
for the ccb maintainer who needs to decide whether to port this
version's changes.

If the version is genuinely a minor patch (no themes worth a
paragraph), say so plainly: "本次版本主要為 minifier reshuffle 與
個別 bug fix，無重大主題級變更。"

---

## 新增功能 (New features)

For each new user-visible or developer-visible feature:

### {feature name in 中文 or English}

- **Module(s)**: `{idB}` (`{fileB}`)
- **Evidence**: `{strings or code snippet}`
- **推斷功能**: {what you think it does}
- **置信度**: high / medium / low
- **ccb-port hint**: {sub-system, e.g. "packages/provider/" or "ownership unclear"}

If a "feature" turns out on inspection to be internal plumbing not
worth a section, demote it to a bullet under 行為變更.

---

## 移除功能 (Removed)

For each removed module / capability:

### {what was removed}

- **Module**: `{idA}` (`{fileA}`, {size}b, {depCount} deps in A)
- **Inferred role in A**: {from reading the module}
- **Replacement in B**: {if you can identify one — name the module — or "no
  direct replacement, behaviour relocated to ..." or "deprecated outright"}

---

## 行為變更 (Behaviour changes by sub-system)

Group by ccb sub-system — these mirror `packages/*` so a future ccb
maintainer can grep their own tree. Inside each, list paired-changed
modules ordered by importance.

### Provider / API client

- **`{idA}→{idB}`** ({fileA}→{fileB}, sizeΔ {±N}, {diffLines} diff
  lines)
  - **變化**: {what actually changed at code level}
  - **影響**: {user-facing? internal? perf? error path?}
  - **ccb-port**: {hint or "no port needed"}

### Tool registry

…

### REPL / UI / Ink

…

### Plugin / MCP

…

### Agent loop / hooks

…

### Other / cross-cutting

…

(Sections with no entries: write `此版本未發現相關變化`. Don't omit.)

---

## 新增 anthropic-beta headers

Pure rule-based extraction (METHOD § 1a). One bullet per new beta:

- **`{beta-name-YYYY-MM-DD}`** — first appears in `{module-id}` (`{file}`).
  Used in: {anthropic-beta context — 1 line}.

---

## 新增 feature flags

METHOD § 1b. One bullet per new flag:

- **`tengu_xxx`** — read by `{module-id}`. Inferred purpose:
  {1 line}.

---

## 新增 env vars

METHOD § 1c.

- **`CLAUDE_CODE_XXX` / `ANTHROPIC_XXX`** — read by `{module}`,
  default behaviour: …

---

## 新增 API endpoints

METHOD § 1d.

- **`POST /v1/agents`** — defined in `{module-id}`. Operations:
  {GET/POST/list/get/etc.}.

---

## 新增 slash commands / tool names

If any. Otherwise `此版本未發現相關變化`.

---

## ccb 維護建議

For the maintainer planning the next port pass. Concrete and
actionable. Examples:

- **Port priority HIGH**: `{idB}` in B introduces XXX which ccb's
  current `packages/foo/` doesn't have. Port path: ...
- **Port priority MEDIUM**: behaviour change in `{idA→idB}`. ccb's
  equivalent (`packages/bar/baz.ts`) has the old behaviour, may want
  to update.
- **Port priority LOW**: minifier-level changes only.
- **Risk flag**: {anything that might break ccb if naively ported}

If nothing is worth maintaining hint on, say so — empty section is
fine here, but the heading must remain.

---

## Coverage / 不確定性

- `changed` 個別分析數: {analyzed}/{input} ({pct}%)
- `new` 個別分析數: {analyzed}/{input}
- `removed` 個別分析數: {analyzed}/{input}
- 規則式提取（beta/flag/env/path）: 完整 / 不完整（reason）
- 跳過理由 / 不確定的判斷:
  - {一條一條列}
- Long tail（未個別分析的 changed pairs）抽樣結論：
  - {paragraph from METHOD § 7}

---

## Run footprint

- Wall time: {Xs}
- Tool calls: {N}
- Notes for next-run improvement: {if any}
```

---

## What good looks like

- Every section has a heading. None omitted.
- Frontmatter `coverage` numbers are honest, not aspirational.
- Each "重大變更" / "行為變更" entry has both an evidence trail
  (file paths, module ids) and an inference (what it means). Lazy
  reports skip the inference.
- Rule-based sections are exhaustive, not "top 5 of N". They're
  grep output — show all of it.
- ccb 維護建議 entries are *actionable* — name the ccb file or sub-system.
- TL;DR is scannable in 30 seconds.

## What bad looks like (don't)

- "Plugin system has changes" → which module, what change?
- TL;DR with "various improvements"
- Listing 50 changed pairs in 行為變更 with one-word descriptions
- Skipping a section because "nothing here"
- Frontmatter `coverage: changed_analyzed: 5 / changed_input: 800`
  WITHOUT a long-tail paragraph in Coverage section justifying it
