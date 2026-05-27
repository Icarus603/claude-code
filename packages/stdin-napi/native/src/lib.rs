//! stdin-napi — in-process TTY stdin reader for ccb.
//!
//! ## Why this exists
//!
//! Bun's standalone (`bun build --compile`) build inherits an unpatched
//! libuv. After an Ink mount→unmount→re-mount cycle, libuv's TTY stdin poll
//! stops re-arming: `process.stdin`'s `'data'`/`'readable'` events go silent
//! while the user keeps typing, even though the stream reports healthy state
//! (`readableFlowing=true, isPaused=false, listeners.data.count=1`). Anthropic
//! ships a private bun fork (bun-internal) that patches libuv to fix this; we
//! can't obtain that fork.
//!
//! Instead of reading stdin *through* libuv, this crate opens the tty fd
//! directly, sets raw mode via termios, and does a blocking `read()` on a
//! dedicated OS thread — pushing each chunk to JS via a `ThreadsafeFunction`.
//! The read loop never touches libuv's event loop, so the poll bug can't
//! reach it. This is the same "replace ant's mechanism with an in-process
//! rust call across NAPI" pattern that solved ripgrep (see ripgrep-napi).
//!
//! ## Control: self-pipe + poll()
//!
//! A thread parked inside a blocking `read()` can't be woken by an
//! `AtomicBool` alone. We `poll()` on two fds — the tty and the read end of a
//! self-pipe. `stop()` writes a byte to the pipe's write end, which wakes
//! `poll()` instantly; the thread then sees the stop flag and exits. No
//! polling latency, no busy loop.
//!
//! ## UTF-8 boundary carry
//!
//! Ink's `App.tsx` calls `stdin.setEncoding('utf8')`, which emits strings at
//! UTF-8 char boundaries (incomplete trailing bytes are carried to the next
//! event). We replicate that: each emitted `Buffer` ends on a valid UTF-8
//! boundary, and any incomplete trailing bytes are carried. Keystrokes and
//! escape sequences are ASCII so this only matters for pasted/IME unicode,
//! but matching the semantics exactly avoids subtle corruption.
//!
//! ## fd ownership
//!
//! In fd0 mode we read fd 0, which Bun owns — we never close it, only restore
//! its termios. In /dev/tty mode we open a fresh fd and own its full
//! lifecycle.

#![deny(clippy::unwrap_used, clippy::expect_used)]

#[cfg(unix)]
mod unix_impl {
  use std::os::unix::io::RawFd;
  use std::sync::atomic::{AtomicBool, AtomicI32, Ordering};
  use std::sync::{Arc, Mutex};

  use napi::bindgen_prelude::*;
  use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};

  // Count of live reader threads. If >1, a stale reader from a prior
  // mount didn't die and is stealing fd 0 bytes (dropped keystrokes).
  static ACTIVE_READERS: AtomicI32 = AtomicI32::new(0);

  // --- Refcounted fd-0 termios baseline ---------------------------------
  // Every redirect_fd0=false reader reads fd 0 *directly* and, on its own,
  // would set raw on start and restore cooked on stop. During a CHAINED
  // handoff — REPL→FleetView reader, then attach reader, then FleetView
  // reader again on detach — a stop() that restored cooked BETWEEN two raw
  // readers left fd 0 in cooked+echo for the (async, multi-tick) Ink remount
  // window. Any keystroke in that window was echoed by the tty line
  // discipline, so arrow keys surfaced as visible `^[[C` garbage in the
  // FleetView footer.
  //
  // Fix: refcount the raw state on fd 0. The FIRST fd-0 reader captures the
  // real cooked termios as the baseline and sets raw; later readers in the
  // chain just bump the count (fd 0 is already raw — they must NOT re-capture,
  // or they'd store the raw termios as the "baseline" and never restore
  // cooked). Only when the LAST reader stops do we restore the baseline. fd 0
  // therefore stays raw across the entire handoff — no cooked echo window.
  //
  // Scope: ONLY the shared-fd-0 path (redirect_fd0=false). The redirect path
  // (owns_tty=true) reads a private dup and keeps its own per-reader save/
  // restore — no sharing, no refcount.
  static FD0_RAW_REFCOUNT: AtomicI32 = AtomicI32::new(0);
  static FD0_BASELINE: Mutex<Option<libc::termios>> = Mutex::new(None);

  /// Acquire a refcounted raw-mode reference on fd 0.
  ///
  /// Two responsibilities, deliberately SEPARATED (the 2026-05-27 fleet-reader
  /// bug was conflating them):
  ///
  ///   1. BASELINE CAPTURE — only the first acquirer (refcount 0→1) saves fd 0's
  ///      current termios as the cooked baseline to restore on the last release.
  ///      Later acquirers must NOT re-capture: between two acquires fd 0 is
  ///      already raw, so capturing then would store the RAW termios as the
  ///      "baseline" and the cooked state would be lost forever.
  ///
  ///   2. FORCE RAW — EVERY acquirer re-applies raw mode, even when refcount>0.
  ///      The old code skipped this on refcount>0, assuming "already raw stays
  ///      raw". That assumption is FALSE in ccb's pin→destroy→reader sequence:
  ///      `pinFd0Raw()` raws fd 0 (refcount 0→1), then App.handleSetRawMode's
  ///      reader branch calls `process.stdin.destroy()` to evict Bun's libuv tty
  ///      handle — and Bun's destroy resets fd 0's termios back to COOKED out of
  ///      band, WITHOUT touching our refcount. The subsequent reader acquire
  ///      (refcount 1→2) then saw refcount>0 and skipped set_raw, so fd 0 stayed
  ///      cooked: ICANON+ECHO on → arrow/mouse bytes echoed as `^[[C` garbage +
  ///      poll() never reported POLLIN for unterminated lines → reader read
  ///      nothing → FleetView input dead. Re-applying raw on every acquire
  ///      reasserts the mode regardless of who cooked it behind our back.
  ///      Idempotent: cfmakeraw on an already-raw fd is a no-op.
  unsafe fn fd0_acquire_raw() -> std::result::Result<(), String> {
    let mut guard = FD0_BASELINE
      .lock()
      .map_err(|_| "fd0 baseline mutex poisoned".to_string())?;
    let first = FD0_RAW_REFCOUNT.load(Ordering::SeqCst) == 0;
    if first {
      // First acquirer — capture the real cooked baseline AND raw it. set_raw
      // returns the prior (cooked) termios; stash it for the last release.
      let saved = set_raw(0)?;
      *guard = Some(saved);
    } else {
      // Subsequent acquirer — fd 0 SHOULD already be raw, but an out-of-band
      // actor (Bun's stdin.destroy(), a child that reset termios, SIGCONT) may
      // have cooked it without our knowledge. Re-assert raw, but do NOT
      // re-capture the baseline (the cooked baseline from the first acquire is
      // the one we must restore on the last release). Discard the returned
      // (possibly already-raw) termios.
      let _ = set_raw(0)?;
    }
    FD0_RAW_REFCOUNT.fetch_add(1, Ordering::SeqCst);
    Ok(())
  }

  /// Release one fd-0 raw reference. The LAST release restores the original
  /// cooked termios; intermediate releases leave fd 0 raw for the next reader
  /// in the chain (closing the echo window).
  unsafe fn fd0_release_raw() {
    let mut guard = match FD0_BASELINE.lock() {
      Ok(g) => g,
      Err(poisoned) => poisoned.into_inner(),
    };
    let prev = FD0_RAW_REFCOUNT.fetch_sub(1, Ordering::SeqCst);
    if prev <= 1 {
      // Last reader out — restore the captured cooked termios.
      if let Some(saved) = guard.take() {
        libc::tcsetattr(0, libc::TCSANOW, &saved);
      }
      // Clamp to 0 in case of an unbalanced release (defensive).
      FD0_RAW_REFCOUNT.store(0, Ordering::SeqCst);
    }
  }

  /// JS-visible: how many rust reader threads are currently running.
  #[napi]
  pub fn active_reader_count() -> i32 {
    ACTIVE_READERS.load(Ordering::SeqCst)
  }

  /// Pin fd 0 in raw mode for an ENTIRE FleetView subsystem session, decoupled
  /// from any single reader's lifetime.
  ///
  /// ## Why this exists (the `^[[C` cooked-echo bug)
  ///
  /// The per-reader refcount (fd0_acquire_raw on start, fd0_release_raw on stop)
  /// only keeps fd 0 raw while readers OVERLAP. ccb's FleetView handoff is
  /// SERIAL, not overlapping: the REPL→FleetView reader stops (refcount → 0 →
  /// fd 0 flips back to COOKED) BEFORE the attach reader starts, and the attach
  /// reader stops before the next FleetView reader starts. In every gap fd 0
  /// sits in cooked+echo for the duration of an async, multi-tick transition
  /// (Ink remount, `await import`, and — worst — fleetAttach polling pty.sock
  /// for up to 10s). Any keystroke in that window is echoed by the tty line
  /// discipline, surfacing as visible `^[[C` / `^[[D` garbage.
  ///
  /// ant has no such window: its fd 0 enters raw when the first Ink App mounts
  /// and stays raw for the whole FleetView subsystem — the attach client's
  /// detach only restores cooked `if (!enteredRaw)` (2337.js handleSetRawMode
  /// gated on `!isHandoffRawMode`; 4945.js `if (!C) ON(q,false)`), and since the
  /// outer FleetView entered raw, attach never flips it back. fd 0 is raw from
  /// the moment you enter the subsystem until you leave it entirely.
  ///
  /// `pin_fd0_raw()` reproduces that invariant: the bridge calls it ONCE when
  /// entering the FleetView subsystem (after the REPL unmount). It bumps the
  /// SAME `FD0_RAW_REFCOUNT` the readers use, capturing the cooked baseline if
  /// fd 0 isn't raw yet. The pin holds a +1 reference across the entire
  /// subsystem, so even when every reader has stopped (refcount would otherwise
  /// be 0) the pin keeps it ≥ 1 → fd 0 never flips to cooked → no echo window.
  /// `unpin_fd0_raw()` drops the pin when the whole fleet loop exits (back to
  /// the foreground REPL / process shutdown); the last release restores cooked.
  ///
  /// Idempotent per process is NOT assumed — the JS side guards against double
  /// pin/unpin. Scoped to the shared-fd-0 path; redirect-mode readers own a
  /// private dup and are unaffected.
  #[napi]
  pub fn pin_fd0_raw() -> Result<()> {
    unsafe { fd0_acquire_raw() }.map_err(|m| Error::from_reason(format!("stdin-napi: {m}")))
  }

  /// Release the subsystem raw-mode pin taken by {@link pin_fd0_raw}. The last
  /// outstanding fd-0 raw reference (pin or reader) restores the cooked
  /// baseline. Safe to call even if no pin is held (clamped at 0).
  #[napi]
  pub fn unpin_fd0_raw() {
    unsafe { fd0_release_raw() }
  }

  use napi_derive::napi;

  /// JS-visible handle to a running reader. Hold it; call `.stop()` to tear
  /// the reader down (restores termios synchronously before returning, so the
  /// caller can immediately hand the tty to an external program like $EDITOR).
  /// `stop()` is idempotent.
  #[napi]
  pub struct ReaderHandle {
    inner: Arc<ReaderState>,
  }

  struct ReaderState {
    stopped: AtomicBool,
    /// Write end of the self-pipe; writing wakes the reader thread's poll().
    pipe_w: RawFd,
    /// The tty fd we read from.
    tty_fd: RawFd,
    /// Whether we opened tty_fd ourselves (/dev/tty mode) and must close it.
    owns_tty: bool,
    /// Saved termios, restored on stop.
    saved: libc::termios,
    /// fd0-redirect mode: when >= 0, fd 0 was dup2'd to /dev/null so Bun's
    /// libuv stops stealing tty bytes, and this holds a dup() of the ORIGINAL
    /// fd 0 (the real tty) that the reader reads from. On stop we dup2 it back
    /// onto fd 0 so Bun's process.stdin (still alive, never destroyed) sees
    /// the real tty again — that's how the FleetView→attach handoff works
    /// without destroying any handle (mirrors ant's "handle never destroyed"
    /// invariant). -1 means not in redirect mode.
    saved_stdin_dup: RawFd,
    /// True when this reader took a shared-fd-0 raw reference (redirect_fd0
    /// =false). stop() then routes through fd0_release_raw (refcounted) rather
    /// than restoring `saved` itself. False for redirect-mode readers, which
    /// own a private dup and restore `saved` directly.
    shared_fd0: bool,
  }

  // SAFETY: the raw fds and termios are only mutated under the `stopped`
  // CAS gate; once stopped, no thread touches them again. termios is a POD.
  unsafe impl Send for ReaderState {}
  unsafe impl Sync for ReaderState {}

  #[napi]
  impl ReaderHandle {
    /// Stop the reader: wake the read thread, restore the tty's original
    /// termios, and release owned fds. Idempotent and safe to call from any
    /// thread. Returns once termios is restored.
    #[napi]
    pub fn stop(&self) {
      self.inner.stop();
    }
  }

  impl ReaderState {
    fn stop(&self) {
      // CAS so a double-stop is a no-op and the cleanup runs exactly once.
      if self
        .stopped
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
      {
        return;
      }
      unsafe {
        if self.shared_fd0 {
          // Shared-fd-0 path: route through the refcount. Only the LAST reader
          // in a chained handoff restores cooked termios; intermediate stops
          // leave fd 0 raw so the next reader inherits raw mode with no echo
          // window. (See fd0_release_raw + FD0_BASELINE.)
          fd0_release_raw();
        } else {
          // Redirect / private-dup path: restore this reader's own saved
          // termios FIRST so the tty is back in its original mode the moment
          // stop() returns (the caller may spawn an editor next).
          libc::tcsetattr(self.tty_fd, libc::TCSANOW, &self.saved);
        }
        // fd0-redirect mode: put the REAL tty back onto fd 0 so Bun's
        // process.stdin (alive, never destroyed) reads the tty again. This is
        // the handoff back to the Node-stream path (e.g. attach's runAttach
        // which uses process.stdin). dup2 closes whatever fd 0 currently is
        // (the /dev/null we redirected to) and makes fd 0 a copy of the saved
        // real-tty dup; then we close the now-redundant dup.
        if self.saved_stdin_dup >= 0 {
          libc::dup2(self.saved_stdin_dup, 0);
          libc::close(self.saved_stdin_dup);
        }
        // Wake the reader thread's poll() so it observes `stopped` and exits.
        let byte: u8 = 1;
        let _ = libc::write(self.pipe_w, &byte as *const u8 as *const libc::c_void, 1);
        // Closing pipe_w also signals EOF/POLLHUP on pipe_r as a backstop.
        libc::close(self.pipe_w);
        if self.owns_tty {
          libc::close(self.tty_fd);
        }
        // fd 0 (owns_tty == false) is owned by Bun — never close it (unless
        // redirect mode already dup2'd the real tty back above).
      }
    }
  }

  /// Apply raw mode to `fd`, returning the prior termios for later restore.
  /// Mirrors `cfmakeraw` with VMIN=1/VTIME=0 (block for ≥1 byte, no timer).
  unsafe fn set_raw(fd: RawFd) -> std::result::Result<libc::termios, String> {
    let mut term: libc::termios = std::mem::zeroed();
    if libc::tcgetattr(fd, &mut term) != 0 {
      return Err(format!(
        "tcgetattr failed (fd {fd} is not a tty?): {}",
        std::io::Error::last_os_error()
      ));
    }
    let saved = term;
    libc::cfmakeraw(&mut term);
    term.c_cc[libc::VMIN] = 1;
    term.c_cc[libc::VTIME] = 0;
    if libc::tcsetattr(fd, libc::TCSANOW, &term) != 0 {
      return Err(format!(
        "tcsetattr failed: {}",
        std::io::Error::last_os_error()
      ));
    }
    Ok(saved)
  }

  /// Longest prefix length of `buf` that is valid UTF-8 and ends on a char
  /// boundary. Returns the byte count to emit now; the remainder is carried.
  ///
  /// - Fully valid → emit everything.
  /// - Incomplete trailing sequence (`error_len() == None`) → emit the valid
  ///   prefix, carry the tail for the next read.
  /// - Genuinely invalid byte mid-stream (`error_len() == Some`) → emit up to
  ///   and including the bad byte(s) so we never stall; `toString('utf8')` on
  ///   the JS side renders them as U+FFFD, matching Node's lossy decode.
  fn utf8_emit_len(buf: &[u8]) -> usize {
    match std::str::from_utf8(buf) {
      Ok(_) => buf.len(),
      Err(e) => match e.error_len() {
        None => e.valid_up_to(),
        Some(bad) => e.valid_up_to() + bad,
      },
    }
  }

  /// Start a blocking-read loop on a dedicated thread.
  ///
  /// `redirect_fd0`: the ownership model for fd 0.
  ///
  ///   true  — fd0-REDIRECT mode (the FleetView path). Bun's libuv keeps
  ///           polling fd 0 and STEALS tty bytes from us (a tty's input queue
  ///           is single; two readers split it). To make the rust reader the
  ///           SOLE tty reader WITHOUT destroying Bun's process.stdin handle
  ///           (ant's invariant: the handle is never destroyed, only handed
  ///           off), we: dup(0) to keep the real tty, then dup2(/dev/null, 0)
  ///           so Bun's libuv polls an empty fd and steals nothing. The reader
  ///           reads the saved real-tty dup. stop() dup2's the real tty back
  ///           onto fd 0, reviving process.stdin for the next consumer (attach
  ///           / a returning REPL). This is reversible — unlike destroy().
  ///
  ///   false — plain fd 0 read (no redirect). Only safe when nothing else
  ///           reads fd 0. Kept for completeness / tests.
  ///
  /// `on_chunk(Buffer)`: invoked once per read with the bytes received,
  /// trimmed to a UTF-8 boundary.
  #[napi]
  pub fn start_reader(
    redirect_fd0: bool,
    on_chunk: ThreadsafeFunction<Buffer>,
  ) -> Result<ReaderHandle> {
    // The fd the reader thread reads from, and (in redirect mode) the dup of
    // the original tty we restore onto fd 0 at stop().
    let (tty_fd, owns_tty, saved_stdin_dup): (RawFd, bool, RawFd) = if redirect_fd0 {
      // dup the current fd 0 (the real tty) — this is what the reader reads
      // AND what we put back on fd 0 at stop.
      let dup = unsafe { libc::dup(0) };
      if dup < 0 {
        return Err(Error::from_reason(format!(
          "stdin-napi: dup(0) failed: {}",
          std::io::Error::last_os_error()
        )));
      }
      // Redirect fd 0 → /dev/null so Bun's libuv poll on fd 0 reads nothing
      // and can't steal tty bytes.
      let devnull_path =
        std::ffi::CString::new("/dev/null").map_err(|e| Error::from_reason(e.to_string()))?;
      let devnull = unsafe { libc::open(devnull_path.as_ptr(), libc::O_RDONLY) };
      if devnull < 0 {
        unsafe { libc::close(dup) };
        return Err(Error::from_reason(format!(
          "stdin-napi: open /dev/null failed: {}",
          std::io::Error::last_os_error()
        )));
      }
      unsafe {
        libc::dup2(devnull, 0);
        libc::close(devnull);
      }
      // reader reads the saved real-tty dup; we own it; restore it on stop.
      (dup, true, dup)
    } else {
      (0, false, -1)
    };

    // Raw-mode acquisition. Two ownership models:
    //   - redirect mode (owns_tty): private dup, so save+raw this reader's own
    //     fd; `saved` is restored by THIS reader's stop().
    //   - shared fd 0: refcounted — fd0_acquire_raw() saves the cooked baseline
    //     once for the whole chain and never flaps it back to cooked between
    //     chained readers. `saved` is unused on this path (zeroed placeholder).
    let shared_fd0 = !owns_tty;
    let saved: libc::termios = if shared_fd0 {
      if let Err(msg) = unsafe { fd0_acquire_raw() } {
        return Err(Error::from_reason(format!("stdin-napi: {msg}")));
      }
      unsafe { std::mem::zeroed() }
    } else {
      match unsafe { set_raw(tty_fd) } {
        Ok(s) => s,
        Err(msg) => {
          unsafe { libc::close(tty_fd) };
          return Err(Error::from_reason(format!("stdin-napi: {msg}")));
        }
      }
    };

    // Self-pipe for waking poll() on stop. Read end nonblocking so drains
    // never block; both ends close-on-exec.
    let mut fds: [libc::c_int; 2] = [0; 2];
    if unsafe { libc::pipe(fds.as_mut_ptr()) } != 0 {
      unsafe {
        if shared_fd0 {
          fd0_release_raw();
        } else {
          libc::tcsetattr(tty_fd, libc::TCSANOW, &saved);
          libc::close(tty_fd);
        }
      }
      return Err(Error::from_reason(format!(
        "stdin-napi: pipe() failed: {}",
        std::io::Error::last_os_error()
      )));
    }
    let (pipe_r, pipe_w) = (fds[0], fds[1]);
    unsafe {
      let flags = libc::fcntl(pipe_r, libc::F_GETFL);
      libc::fcntl(pipe_r, libc::F_SETFL, flags | libc::O_NONBLOCK);
      libc::fcntl(pipe_r, libc::F_SETFD, libc::FD_CLOEXEC);
      libc::fcntl(pipe_w, libc::F_SETFD, libc::FD_CLOEXEC);
    }

    let state = Arc::new(ReaderState {
      stopped: AtomicBool::new(false),
      pipe_w,
      tty_fd,
      owns_tty,
      saved,
      saved_stdin_dup,
      shared_fd0,
    });
    let thread_state = Arc::clone(&state);

    std::thread::Builder::new()
      .name("stdin-napi-reader".into())
      .spawn(move || {
        reader_loop(&thread_state, tty_fd, pipe_r, on_chunk);
        // Thread owns pipe_r's close (stop() owns pipe_w).
        unsafe { libc::close(pipe_r) };
      })
      .map_err(|e| {
        // Spawn failed — undo everything synchronously.
        state.stop();
        Error::from_reason(format!("stdin-napi: thread spawn failed: {e}"))
      })?;

    Ok(ReaderHandle { inner: state })
  }

  struct ReaderCountGuard;
  impl Drop for ReaderCountGuard {
    fn drop(&mut self) {
      ACTIVE_READERS.fetch_sub(1, Ordering::SeqCst);
    }
  }

  fn reader_loop(
    state: &Arc<ReaderState>,
    tty_fd: RawFd,
    pipe_r: RawFd,
    on_chunk: ThreadsafeFunction<Buffer>,
  ) {
    ACTIVE_READERS.fetch_add(1, Ordering::SeqCst);
    let _guard = ReaderCountGuard;
    let mut buf = [0u8; 4096];
    // Carry for an incomplete UTF-8 sequence split across reads.
    let mut carry: Vec<u8> = Vec::new();

    loop {
      if state.stopped.load(Ordering::SeqCst) {
        break;
      }

      let mut pfds = [
        libc::pollfd {
          fd: tty_fd,
          events: libc::POLLIN,
          revents: 0,
        },
        libc::pollfd {
          fd: pipe_r,
          events: libc::POLLIN,
          revents: 0,
        },
      ];

      // Block indefinitely until either fd is ready. -1 timeout = no timer.
      let pr = unsafe { libc::poll(pfds.as_mut_ptr(), 2, -1) };
      if pr < 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::EINTR) {
          continue;
        }
        break;
      }

      // Stop signalled (pipe readable or hung up) — exit before reading tty.
      if state.stopped.load(Ordering::SeqCst)
        || (pfds[1].revents & (libc::POLLIN | libc::POLLHUP)) != 0
      {
        break;
      }

      // tty error/hangup → terminal closed.
      if (pfds[0].revents & (libc::POLLERR | libc::POLLHUP | libc::POLLNVAL)) != 0 {
        break;
      }
      if (pfds[0].revents & libc::POLLIN) == 0 {
        continue;
      }

      let n = unsafe {
        libc::read(tty_fd, buf.as_mut_ptr() as *mut libc::c_void, buf.len())
      };
      if n < 0 {
        let err = std::io::Error::last_os_error();
        if err.raw_os_error() == Some(libc::EINTR)
          || err.raw_os_error() == Some(libc::EAGAIN)
        {
          continue;
        }
        break;
      }
      if n == 0 {
        // EOF on the tty.
        break;
      }
      if state.stopped.load(Ordering::SeqCst) {
        break;
      }

      // Append to carry, then emit up to the last UTF-8 boundary.
      carry.extend_from_slice(&buf[..n as usize]);
      let emit_len = utf8_emit_len(&carry);
      if emit_len == 0 {
        // Whole buffer is an incomplete sequence — wait for more bytes.
        continue;
      }
      let chunk: Vec<u8> = carry[..emit_len].to_vec();
      carry.drain(..emit_len);
      // Blocking, NOT NonBlocking: NonBlocking DROPS the chunk when the JS
      // queue is full, which loses keystrokes during fast typing (typed
      // "hello", got "hlo"). Blocking makes this reader thread wait until the
      // chunk is enqueued, so no keystroke is ever dropped. The reader thread
      // is dedicated (not the JS thread), so blocking it briefly is fine.
      let _ = on_chunk.call(
        Ok(Buffer::from(chunk)),
        ThreadsafeFunctionCallMode::Blocking,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Non-unix (Windows): no termios. JS wires win32 to fall back to the standard
// process.stdin path. We still export start_reader so the JS binding loads,
// but it returns an error directing callers to the fallback.
// ---------------------------------------------------------------------------

#[cfg(not(unix))]
mod stub_impl {
  use napi::bindgen_prelude::*;
  use napi::threadsafe_function::ThreadsafeFunction;
  use napi_derive::napi;

  #[napi]
  pub struct ReaderHandle {}

  #[napi]
  impl ReaderHandle {
    #[napi]
    pub fn stop(&self) {}
  }

  #[napi]
  pub fn start_reader(
    _redirect_fd0: bool,
    _on_chunk: ThreadsafeFunction<Buffer>,
  ) -> Result<ReaderHandle> {
    Err(Error::from_reason(
      "stdin-napi: native reader is unix-only; use the process.stdin fallback on this platform"
        .to_string(),
    ))
  }
}

#[cfg(unix)]
pub use unix_impl::*;
#[cfg(not(unix))]
pub use stub_impl::*;
