# EXAMPLE — reference shape, not a quality ceiling

This is a v0 example written by a human (Icarus' coordinator agent)
based on the actual 2.1.131 → 2.1.132 delta JSON. It demonstrates the
structure but does not claim to be the highest quality. **You are
free to write a better one.** If your produced analysis.md is more
thorough, more accurate, or better organised, that's the new bar —
the next runner reads from `reports/` not from this file.

The point of this file: show what filled-in TEMPLATE sections look
like in practice, so you know "ah, that's what the heading meant".
Skim it, internalise the shape, then surpass it.

The frontmatter and section structure are NOT optional to copy — they
are mandated by TEMPLATE.md. Style, depth, and synthesis quality —
those are yours to push higher.

---

```markdown
---
versionA: 2.1.131
versionB: 2.1.132
generatedAt: 2026-05-09T01:30:00Z
analyzer: human-coordinator (v0 example, NOT machine-generated)
analyzerEffort: n/a
sourceDelta: deltas/2.1.131-to-2.1.132.json
coverage:
  changed_input: 412
  changed_analyzed: 12
  new_input: 22
  new_analyzed: 22
  removed_input: 8
  removed_analyzed: 8
  rule_based_complete: false
incomplete: true
---

# ant claude-code v2.1.131 → v2.1.132

> ⚠️ INCOMPLETE — this is a v0 hand-written example demonstrating the
> template shape; not a real analysis. Real analyses produced by ccb
> agent runs replace this as the reference.

## TL;DR

- (placeholder — would list 3-5 key bullets here)

## 重大變更

(placeholder paragraph — describe the dominant theme of v2.1.131 → v2.1.132 here)

## 新增功能

### Example new feature

- **Module(s)**: `JZ6` (`0XXX.js`)
- **Evidence**: `topStrings: "/v1/agents?beta=true", "managed-agents-2026-04-01"`
- **推斷功能**: New managed-agents API client wrapper
- **置信度**: high (string evidence is unambiguous)
- **ccb-port hint**: `packages/provider/src/anthropic/` — ccb's first-party client

## 移除功能

### Example removed module

- **Module**: `lE` (`0577.js`, 536b, 2 deps in A)
- **Inferred role in A**: config-file path resolver (sets module-level
  state via SH_ variable, reads JSON config)
- **Replacement in B**: ownership unclear — no obvious 1:1 replacement
  in `.new[]`. Likely behaviour absorbed into another module via
  rename pass that broke fingerprint matching.

## 行為變更

### Provider / API client

- **`mfK→jWK`** (`4685.js→4719.js`, sizeΔ +78, 654 diff lines)
  - **變化**: (placeholder — would describe the actual code change here after running diff)
  - **影響**: (user-facing? internal? perf?)
  - **ccb-port**: (which ccb file would hold this)

### Tool registry

此版本未發現相關變化

### REPL / UI / Ink

(entries here)

### Plugin / MCP

(entries here)

### Agent loop / hooks

(entries here)

### Other / cross-cutting

(entries here)

## 新增 anthropic-beta headers

(rule-extracted list — every new beta found by METHOD § 1a)

- **`managed-agents-2026-04-01`** — first appears in `JZ6`
  (`0XXX.js`). Used as `anthropic-beta` request header for
  `/v1/agents` family endpoints.

## 新增 feature flags

(rule-extracted list)

- (placeholder bullets)

## 新增 env vars

此版本未發現相關變化

## 新增 API endpoints

- (placeholder bullets — `/v1/agents`, `/v1/sessions`, etc.)

## 新增 slash commands / tool names

此版本未發現相關變化

## ccb 維護建議

- **Port priority HIGH**: managed-agents API surface (`JZ6`, `PZ6`,
  `WZ6`, `GZ6`) — entirely missing from ccb. If we ever expose
  managed agents, port to `packages/provider/src/anthropic/agents/`.
- **Port priority LOW**: minifier reshuffle of fingerprint-matched
  modules.

## Coverage / 不確定性

- `changed` 個別分析數: 12 / 412 (2.9%) — placeholder, real run
  should target ≥7%
- `new` 個別分析數: 22 / 22 (100%)
- `removed` 個別分析數: 8 / 8 (100%)
- 規則式提取: incomplete (this is a hand-written example, not a real run)
- Long tail 抽樣結論: not performed (v0 example)

## Run footprint

- Wall time: n/a (hand-written)
- Tool calls: n/a
- Notes: this example is intentionally shallow on the freeform
  sections to invite real agent runs to do better. It IS thorough on
  structure — copy the structure, exceed the depth.
```
