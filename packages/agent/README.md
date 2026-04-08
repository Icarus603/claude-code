# @claude-code/agent

Provider-agnostic agent loop primitives for Claude Code.

This package contains the extracted core loop, event model, dependency
interfaces, and compaction helpers used by the application. Runtime-side
integrations stay in `src/agent/*`, while this package remains focused on
portable logic and typed boundaries.
