# @claude-code/permission

Tool-permission policy: mode (default/yolo/plan), classifier, sandbox
ask-flow, shadowed rule detection, prompt UIs.

V7 §8.22 — every permission decision (allow/deny/ask) routes through
this package. UI components are exported for REPL to render.

## Notable internals

- `pathValidation.ts` — path security: tilde expansion (re-exports
  `expandTilde` from config/utils), allowlist/sandbox writability
  checks, dangerous-removal detection (`/`, `~`, `/usr`, `C:\`, etc.),
  Windows UNC vulnerability filtering.
- `dangerousPatterns.ts` — pattern catalog for shell-command danger
  classification.
- `denialTracking.ts` — tiny state machine (3 fields) for tracking
  consecutive vs total denials so the classifier knows when to fall
  back to prompting.
- `getNextPermissionMode.ts` — Shift+Tab cycle: default → acceptEdits →
  plan → bypassPermissions → default (Anthropic-internal users skip
  acceptEdits/plan and use auto mode instead).
- `bashClassifier.ts` — feature-gated (BASH_CLASSIFIER) classifier hook;
  off by default, intentional stub returns when disabled.

## Tests

In-tree tests in `src/__tests__/`:
- `pathValidation.test.ts` (29) — formatDirectoryList, getGlobBaseDirectory,
  isDangerousRemovalPath (security-critical), isPathInSandboxWriteAllowlist
- `denialTracking.test.ts` (11) — state machine immutability + cycle counts
- `getNextPermissionMode.test.ts` (14) — cycle correctness for non-ant + ant users
- Existing: PermissionMode, shellRuleMatching, dangerousPatterns,
  permissionRuleParser, permissions

Total: 8 test files, ~157 tests.
