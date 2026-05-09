# scheduler/ — daily auto-update via launchd

Three files. Plus the work happens in `../check-and-update.sh`.

```
scheduler/
├── com.icarus.bun-demincer.plist  # the job definition (template — paths hardcoded for liuzetfung)
├── install.sh                      # cp → ~/Library/LaunchAgents/ + bootstrap
└── uninstall.sh                    # bootout + rm
```

## What it does

Every day at 09:07 local, fires `../check-and-update.sh`. That script:

1. Reads the newest non-empty binary under `~/.local/share/claude/versions/`.
2. Reads the newest fully-decoded version under `../work/claude-code-*/decoded/`.
3. If the official binary is newer → run `../decode.sh`, then `../delta.sh --auto`,
   then `../analyze.sh --all-pairs` (spawns ccb agent on Opus 4.7 with
   bypassPermissions to write a structured changelog into `../reports/<A>-to-<B>/`).
4. Otherwise no-op (and that's most days).

The agent reads `analyzer/PROMPT.md` / `METHOD.md` / `TEMPLATE.md` /
`EXAMPLE.md` for its instructions — those files are the "program" the
agent runs. Edit them to change behaviour; do not edit the prompt
string in `analyze.sh` (it's a 3-line pointer to the analyzer/ dir).

Both paths are absolute and hardcoded for `/Users/liuzetfung/`. If you (future-me, future-agent) ever need this on another machine, regenerate the plist.

## Operate

```bash
# install / re-install (idempotent — bootout-then-bootstrap)
./install.sh

# verify it's loaded
launchctl list | grep com.icarus.bun-demincer

# trigger immediately (skip the 09:07 wait — useful for testing)
launchctl kickstart gui/$UID/com.icarus.bun-demincer

# tail the runs.log to see it work
tail -f ../runs.log

# remove
./uninstall.sh
```

## Why launchd, not ccb scheduler

The task is pure shell + node — no LLM, no conversation context, no
ccb-specific state. ccb's CronCreate caps recurring jobs at 7 days
and only fires while ccb is open. launchd has neither limit and runs
when the machine is awake regardless of ccb state. Don't reach for
ccb when launchd is the right primitive.

If the machine is asleep at 09:07, launchd fires the job when the
machine next wakes up (default catch-up behavior). If the machine is
off, the next run simply happens at the next 09:07 — `decode.sh`
auto-walks every missing version, so up to 7 days off costs you
nothing beyond a longer pipeline next run.

## Logs / state

| File | Owner | Purpose |
|------|-------|---------|
| `../runs.log` | already existed (decode.sh / delta.sh write here) | human-readable history |
| `../.launchd-stdout.log` | new — written by launchd directly | catch raw stdout if check-and-update.sh ever crashes outside `set -e` |
| `../.launchd-stderr.log` | new — written by launchd directly | same for stderr |
| `../.update.lock` | check-and-update.sh flock | prevents manual + scheduled run from interleaving |

All are inside `bun-demincer/` and covered by the existing `.gitignore`
(via `runs.log` for the first one, and the parent ccb `.gitignore`
ignoring all of `bun-demincer/`). Nothing leaks into git.

## Failure modes

- **`node` not found in PATH**: plist sets PATH explicitly. If it ever breaks, check that `which node` still resolves to `/opt/homebrew/bin/node`.
- **decode.sh fails on one version**: pipeline aborts at that version (decode.sh has `set -euo pipefail`). The log will show which version failed; manual `./decode.sh <version> --force` can retry.
- **two runs collide**: flock makes the second one bail. Visible in runs.log: `another run in progress (lock held) — exiting`.
- **macOS notification doesn't appear**: `osascript` errors are silently swallowed (`|| true`) — never blocks the pipeline. Notifications need an active Aqua session; if you ssh in and trigger manually, no notification — that's expected.
