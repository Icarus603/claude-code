# @claude-code/app-host

Composition root: bootstrap state, session-global singletons (cwd,
project root, model overrides, permission mode), command registry
runtime, and the React provider tree that wraps the REPL.

V7 §8.2 — owns all module-level mutable state. Other packages read
through getters here, never via direct imports of state files.
