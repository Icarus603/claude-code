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
# NOTE: regex must include digits — flags like tengu_porch_bell_9f or
# tengu_loud_sugary_rock2 are common (versioned/cohort-suffixed). If you
# use `[a-z_]+` you will miss these.
comm -13 \
    <(grep -rohE 'tengu_[a-z][a-z_0-9]+' work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE 'tengu_[a-z][a-z_0-9]+' work/claude-code-$B/decoded/ | sort -u)
```

Also run the *removed* direction (set `comm -23`) — flag renames (e.g.
`tengu_loud_sugary_rock` → `tengu_loud_sugary_rock2`) appear as one new +
one removed and the pair is the actual story.

For each new flag, find the module(s) that read it:
```bash
grep -rl 'tengu_grey_step2' work/claude-code-$B/decoded/
```

**Standard cross-check — use new flags to FIND missed semantic changes.**
The `sizeChange`/`diffLines` gate in §2 regularly misses real features when
fingerprint pairing is off (confirmed 2.1.150→2.1.152: pair `4300→4317`
reported `diffLines=2` yet contained the entire new model-refusal-fallback
block). The new-flag list is the cure: every new `tengu_*` flag points at a
real feature. For each flag's reader module, confirm it's genuinely new by
grepping the flag (or its adjacent string constants) in A:
```bash
grep -rl 'tengu_refusal_fallback_triggered' work/claude-code-$A/decoded/  # 0 hits → new feature
```
If A has 0 hits, force a full `diff -u` of that module's pair regardless of
what the delta JSON's `diffLines` says. This recovers features the magnitude
gate drops.
Read that module to understand what the flag gates.

### 1c · New environment variables

```bash
# CLAUDE_*, ANTHROPIC_*, CCB_*, USER_TYPE
# Note: use bare CLAUDE_ (not CLAUDE_CODE_) — v2.1.142 introduced
# CLAUDE_BG_AUTH_SNAPSHOT_PATH which the narrower regex misses.
comm -13 \
    <(grep -rohE '(CLAUDE|ANTHROPIC|CCB)_[A-Z][A-Z_0-9]*' \
        work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE '(CLAUDE|ANTHROPIC|CCB)_[A-Z][A-Z_0-9]*' \
        work/claude-code-$B/decoded/ | sort -u)
```

**Caveat — outbound env vars vs inbound env vars.** The above catches
env vars that ant *reads* (`process.env.CLAUDE_CODE_X`). It misses env
vars that ant *sets* on a child process (e.g. `CLAUDE_EFFORT` in
v2.1.133). To catch those, also grep for assignment patterns:

```bash
# Outbound: env vars ant exposes to child processes / hooks / status line
comm -13 \
    <(grep -rohE 'CLAUDE_[A-Z][A-Z_0-9]* = ' work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE 'CLAUDE_[A-Z][A-Z_0-9]* = ' work/claude-code-$B/decoded/ | sort -u)
# Also useful: grep for `\${CLAUDE_X}` template-string usages and `env.X` field assignments
```

### 1d · New API paths

```bash
# /v1/* (model API) AND /api/* (dashboard API) — ant uses both
comm -13 \
    <(grep -rohE '"/(v1|api)/[a-z_/?][a-z_/?-]*"' work/claude-code-$A/decoded/ | sort -u) \
    <(grep -rohE '"/(v1|api)/[a-z_/?][a-z_/?-]*"' work/claude-code-$B/decoded/ | sort -u)
```

**Caveat — string vs. template literal.** This catches *string-literal* paths only.
If a module composes the path as `${BASE}/v1/foo` and only the suffix
is in the regex (e.g. `"/v1/foo"` is never a single literal), the path
goes undetected. When B refactors an API client to use a stricter
helper (e.g. `gz.get("/v1/foo", { auth: "..." })`) the path may appear
as "new" in B even though the endpoint existed in A — read both modules
before claiming a brand-new endpoint.

**Confirmed on 2.1.143→2.1.149:** `comm -13` flagged `/v1/code/triggers`,
`/v1/code/github/import-token`, `/api/claude_cli_feedback` as "new"
literals in B. All three existed in A but as **template literals**
(`` `${URL}/v1/code/triggers` ``) — B refactored them into bare string
literals (`_K.post("/v1/code/github/import-token", ...)`). They are NOT
new endpoints. **Mandatory verification step** before listing any path
under "新增 API endpoints": strip the quotes and grep the *unquoted*
fragment in A:

```bash
grep -rl 'code/triggers' work/claude-code-$A/decoded/   # finds template-literal usages too
```

If A has it in any form, it's a refactor, not a new endpoint — say so
explicitly so the ccb maintainer doesn't try to implement an
already-existing surface.

**Caveat — skill-prompt paths are not CLI behaviour.** ant ships large
`/claude-api`-style skill files whose prompt text contains full API
reference tables (`POST /v1/agents`, `/v1/sessions`, `/v1/environments`,
…). These are *documentation strings fed to Claude*, not endpoints the
CLI calls. On 2.1.143→2.1.149 the entire Managed Agents `/v1/agents*`
surface lived only in `5412.js` (the skill doc). To distinguish: grep
the path and check whether the hit is inside a backtick-delimited
markdown table / instruction block (doc) vs. an actual `.get(`/`.post(`
call (real client). Flag doc-only paths as "skill prompt text, not CLI
behaviour" so they aren't mistaken for port targets.

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

### 2a · Caveat — `sizeChange` alone misses equal-length rewrites

The `|sizeChange|>200` gate above silently drops the most common
real-change pattern in small patch releases: a module whose
identifiers all shift by one (`KTO→qTO`, `OTO→KTO`, …) so the file is
**byte-length-identical** (`sizeChange=0`) yet has thousands of
`diffLines`. Confirmed on 2.1.149→2.1.150 where `5412.js` had
`sizeΔ=0, diffLines=4234` (pure rename) and the *only* real feature
change `5000.js` sat at `sizeΔ=+159, diffLines=120`. Lesson: **sort by
`diffLines` too, not just `sizeChange`**, and never assume `sizeΔ=0`
means "unchanged". Add a second pass:

```bash
jq -r '.changed | sort_by(.diffLines) | reverse | .[0:30] | .[]
       | "\(.fileA)→\(.fileB) sizeΔ=\(.sizeChange) diffLines=\(.diffLines)"' \
    deltas/$A-to-$B.json
```

### 2b · Fast minifier-noise filter — cross-pair added-literal scan

When the changed set is large but you suspect most pairs are pure
identifier churn, run ONE scan across all pairs that surfaces only
*new string literals* (the real signal — new flags, new prompt text,
new error messages). Identifier renames produce no new quoted strings,
so they drop out automatically:

```bash
jq -r '.changed[] | "\(.fileA) \(.fileB)"' deltas/$A-to-$B.json | while read fa fb; do
  added=$(diff <(grep -oE '"[^"]{6,}"' work/claude-code-$A/decoded/$fa 2>/dev/null | sort -u) \
               <(grep -oE '"[^"]{6,}"' work/claude-code-$B/decoded/$fb 2>/dev/null | sort -u) \
          | grep '^>' | grep -vE 'VERSION_STRING|BUILD_DATE|GIT_SHA_REGEX')
  [ -n "$added" ] && { echo "=== $fa -> $fb ==="; echo "$added" | head -8; }
done
```

Replace the `grep -vE` exclusion with the actual version/date/sha
literals of version B (find them once in any `5469.js`-style file).
On 2.1.149→2.1.150 this collapsed all 37 changed pairs down to a
single pair (`5000.js`) with genuinely new strings
(`"tengu_heron_brook"`, `"heron_brook"`) — minutes of work instead of
37 manual diffs. Highly recommended as step 1 for any patch-level
delta before deciding which pairs need full `diff -u`.

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
