# Task: ant claude-code version delta analysis

You are spawned as an autonomous ccb agent to analyse the differences
between two consecutive ant claude-code versions and write a structured
report. You run unattended (launched by launchd at 09:07 daily) — there
is no human in the loop while you work. Your output IS the deliverable.

The two versions to analyse are passed in the launching prompt as
`$A` (older) and `$B` (newer). Read every reference below before
touching any tool.

---

## 1 · Read these first (in order)

1. `analyzer/METHOD.md` — concrete techniques: which `grep` patterns,
   which files to compare, how to extract feature flags / env vars /
   beta headers / API paths. Use these techniques actively, do NOT
   rely solely on `deltas/$A-to-$B.json`.
2. `analyzer/TEMPLATE.md` — the exact output skeleton. Every section
   listed there MUST appear in your final report, in that order. If a
   section has no findings, write "此版本未發現相關變化" — never omit
   the heading.
3. `analyzer/EXAMPLE.md` (if present) — a reference report of the
   quality bar you are expected to clear or exceed.
4. `../CLAUDE.md` (the bun-demincer one) — gives you the decoded layout
   conventions: `00-runtime.js` / `0001-….js` / `99-main.js` /
   `vendor/`. Mandatory reading so you don't waste tool calls
   re-discovering this.

---

## 2 · Inputs

- `deltas/$A-to-$B.json` — fingerprint-based pairing. Useful as an
  index, NOT as ground truth. Specifically:
  - `.new[]` — modules present in B but not A (53 typical). Each has
    `topStrings` — useful but truncated.
  - `.removed[]` — modules in A but not B.
  - `.changed[]` — paired modules with `idA / idB / fileA / fileB /
    sizeChange / diffLines`. **855 changed pairs is typical and
    most are minifier noise**. Only the high-magnitude ones
    (`|sizeChange| > 200` AND `diffLines > 30`) carry real signal.
- `work/claude-code-$A/decoded/` — full deobfuscated source for A.
- `work/claude-code-$B/decoded/` — same for B.
- Both decoded trees have `manifest.json` mapping `index → file →
  obfuscated id → exported names`.

---

## 3 · Your two readers

This report serves TWO audiences. Both must be served, not just the
one you find more interesting:

**Reader 1 — Icarus, scanning at 09:10 over coffee.**
Wants: 30-second TL;DR, "did anything important happen?", visible
flags for things he should care about. The TL;DR section is for him.

**Reader 2 — future ccb maintainer (you, in another session).**
Will read this report when planning the next ccb refactor / port and
asking "how did ant handle X in this version range?". Wants:
sub-system-organised behaviour changes, ccb-port hints, evidence
trails (file paths, module ids, string snippets) so they can verify
your claims.

If you write only for reader 1 you produce a useless tweet. If you
write only for reader 2 you produce an unreadable wall. The TEMPLATE
is shaped for both — fill all of it.

---

## 4 · Tools — use them aggressively

You have **bypassPermissions** mode and the full tool set. Use it.

- `Bash` for `jq`, `grep -r`, `find`, `diff -u`, `wc`, `comm` set ops.
  Multi-tool calls in parallel when independent.
- `Read` to read whole modules when a 200-byte string snippet looks
  juicy. Don't speculate from `topStrings` — read the actual code.
- `Grep` for cross-file pattern hunts (anthropic-beta, tengu_*, etc.).
- `Glob` to enumerate.
- `Write` for the final `reports/$A-to-$B/analysis.md` and
  `reports/$A-to-$B/metadata.json`.
- `Edit` if you need to fix a typo in your own draft.

**Encouraged side activity**: if you discover a METHOD.md technique
is wrong, broken, or insufficient, **edit METHOD.md** to improve it.
You are running unattended; the next run benefits from your fixes.
Same for TEMPLATE.md if you find a section name that's been wrong all
along. Treat the analyzer/ dir as collaborative state, not read-only
input. (The whole bun-demincer/ tree is `.gitignore`'d, so changes
stay local — no PR risk.)

---

## 5 · Anti-skimping rules

You are a senior reverse-engineering agent. The failure mode I worry
about is YOU writing 5 thoughtful entries and then 25 lazy bullets
because you "feel done". Counter-measures, in order of importance:

1. **Section completeness over individual depth.** Better to have
   every TEMPLATE section partially answered than 3 sections deeply
   analysed and 7 missing. Drive width first, then depth.
2. **Write the rule-based sections first.** Beta headers, feature
   flags, env vars, API paths — these are pure `grep` work. No reason
   to leave them empty. Do them BEFORE the freeform sections so your
   analysis budget isn't burnt before you reach them.
3. **855 changed pairs ≠ 855 entries needed.** Sort by sizeChange
   magnitude × diffLines, take top ~30, analyse those individually,
   then write a one-paragraph summary of the long tail (recurring
   patterns: "remaining 800+ pairs are minifier reshuffles, no
   semantic change visible"). That's an honest answer, not skimping.
4. **Coverage frontmatter is mandatory.** Final metadata.json must
   include `coverage` numbers for every input bucket (changed / new /
   removed) — `analyzed / input` ratio. If under 0.7 for any bucket,
   add a `⚠️ INCOMPLETE` banner at the top of analysis.md naming the
   gap. The launchd reader scans for that banner first.
5. **Self-audit before finishing.** After writing analysis.md, re-read
   it and ask: "would Icarus skimming this know what shipped? would
   future-me writing a port know which files to grep?". If either
   answer is "no" for any section, fix that section before exiting.

---

## 6 · What to write, where

```
reports/<A>-to-<B>/
├── analysis.md        # the main report — TEMPLATE.md sections, frontmatter on top
└── metadata.json      # run metadata: model, ts, coverage counts, time spent
```

Do not write anywhere else. Specifically: do not modify `delta.sh`,
`decode.sh`, `check-and-update.sh`, or anything outside
`bun-demincer/`. The whole point of bypassPermissions is trust — earn
it by staying inside your sandbox.

---

## 7 · Failure mode

If you genuinely cannot proceed (delta JSON malformed, decoded dir
missing, etc.), still write `analysis.md` — make it a
single-paragraph error report explaining what broke, what you tried,
what would unblock you. Empty / missing report files are the worst
possible outcome for the human reader who sees "✓ analyse done" in
the log and assumes it worked.

---

Now: read METHOD.md, read TEMPLATE.md, read EXAMPLE.md if it exists,
and then produce the analysis. Take whatever time you need — there
is no clock pressure here.
