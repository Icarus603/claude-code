# src/ — what lives here, what does not

This directory is **deliberately small**. Almost all implementation lives
under [`packages/`](../packages/); `src/` is reserved for things that
genuinely cannot live anywhere else.

## What belongs in src/

1. **Entrypoints** — files that the runtime invokes directly:
   - `entrypoints/cli.tsx` — true CLI entry, fast-path arg dispatch.
   - `main.tsx` — Commander tree, command registration, REPL/headless dispatch.
   - `entrypoints/init.ts` — one-time global initialization (telemetry, trust dialog).

2. **§10.3 init-side-effect facades** — files that wire setter callbacks
   at module load time, and whose ordering is anchored to the entrypoint.
   Examples: `utils/envUtils.ts`, `utils/format.ts`, `utils/cachePaths.ts`.
   Marked with `// V7 §10.3` and `// V7-EXEMPT` comments. The
   `verify-facade-budget.ts` ratchet caps how many of these can exist.

3. **Forward shims with active consumers** — small re-exports that
   point into `packages/` (and exist only because their consumers haven't
   been rewired yet). Tracked by `verify-src-shrinks.ts`; ongoing work
   eliminates these (see Phase-2 task #91).

## What does NOT belong here

- **New domain logic.** Add it to `packages/<owner>/src/`.
- **Runtime state.** That belongs in `packages/app-host/src/bootstrap/state.ts`.
- **New utility functions** with cross-cutting use. Pick the package
  whose responsibility owns the utility (output formatting → `output`,
  shell exec → `shell`, env reads → `config`, etc.).
- **Tests for package code.** Co-locate in `packages/<X>/src/__tests__/`.
- **Holding-pen names.** `*_v7`, `*_dir`, `*_topdir`, `legacy_*`
  (banned by `verify-no-holding-pens.ts`).

## Why the discipline

- **Build correctness.** Bun resolves cross-package imports through each
  package's `exports` map. Code under `src/` bypasses that map and reaches
  raw paths — fine for entrypoints, invisible breakage everywhere else.
- **Encapsulation.** Reaching into `src/utils/X` from a `package/` cancels
  the boundary that lets each package evolve its internal layout without
  ripping every consumer.
- **History.** During V7 the codebase had 1300+ files in `src/` with
  duplicate canonical owners in `packages/` (silent forks). The current
  shape is the result of consolidating those forks; new `src/` files
  re-create the problem.

## Adding something here

Don't, unless:
- It is a new entrypoint (rare — discuss first).
- It is genuinely a §10.3 facade (the canonical owner cannot run its
  setter wiring at boot for ordering reasons). Add `// V7 §10.3` comment,
  bump `verify-facade-budget.ts` budget with justification.

For everything else, find or create the right package under
`packages/`, expose the public surface via its `package.json` exports,
and `import` from there.

See [`docs/v7-completion.md`](../docs/v7-completion.md) for the full
architecture overview.
