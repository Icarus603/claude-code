# @claude-code/stdin-napi

In-process TTY stdin reader for ccb. Opens the terminal fd directly, sets
raw mode via `termios`, and does a blocking `read()` on a dedicated OS
thread — delivering each byte chunk to JS via a NAPI `ThreadsafeFunction`.
Compiled into a per-platform `.node` (NAPI) binary; Bun's bundler embeds
the `.node` into the standalone executable and `dlopen`s it from the
`__BUN` segment without writing it to disk.

## Why

Bun's standalone build (`bun build --compile`) inherits an unpatched
libuv. After an Ink mount→unmount→re-mount cycle, libuv's TTY stdin poll
stops re-arming: `process.stdin`'s `'data'`/`'readable'` events go silent
while the user keeps typing, even though the stream reports healthy state
(`readableFlowing=true, isPaused=false, listeners.data.count=1`). This is
THE blocker that killed nine workarounds in the 2026-05 REPL ↔ FleetView
port attempt (see `feedback_bun_standalone_stdin_unreliable.md`).

Anthropic's `claude` avoids the bug by shipping a private bun fork
(`bun-internal`) that patches libuv. We can't obtain that fork. So instead
of reading stdin *through* libuv, this reader bypasses it: the blocking
read runs on its own thread and never touches libuv's event loop, so the
poll bug can't reach it. Same "replace ant's mechanism with an in-process
rust call across NAPI" pattern that solved `ripgrep-napi`.

## API

```ts
isReaderSupported(): boolean
//   false on win32 (no termios — the rust side is a stub) and if the .node
//   failed to load. Callers fall back to the standard process.stdin path.

startReader(useDevTty: boolean, onChunk: (chunk: Buffer) => void): ReaderHandle
//   useDevTty=false (preferred): read fd 0 directly, sharing Bun's own
//     stdin fd. Avoids the mouse-bleed / terminal-response-bleed problems a
//     separate /dev/tty fd introduces.
//   useDevTty=true: open a fresh /dev/tty fd (full lifecycle owned here).
//   onChunk: one Buffer per read, trimmed to a UTF-8 char boundary. Feed it
//     straight into ink's App.handleData (accepts Buffer | string).

ReaderHandle.stop(): void
//   Idempotent. Wakes the read thread (via a self-pipe), restores the tty's
//   original termios synchronously, releases owned fds. Restore happens
//   before stop() returns, so the caller may immediately hand the tty to an
//   external program (e.g. $EDITOR).
```

## Design notes

- **Control via self-pipe + `poll()`**: a thread parked in a blocking
  `read()` can't be woken by a flag alone. The reader `poll()`s the tty and
  the read end of a self-pipe; `stop()` writes a byte to wake `poll()`
  instantly. No polling latency, no busy loop.
- **UTF-8 boundary carry**: mirrors `stdin.setEncoding('utf8')` — each
  emitted Buffer ends on a valid UTF-8 boundary; incomplete trailing bytes
  carry to the next read. Only matters for pasted/IME unicode (keystrokes
  and escape sequences are ASCII), but matching the semantics avoids subtle
  corruption.
- **fd ownership**: in fd0 mode the reader never closes fd 0 (Bun owns it),
  only restores its termios. In /dev/tty mode it owns the full lifecycle.
- **win32**: no termios. The rust side is a stub that returns an error;
  `isReaderSupported()` returns false up front and the REPL uses the
  standard `process.stdin` path. (win32's libuv stdin behavior differs and
  has not exhibited the post-cycle poll bug — to be confirmed.)

## Build & vendoring

Same as `ripgrep-napi`: `cargo build --release` produces a `cdylib`, copied
to `vendor/<arch>-<plat>/stdin.node`. The five platform binaries are
committed to git and built by `.github/workflows/build-stdin-napi.yml`.
