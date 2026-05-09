# METHOD: how to actually find things in a decoded ant build

Practical recipes for turning two `decoded/` trees + a delta JSON into
a real changelog. **Run these before you start writing prose** — the
findings drive the writing, not the other way round.

All commands assume you are in `bun-demincer/`. Replace `$A` / `$B`
with the actual versions.

---

## 0 · Quick orientation (always do first)

```bash
# Sanity: how big are the trees, how does the delta summarise?
wc -l deltas/$A-to-$B.json
jq '.summary, ._meta.versionA, ._meta.versionB' deltas/$A-to-$B.json
ls work/claude-code-$A/decoded/ | wc -l
ls work/claude-code-$B/decoded/ | wc -l
```

You're looking for: total module counts, ratio of changed/unchanged,
unmatched-from-A vs unmatched-from-B (asymmetry suggests refactors).

---

## 1 · Rule-based extractions (do these FIRST — pure greppable signal)

These are deterministic; do them before any LLM reasoning.

### 1a · New `anthropic-beta` headers

```bash
# What betas does B mention that A doesn't?
comm -13 \
    <(grep -rohE '"[a-z][a-z0-9-]+-20[0-9]{2}-[0-9]{2}-[0-9]{2}"' \
        work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE '"[a-z][a-z0-9-]+-20[0-9]{2}-[0-9]{2}-[0-9]{2}"' \
        work/claude-code-$B/decoded/ | sort -u)
```

For each new beta, find the module that introduces it:
```bash
grep -rl 'managed-agents-2026-04-01' work/claude-code-$B/decoded/
```

### 1b · New feature flags (`tengu_*`)

```bash
comm -13 \
    <(grep -rohE 'tengu_[a-z_]+' work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE 'tengu_[a-z_]+' work/claude-code-$B/decoded/ | sort -u)
```

For each new flag, find the module(s) that read it:
```bash
grep -rl 'tengu_grey_step2' work/claude-code-$B/decoded/
```
Read that module to understand what the flag gates.

### 1c · New environment variables

```bash
# CLAUDE_CODE_*, ANTHROPIC_*, CCB_*, USER_TYPE
comm -13 \
    <(grep -rohE '(CLAUDE_CODE|ANTHROPIC|CCB)_[A-Z][A-Z_0-9]*' \
        work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE '(CLAUDE_CODE|ANTHROPIC|CCB)_[A-Z][A-Z_0-9]*' \
        work/claude-code-$B/decoded/ | sort -u)
```

### 1d · New API paths

```bash
comm -13 \
    <(grep -rohE '"/v1/[a-z_/?][a-z_/?-]*"' work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE '"/v1/[a-z_/?][a-z_/?-]*"' work/claude-code-$B/decoded/ | sort -u)
```

### 1e · New tool names / slash commands

ant defines slash commands in their command-runtime equivalent. Tool
classes typically have a `name` field.

```bash
# Slash commands
comm -13 \
    <(grep -rohE '"/(model|effort|status|memory|[a-z-]+)"' \
        work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE '"/(model|effort|status|memory|[a-z-]+)"' \
        work/claude-code-$B/decoded/ | sort -u)
```

These rule-based sets go DIRECTLY into TEMPLATE sections "新增
anthropic-beta headers" / "新增 feature flags" / "新增 env vars" /
"新增 API endpoints". No LLM judgment needed.

---

## 2 · Picking which `changed` modules deserve real attention

The `.changed[]` array is enormous (typical 400-900 entries). Most
are minifier noise — same code, renamed locals. Heuristic to pick
real signal:

```bash
jq -r '.changed
       | map(select((.sizeChange | tonumber | abs > 200)
                    and .diffLines > 30))
       | sort_by(.sizeChange | tonumber | abs)
       | reverse
       | .[0:30]
       | .[]
       | "\(.idA)→\(.idB) \(.fileA)→\(.fileB) sizeΔ=\(.sizeChange) diffLines=\(.diffLines)"' \
    deltas/$A-to-$B.json
```

For each of those top-30, get the actual diff:

```bash
diff -u work/claude-code-$A/decoded/$fileA work/claude-code-$B/decoded/$fileB | head -200
```

Read both modules in full (`Read` tool) when the diff looks
semantically interesting. **Don't trust truncated diffs** — they
often hide the real change in the middle.

---

## 3 · `new` modules — go deep on each

53 new modules is small enough to look at every one. For each:

```bash
# 1. What's the file?
jq -r --arg id "$ID" '.new[] | select(.id == $id) | .file' \
    deltas/$A-to-$B.json

# 2. Read the whole file (they're typically <2KB)
cat work/claude-code-$B/decoded/$file
```

Pattern-match against:
- Re-exports from another module → light wrapper, low signal
- New API client class → check method names → likely new endpoint
- New error class → check name → tells you what subsystem cares
- New React component → check JSX strings, prop names → UI feature
- New zod/yup schema → tells you a new typed config surface
- New `tool` definition (look for `name:` `description:` `inputSchema:`)
- Plugin/MCP related (look for `mcp_`, `plugin_`)

Group into TEMPLATE sub-sections by what you find.

---

## 4 · `removed` modules — same approach but on A's tree

```bash
jq -r '.removed[] | "\(.id) \(.file) \(.size)b \(.depCount) deps"' \
    deltas/$A-to-$B.json

# For each:
cat work/claude-code-$A/decoded/$file
```

Removals are usually MORE interesting than additions — they tell you
what ant abandoned. Worth reading every one.

---

## 5 · Cross-version per-module diff (the deep dive)

Once you've identified which paired-changed modules matter, get the
actual code diff. The decoded files have been through prettier so
diffs are reasonably clean.

```bash
diff -u work/claude-code-$A/decoded/$fileA work/claude-code-$B/decoded/$fileB
```

If diff is huge (>500 lines), narrow with:
```bash
diff -u file_A file_B | grep -E '^[+-][^+-]' | head -100
```

Patterns to look for in diffs:
- New `if (...)` branches → behaviour gates
- New `try { ... } catch {` → error handling additions (often
  signals "we hit this in prod")
- New environment variable reads (`process.env.X`)
- New `require('...')` / `import` statements → new dependencies
- Removed code → deprecation
- Reordered exports → API surface change

---

## 6 · ccb-port hint synthesis

This is for Reader 2 (future ccb maintainer). For each notable
finding, ask:

- Does ccb already have this? (grep `packages/` of the ccb repo)
- If not, is it user-facing (must port) or internal optimization
  (optional)?
- What ccb sub-system would own it? Map to the ccb directory layout
  in `../CLAUDE.md`:
  - Provider changes → `packages/provider/`
  - Tool changes → `packages/tool-registry/`
  - REPL/UI → `packages/repl/` or `packages/@ant/ink/`
  - Plugin/MCP → `packages/config/plugin/` or `packages/mcp-runtime/`
  - Agent loop / hooks → `packages/agent/`

Don't over-extend — if you're not sure where it goes, write
"ownership unclear" rather than guess.

---

## 7 · The honest tail

After top-30 individual analysis, there are still hundreds of changed
pairs. Don't pretend to analyse them all. Instead, sample 5-10 from
the long tail and write one paragraph:

> **Long tail (805 paired changes not individually analysed):** sampled
> 10 pairs at `sizeChange` ∈ [-50, +50]. All 10 were
> minifier reshuffles (variable rename, comma reordering, no AST-level
> semantic change). Confidence the long tail is dominated by minifier
> noise: high.

That's an honest, defensible coverage statement.

---

## 8 · When you're stuck

- The fingerprint match misclassified two unrelated modules as a
  pair → diff is gibberish. Fix: try matching by `topStrings` overlap
  manually instead.
- Two semantically equivalent rewrites where everything renamed →
  appears as 100% changed but isn't. Fix: don't fight it, write
  "rename pass, no semantic delta visible".
- Module appears in `.removed` for A but a similar one is in `.new`
  for B with different name → the matcher missed it. You can manually
  pair them by reading both: if they're the same, document as
  "renamed/restructured, not actually new/removed".

---

## Self-edit invitation

If you find a recipe here is wrong (e.g. the regex misses cases) or
incomplete (a new technique works better) — **edit this file** before
ending the run. The next run will benefit. This file is a living
working manual, not a frozen spec.
