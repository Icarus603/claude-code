//! ripgrep-napi — in-process ripgrep for ccb.
//!
//! Three public surfaces, called from JS via napi-rs:
//!
//!   findFiles(opts)       -> Promise<string[]>      (file enumeration)
//!   searchContent(opts)   -> Promise<Match[]>       (buffered regex search)
//!   searchStream(opts, cb) -> CancelHandle          (streaming regex search)
//!
//! Everything else (count helpers, etc.) is JS-side syntactic sugar over
//! these three.
//!
//! ## Threading model
//!
//! `findFiles`, `countFiles`, and `searchContent` are `async fn` that
//! offload the blocking `ignore::Walk` (and per-file `grep_searcher`
//! reads) onto napi-rs's tokio blocking pool via `spawn_blocking`. This
//! is critical: the walker hits `readdir`/`stat`/`open` for every entry
//! and on a 1.7M-file home directory takes ~2.5s wall time. Running it
//! on the JS main thread froze Bun's event loop for that entire window
//! — Ink stopped rendering, keystrokes piled up unprocessed.
//!
//! `searchStream` already runs on a dedicated `std::thread` and emits
//! results via `ThreadsafeFunction`, so it stays unchanged.
//!
//! ## Glob & file-type filtering — rg-exact, not hand-rolled
//!
//! Globs and `--type` filters are handed straight to the `ignore` crate's
//! `WalkBuilder` via `OverrideBuilder` and `TypesBuilder` — the *same*
//! matchers the real `rg` binary uses. This is load-bearing for parity:
//!
//!   * `OverrideBuilder` gives gitignore-semantics globs. A bare pattern
//!     (`*.ts`) matches at any depth; a leading `!` (`!.git`) excludes a
//!     whole directory subtree recursively. The previous hand-built
//!     `GlobSet` had neither property — `!.git` only matched a path whose
//!     final component was exactly `.git`, so `.git/config` slipped
//!     through and the VCS-exclude globs every GrepTool/Glob call pushes
//!     were silently no-ops (the walker handed back `.git/*` contents).
//!   * `TypesBuilder::add_defaults()` wires rg's built-in type table
//!     (`ts`, `py`, `rust`, `go`, `java`, …) so `--type ts` actually
//!     filters. It used to be parsed JS-side and then dropped on the floor.
//!
//! Because `WalkBuilder` applies both filters during the walk itself,
//! the walk loop no longer does any per-entry glob matching — it only
//! drops non-files, polls the cancel flag, and collects paths.
//!
//! ## Cancellation
//!
//! `searchStream` returns a `CancelHandle`; flipping the flag aborts at
//! the next walker step or sink callback. The buffered (`async`) calls
//! don't currently expose a cancel handle — the JS wrapper races a
//! `setTimeout` + `AbortSignal` against the returned `Promise`, which
//! lets the caller stop waiting (the walker keeps running to completion
//! on the blocking-pool thread, which is fine because the work is bounded
//! and we don't pay the cost again — napi's blocking pool reuses threads).
//!
//! ## Sandbox edge
//!
//! Sandbox-on-Linux still needs an rg binary path because
//! @anthropic-ai/sandbox-runtime invokes rg as an external enforcement
//! helper — that path lives in ccb's sandbox-adapter, not here.

#![deny(clippy::unwrap_used, clippy::expect_used)]

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use grep_regex::RegexMatcherBuilder;
use grep_searcher::{Searcher, SearcherBuilder, Sink, SinkMatch};
use ignore::overrides::OverrideBuilder;
use ignore::types::TypesBuilder;
use ignore::{DirEntry, WalkBuilder};
use napi::bindgen_prelude::*;
use napi::threadsafe_function::{ThreadsafeFunction, ThreadsafeFunctionCallMode};
use napi_derive::napi;

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

/// JS-visible handle. Hold it, call .cancel() to stop an in-flight search.
/// One handle = one search. Don't reuse.
#[napi]
pub struct CancelHandle {
  flag: Arc<AtomicBool>,
}

#[napi]
impl CancelHandle {
  #[napi]
  pub fn cancel(&self) {
    self.flag.store(true, Ordering::Relaxed);
  }
}

impl CancelHandle {
  fn new() -> (Self, Arc<AtomicBool>) {
    let flag = Arc::new(AtomicBool::new(false));
    (
      CancelHandle {
        flag: Arc::clone(&flag),
      },
      flag,
    )
  }
}

// ---------------------------------------------------------------------------
// Find files (the --files mode of every ripgrep caller)
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct FindFilesOptions {
  pub root: String,
  /// Globs to apply. Plain pattern = include; leading `!` = exclude.
  /// Exact gitignore semantics, same as ripgrep's `--glob`: a pattern
  /// with no `/` matches at any depth, and `!<dir>` excludes the whole
  /// subtree. Do NOT pre-mangle these JS-side (no `**/` prefixing) — the
  /// `ignore` crate's OverrideBuilder applies the conventions itself.
  pub globs: Option<Vec<String>>,
  /// File types to restrict to (`--type`), e.g. `["ts", "py"]`. Resolved
  /// against ripgrep's built-in type table. Unknown names are ignored
  /// (graceful — a typo'd type shouldn't abort the whole search).
  pub file_types: Option<Vec<String>>,
  pub hidden: Option<bool>,
  pub no_ignore: Option<bool>,
  pub follow: Option<bool>,
  pub max_depth: Option<u32>,
  /// Sort the result by file mtime descending. Costs a syscall per entry
  /// (stat) and an O(n log n) sort, so callers leave it off by default.
  pub sort_modified: Option<bool>,
}

// `async fn` here makes napi-rs return a JS `Promise<T>`, scheduled on
// the tokio blocking pool. The closure is `Send + 'static` (FindFilesOptions
// owns `String`/`Vec<String>`), so moving it across thread boundaries is
// safe. We only flatten the JoinHandle's join error into a napi `Error`
// — panics inside `walk` already propagate as Result errors.
//
// `spawn_blocking` is re-exported through `napi::bindgen_prelude::*`
// (gated on the `tokio_rt` feature, which `napi`'s `async` feature pulls in).
#[napi]
pub async fn find_files(opts: FindFilesOptions) -> Result<Vec<String>> {
  spawn_blocking(move || walk(&opts, None).map(|(out, _)| out))
    .await
    .map_err(|e| Error::from_reason(format!("find_files join error: {e}")))?
}

#[napi]
pub async fn count_files(opts: FindFilesOptions) -> Result<u32> {
  spawn_blocking(move || walk(&opts, None).map(|(out, _)| out.len() as u32))
    .await
    .map_err(|e| Error::from_reason(format!("count_files join error: {e}")))?
}

/// Build a `WalkBuilder` configured with the override globs, file-type
/// filter, and the hidden/ignore/follow/depth knobs. Shared by every
/// walking path (find/count/searchContent/searchStream) so glob+type
/// semantics can't drift between them.
fn build_walk_builder(
  root: &str,
  globs: Option<&[String]>,
  file_types: Option<&[String]>,
  hidden: bool,
  no_ignore: bool,
  follow: bool,
  max_depth: Option<u32>,
) -> Result<WalkBuilder> {
  let mut builder = WalkBuilder::new(root);

  // standard_filters(false) is a sledgehammer: it disables hidden,
  // parents, ignore, git_ignore, git_global, git_exclude all at once.
  // ripgrep's actual semantics differ: --no-ignore turns off the
  // ignore-file family but leaves hidden-file filtering intact.
  // Apply standard_filters first, then re-apply hidden() so it wins.
  if no_ignore {
    builder.standard_filters(false);
  }
  // ignore::WalkBuilder::hidden(yes) means "filter hidden files when yes
  // is true". Inverted from the CLI flag's --hidden (which makes them
  // visible). Default: skip hidden files.
  builder.hidden(!hidden);
  builder.follow_links(follow);
  if let Some(d) = max_depth {
    builder.max_depth(Some(d as usize));
  }

  // Glob overrides — gitignore semantics, `!` inverted to mean exclude.
  // This is exactly what `rg --glob` feeds the walker. An empty override
  // set is a no-op, so only attach when there's at least one glob.
  if let Some(globs) = globs {
    if !globs.is_empty() {
      let mut ob = OverrideBuilder::new(root);
      for g in globs {
        ob.add(g)
          .map_err(|e| Error::from_reason(format!("bad glob {g:?}: {e}")))?;
      }
      let ov = ob
        .build()
        .map_err(|e| Error::from_reason(format!("override build: {e}")))?;
      builder.overrides(ov);
    }
  }

  // File-type filter — ripgrep's built-in type table (`ts`, `py`, …).
  // Unknown types are dropped gracefully: if `build()` rejects a name we
  // fall back to no type filter rather than failing the whole search,
  // because `type` arrives from an LLM tool call and a typo ("typescript"
  // for "ts") shouldn't black-hole every result. rg itself hard-errors
  // here, but graceful-degrade is the right call for this caller.
  if let Some(types) = file_types {
    if !types.is_empty() {
      let mut tb = TypesBuilder::new();
      tb.add_defaults();
      for t in types {
        tb.select(t);
      }
      if let Ok(built) = tb.build() {
        builder.types(built);
      }
    }
  }

  Ok(builder)
}

/// Internal: shared walker for find/count. Optional cancel flag for the
/// streaming path to short-circuit.
fn walk(
  opts: &FindFilesOptions,
  cancel: Option<&Arc<AtomicBool>>,
) -> Result<(Vec<String>, bool)> {
  let builder = build_walk_builder(
    &opts.root,
    opts.globs.as_deref(),
    opts.file_types.as_deref(),
    opts.hidden.unwrap_or(false),
    opts.no_ignore.unwrap_or(false),
    opts.follow.unwrap_or(false),
    opts.max_depth,
  )?;
  let walk = builder.build();

  let mut out: Vec<String> = Vec::new();
  let mut entries_seen: usize = 0;
  let cancelled = AtomicBool::new(false);

  for entry in walk {
    // Cheap cancel poll. Once per 100 entries keeps the hot path branch-free
    // most of the time; ripgrep's own walker uses a similar cadence.
    entries_seen += 1;
    if entries_seen % 100 == 0 {
      if let Some(c) = cancel {
        if c.load(Ordering::Relaxed) {
          cancelled.store(true, Ordering::Relaxed);
          break;
        }
      }
    }

    let entry = match entry {
      Ok(e) => e,
      // Walker reports per-entry errors (permission denied, broken symlink,
      // etc.) inline rather than aborting. ripgrep prints them to stderr;
      // we silently skip — same effect for callers that just want results.
      Err(_) => continue,
    };

    // Glob/type filtering already happened inside the walker (overrides +
    // types). All we do here is drop non-files and collect paths.
    if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
      continue;
    }

    if let Some(s) = entry.path().to_str() {
      out.push(s.to_owned());
    }
  }

  if opts.sort_modified.unwrap_or(false) {
    sort_by_mtime_desc(&mut out);
  }

  Ok((out, cancelled.load(Ordering::Relaxed)))
}

fn sort_by_mtime_desc(paths: &mut [String]) {
  use std::time::SystemTime;
  // Cache mtimes so the Ord impl doesn't re-stat on every comparison.
  // Failed stats sort to the end (treated as oldest).
  let mut keyed: Vec<(SystemTime, String)> = paths
    .iter()
    .map(|p| {
      let mtime = std::fs::metadata(p)
        .and_then(|m| m.modified())
        .unwrap_or(SystemTime::UNIX_EPOCH);
      (mtime, p.clone())
    })
    .collect();
  keyed.sort_by(|a, b| b.0.cmp(&a.0));
  for (i, (_, p)) in keyed.into_iter().enumerate() {
    paths[i] = p;
  }
}

// ---------------------------------------------------------------------------
// Content search (regex)
// ---------------------------------------------------------------------------

#[napi(object)]
pub struct SearchContentOptions {
  pub root: String,
  pub pattern: String,
  pub case_insensitive: Option<bool>,
  /// `-F`: pattern is a literal string, not a regex.
  pub literal: Option<bool>,
  /// `-U --multiline-dotall`: `.` matches newlines.
  pub multiline_dotall: Option<bool>,
  /// `--max-columns`: drop the *content* of matches on lines longer than
  /// this. The file still counts as a match for files-with-matches mode —
  /// see CollectingSink for the membership-vs-content split.
  pub max_columns: Option<u32>,
  /// `-m`: stop after this many matches per file.
  pub max_count_per_file: Option<u32>,
  /// `-B`: lines of leading context to report around each match.
  pub before_context: Option<u32>,
  /// `-A`: lines of trailing context to report around each match.
  pub after_context: Option<u32>,
  /// File-level filters (same shape as findFiles).
  pub globs: Option<Vec<String>>,
  /// `--type` filter (same shape as findFiles).
  pub file_types: Option<Vec<String>>,
  pub hidden: Option<bool>,
  pub no_ignore: Option<bool>,
}

#[napi(object)]
#[derive(Clone)]
pub struct ContentMatch {
  pub path: String,
  pub line_number: Option<u32>,
  pub content: String,
  /// True when this match's line exceeded `max_columns` and its content
  /// was suppressed. The entry is still emitted (with empty `content`) so
  /// files-with-matches callers count the file — mirrors `rg -l`, which
  /// lists a file even when every match is on an over-long line. Content
  /// and count callers filter these out.
  pub column_truncated: bool,
  /// True when this entry is a CONTEXT line (from `-A`/`-B`/`-C`), not a
  /// real match. rg renders context with a `-` separator and matches with
  /// `:`; the JS content-mode formatter does the same. Context entries are
  /// NOT counted by `-c` and NOT listed as distinct files by `-l` (the
  /// file is already present from its real match), so those modes skip them.
  pub is_context: bool,
}

#[napi]
pub async fn search_content(opts: SearchContentOptions) -> Result<Vec<ContentMatch>> {
  // Walk + grep_searcher I/O both block — keep them off the JS thread.
  spawn_blocking(move || search_content_inner(opts))
    .await
    .map_err(|e| Error::from_reason(format!("search_content join error: {e}")))?
}

fn search_content_inner(opts: SearchContentOptions) -> Result<Vec<ContentMatch>> {
  let (matcher, mut searcher) = build_search(&opts)?;
  let walk_opts = walk_opts_from_search(&opts);
  let (paths, _cancelled) = walk(&walk_opts, None)?;

  let mut results: Vec<ContentMatch> = Vec::new();
  let max_per_file = opts.max_count_per_file.unwrap_or(u32::MAX);
  let max_columns = opts.max_columns.unwrap_or(u32::MAX);

  for path in paths {
    let mut sink = CollectingSink {
      path: &path,
      out: &mut results,
      remaining: max_per_file,
      max_columns,
      cancel: None,
    };
    if searcher.search_path(&matcher, &path, &mut sink).is_err() {
      // I/O on one file shouldn't abort the whole search. Skip and move on.
      continue;
    }
  }

  Ok(results)
}

fn build_search(opts: &SearchContentOptions) -> Result<(grep_regex::RegexMatcher, Searcher)> {
  let mut mb = RegexMatcherBuilder::new();
  mb.case_insensitive(opts.case_insensitive.unwrap_or(false));
  mb.fixed_strings(opts.literal.unwrap_or(false));
  if opts.multiline_dotall.unwrap_or(false) {
    mb.multi_line(true);
    mb.dot_matches_new_line(true);
  }
  let matcher = mb
    .build(&opts.pattern)
    .map_err(|e| Error::from_reason(e.to_string()))?;

  let mut sb = SearcherBuilder::new();
  sb.line_number(true);
  if opts.multiline_dotall.unwrap_or(false) {
    sb.multi_line(true);
    // grep-searcher forces before/after_context to 0 in multi-line mode
    // (see Config: multi_line disables context). Don't fight it — context
    // + multiline is a combination rg itself doesn't support either.
  } else {
    // Context lines (-A/-B/-C). Only meaningful in single-line mode.
    if let Some(b) = opts.before_context {
      sb.before_context(b as usize);
    }
    if let Some(a) = opts.after_context {
      sb.after_context(a as usize);
    }
  }
  let searcher = sb.build();

  Ok((matcher, searcher))
}

fn walk_opts_from_search(opts: &SearchContentOptions) -> FindFilesOptions {
  FindFilesOptions {
    root: opts.root.clone(),
    globs: opts.globs.clone(),
    file_types: opts.file_types.clone(),
    hidden: opts.hidden,
    no_ignore: opts.no_ignore,
    follow: None,
    max_depth: None,
    sort_modified: None,
  }
}

/// Sink that collects matches into a Vec. One instance per file.
struct CollectingSink<'a> {
  path: &'a str,
  out: &'a mut Vec<ContentMatch>,
  remaining: u32,
  max_columns: u32,
  cancel: Option<&'a Arc<AtomicBool>>,
}

impl<'a> Sink for CollectingSink<'a> {
  type Error = std::io::Error;

  fn matched(&mut self, _: &Searcher, mat: &SinkMatch<'_>) -> std::result::Result<bool, std::io::Error> {
    if let Some(c) = self.cancel {
      if c.load(Ordering::Relaxed) {
        return Ok(false);
      }
    }
    if self.remaining == 0 {
      return Ok(false);
    }
    let line = std::str::from_utf8(mat.bytes()).unwrap_or("").trim_end_matches('\n');
    let line_number = mat.line_number().map(|n| n as u32);
    if line.len() as u32 > self.max_columns {
      // ripgrep --max-columns suppresses the long line's CONTENT but the
      // file is still a match: `rg -l` lists it, `rg -c` counts it. Emit a
      // membership marker with empty content + column_truncated=true so
      // files-with-matches / count callers see the file. Content-mode
      // callers drop these (see ripgrep.ts).
      self.out.push(ContentMatch {
        path: self.path.to_owned(),
        line_number,
        content: String::new(),
        column_truncated: true,
        is_context: false,
      });
    } else {
      self.out.push(ContentMatch {
        path: self.path.to_owned(),
        line_number,
        content: line.to_owned(),
        column_truncated: false,
        is_context: false,
      });
    }
    self.remaining = self.remaining.saturating_sub(1);
    // When -m caps matches, keep going only if there's budget left. But
    // grep-searcher still emits this match's trailing after-context lines
    // via context() even after we stop matching — returning false here
    // would cut them off, so only stop once remaining hits 0 AND there is
    // no after-context to flush. Simplest correct behavior: keep returning
    // true while remaining>0; the searcher itself stops at EOF. GrepTool
    // never sets -m alongside -A/-B, so the cap+context combo is academic.
    Ok(self.remaining > 0)
  }

  fn context(&mut self, _: &Searcher, ctx: &grep_searcher::SinkContext<'_>) -> std::result::Result<bool, std::io::Error> {
    if let Some(c) = self.cancel {
      if c.load(Ordering::Relaxed) {
        return Ok(false);
      }
    }
    // Context lines (-A/-B/-C). Emitted with is_context=true so the JS
    // formatter renders them with rg's `-` separator and `-l`/`-c` skip
    // them. They do NOT consume the per-file match budget (`remaining`).
    let line = std::str::from_utf8(ctx.bytes()).unwrap_or("").trim_end_matches('\n');
    let line_number = ctx.line_number().map(|n| n as u32);
    let truncated = line.len() as u32 > self.max_columns;
    self.out.push(ContentMatch {
      path: self.path.to_owned(),
      line_number,
      content: if truncated { String::new() } else { line.to_owned() },
      column_truncated: truncated,
      is_context: true,
    });
    Ok(true)
  }

  fn context_break(&mut self, _: &Searcher) -> std::result::Result<bool, std::io::Error> {
    // rg prints a `--` separator between non-contiguous context groups
    // (only when before/after_context > 0). Emit a sentinel the JS side
    // renders as a bare `--`: line_number=None, content="--", is_context.
    // It carries the file's path so single-file callers stay consistent,
    // but the content-mode formatter special-cases it to a bare `--`.
    self.out.push(ContentMatch {
      path: self.path.to_owned(),
      line_number: None,
      content: "--".to_owned(),
      column_truncated: false,
      is_context: true,
    });
    Ok(true)
  }
}

// ---------------------------------------------------------------------------
// Streaming search (for GlobalSearchDialog)
// ---------------------------------------------------------------------------

/// Streaming callback receives one match at a time, formatted as the
/// classic ripgrep `path:line:content` line — the format ccb's
/// GlobalSearchDialog already parses. Sending pre-formatted strings
/// (rather than a struct) keeps the napi-rs ThreadsafeFunction signature
/// trivial: no need for a `JsValuesTupleIntoVec` impl on a custom
/// `#[napi(object)]`.
#[napi(catch_unwind)]
pub fn search_stream(
  opts: SearchContentOptions,
  on_match: ThreadsafeFunction<String>,
  on_done: ThreadsafeFunction<()>,
) -> Result<CancelHandle> {
  let (handle, flag) = CancelHandle::new();

  std::thread::spawn(move || {
    if let Err(e) = stream_inner(&opts, &flag, &on_match) {
      // Non-fatal — log via on_done's error path is awkward; just emit
      // done. JS can race onMatch invocations against onDone for liveness.
      let _ = e;
    }
    let _ = on_done.call(Ok(()), ThreadsafeFunctionCallMode::NonBlocking);
  });

  Ok(handle)
}

fn stream_inner(
  opts: &SearchContentOptions,
  cancel: &Arc<AtomicBool>,
  on_match: &ThreadsafeFunction<String>,
) -> Result<()> {
  let (matcher, mut searcher) = build_search(opts)?;
  let walk_opts = walk_opts_from_search(opts);

  // For streaming, we don't pre-collect paths. We walk and emit per match.
  // We DO honor the cancel flag both at walker level and sink level. The
  // walker itself applies the override globs + type filter (same builder
  // as the buffered path), so no per-entry glob matching here either.
  let builder = build_walk_builder(
    &walk_opts.root,
    walk_opts.globs.as_deref(),
    walk_opts.file_types.as_deref(),
    walk_opts.hidden.unwrap_or(false),
    walk_opts.no_ignore.unwrap_or(false),
    false,
    None,
  )?;
  let walk = builder.build();

  let max_per_file = opts.max_count_per_file.unwrap_or(u32::MAX);
  let max_columns = opts.max_columns.unwrap_or(u32::MAX);
  let entries_seen = AtomicUsize::new(0);

  for entry in walk {
    if entries_seen.fetch_add(1, Ordering::Relaxed) % 100 == 0
      && cancel.load(Ordering::Relaxed)
    {
      return Ok(());
    }
    let entry: DirEntry = match entry {
      Ok(e) => e,
      Err(_) => continue,
    };
    if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
      continue;
    }
    let path = entry.path();
    let path_str = match path.to_str() {
      Some(s) => s.to_owned(),
      None => continue,
    };

    let mut sink = StreamingSink {
      path: &path_str,
      callback: on_match,
      remaining: max_per_file,
      max_columns,
      cancel: Some(cancel),
    };
    let _ = searcher.search_path(&matcher, path, &mut sink);
    if cancel.load(Ordering::Relaxed) {
      return Ok(());
    }
  }
  Ok(())
}

struct StreamingSink<'a> {
  path: &'a str,
  callback: &'a ThreadsafeFunction<String>,
  remaining: u32,
  max_columns: u32,
  cancel: Option<&'a Arc<AtomicBool>>,
}

impl<'a> Sink for StreamingSink<'a> {
  type Error = std::io::Error;

  fn matched(&mut self, _: &Searcher, mat: &SinkMatch<'_>) -> std::result::Result<bool, std::io::Error> {
    if let Some(c) = self.cancel {
      if c.load(Ordering::Relaxed) {
        return Ok(false);
      }
    }
    if self.remaining == 0 {
      return Ok(false);
    }
    let line = std::str::from_utf8(mat.bytes()).unwrap_or("").trim_end_matches('\n');
    // Streaming feeds GlobalSearchDialog, which renders the line content.
    // An over-max_columns line is dropped entirely (not emitted as an
    // empty stub) — there's no -l semantics to preserve here, and a blank
    // line in the picker is noise.
    if line.len() as u32 > self.max_columns {
      return Ok(true);
    }
    let line_no = mat.line_number().map(|n| n as u32).unwrap_or(0);
    let formatted = format!("{}:{}:{}", self.path, line_no, line);
    let _ = self.callback.call(Ok(formatted), ThreadsafeFunctionCallMode::NonBlocking);
    self.remaining = self.remaining.saturating_sub(1);
    Ok(self.remaining > 0)
  }
}
