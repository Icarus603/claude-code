# @claude-code/storage

File persistence, claudemd discovery, secure storage, gitFilesystem,
and other on-disk state utilities.

V7 §8.18 — every persistent read/write goes through this package so
file ops can be audited / sandboxed centrally.

## Notable internals

- `sessionStorage.ts` — owns the `Project` class for session/transcript
  JSONL persistence (4500+ LOC, ratchet-locked to shrink). Companion
  files: `sessionPaths`, `sessionStoragePredicates`, `agentMetadata`,
  `conversationChain` — all extracted from the original god-class.
- `sessionWriteQueue.ts` — per-file batched-append write queue extracted
  2026-04-29 (V8). Owns `pendingWriteCount`, `flushTimer`, `writeQueues`
  state plus the `enqueue()`, `trackWrite()`, `flush()` API. The Project
  class delegates to a SessionWriteQueue instance.
- `file.ts` — `writeFileSyncAndFlush` (atomic file write + fsync), the
  symlink-preserving variant used by FileWriteTool for source code.
- `editor.ts` — `$EDITOR`-style external editor launcher.
- `git.ts` — `getBranch`, `gitExe` for git subprocess access through the
  host-binding rather than direct child_process.
