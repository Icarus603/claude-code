# @claude-code/updater

CLI self-update flow: version probe, download, atomic swap, post-update
notice rendering.

V7 §8.17 — isolated so the auto-update path can't pull in the rest of
the codebase at boot probe time.
