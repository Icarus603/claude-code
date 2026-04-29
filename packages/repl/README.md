# @claude-code/repl

The interactive Ink/React REPL screen + every UI component, hook, and
slash-command renderer that REPLView composes.

V7 §3.3 / §8.11 — REPLView is the thin host; all domain decomposition
(input handling, message rendering, permission UI, transcript mode,
fullscreen, suggestions) lives in submodules of this package.

## Notable internals

- `screens/REPLView.tsx` — the main TUI screen (~5640 LOC, ratchet-locked
  to shrink). Imports from 19+ packages because it composes the entire
  UI surface; further decomposition has hit diminishing returns (see
  memory `feedback_dont_decompose_for_loc.md`).
- `hooks/` — 70+ custom hooks (useReplAppState, useCommandQueue, useGlobalKeybindings,
  useCanUseTool, useNotifications, etc.). The bulk of REPLView's logic
  has already been extracted into hooks; what's left in REPLView is
  state machine + JSX tree composition.
- `Cursor.ts` — kill ring + Vim character classification primitives.
  Pure functions; tested.
- `history.ts` — paste-ref formatters and parsers (`[Pasted text #N +M lines]`),
  history file persistence.
- `extraUsage.ts` — `/extra-usage` slash-command predicates.

## Tests

In-tree tests in `src/__tests__/` (4 files / 54 tests):
- `killRing.test.ts` (14) — kill ring state machine
- `vimCharClass.test.ts` (9) — Vim character classification (mutually exclusive)
- `history.test.ts` (19) — paste-ref formatters/parsers
- `extraUsage.test.ts` (7) — command predicates with mock-module pattern

Mock-module pattern documented in `extraUsage.test.ts`: spread the real
exports first, override only the symbol under test, so other consumers
loaded into the same test process keep working. Re-use this pattern for
new tests in this package.
