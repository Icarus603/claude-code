//! ripgrep-napi — in-process ripgrep for ccb.
//!
//! Three public surfaces, called from JS via napi-rs:
//!
//!   findFiles(opts)       -> string[]      (file enumeration; no content read)
//!   searchContent(opts)   -> Match[]       (buffered regex search)
//!   searchStream(opts, cb) -> CancelHandle (streaming regex search)
//!
//! Everything else (count helpers, etc.) is JS-side syntactic sugar over
//! these three. Cancellation is uniform: every entry point that walks the
//! filesystem returns a CancelHandle (or a synchronous Result for buffered
//! calls that take an injected handle); flipping the flag aborts at the
//! next walker step or sink callback. There is no abort-via-timeout —
//! the JS wrapper races a setTimeout against the cancel handle.
//!
//! No "spawn" mode, no "embedded" mode, no path-mode dispatch: this is
//! just a function call. Sandbox-on-Linux still needs an rg binary path
//! because @anthropic-ai/sandbox-runtime invokes rg as an external
//! enforcement helper — that path lives in ccb's sandbox-adapter, not
//! here.

#![deny(clippy::unwrap_used, clippy::expect_used)]

use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;

use globset::{Glob, GlobSet, GlobSetBuilder};
use grep_regex::RegexMatcherBuilder;
use grep_searcher::{Searcher, SearcherBuilder, Sink, SinkMatch};
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
  /// Same shape ripgrep accepts via `--glob`.
  pub globs: Option<Vec<String>>,
  pub hidden: Option<bool>,
  pub no_ignore: Option<bool>,
  pub follow: Option<bool>,
  pub max_depth: Option<u32>,
  /// Sort the result by file mtime descending. Costs a syscall per entry
  /// (stat) and an O(n log n) sort, so callers leave it off by default.
  pub sort_modified: Option<bool>,
}

#[napi(catch_unwind)]
pub fn find_files(opts: FindFilesOptions) -> Result<Vec<String>> {
  let (results, _cancelled) = walk(&opts, None)?;
  Ok(results)
}

#[napi(catch_unwind)]
pub fn count_files(opts: FindFilesOptions) -> Result<u32> {
  let (results, _cancelled) = walk(&opts, None)?;
  Ok(results.len() as u32)
}

/// Internal: shared walker for find/count. Optional cancel flag for the
/// streaming path to short-circuit.
fn walk(
  opts: &FindFilesOptions,
  cancel: Option<&Arc<AtomicBool>>,
) -> Result<(Vec<String>, bool)> {
  let glob_set = build_globset(opts.globs.as_deref())?;
  let exclude_set = build_globset_excludes(opts.globs.as_deref())?;

  let mut builder = WalkBuilder::new(&opts.root);

  // standard_filters(false) is a sledgehammer: it disables hidden,
  // parents, ignore, git_ignore, git_global, git_exclude all at once.
  // ripgrep's actual semantics differ: --no-ignore turns off the
  // ignore-file family but leaves hidden-file filtering intact.
  // Apply standard_filters first, then re-apply hidden() so it wins.
  if opts.no_ignore.unwrap_or(false) {
    builder.standard_filters(false);
  }
  // ignore::WalkBuilder::hidden(yes) means "filter hidden files when yes
  // is true". Inverted from the CLI flag's --hidden (which makes them
  // visible). Default: skip hidden files.
  builder.hidden(!opts.hidden.unwrap_or(false));
  builder.follow_links(opts.follow.unwrap_or(false));
  if let Some(d) = opts.max_depth {
    builder.max_depth(Some(d as usize));
  }

  let walk = builder.build();

  let mut out: Vec<String> = Vec::new();
  let mut entries_seen: usize = 0;
  let cancelled = AtomicBool::new(false);
  let root_path = std::path::Path::new(&opts.root);

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

    if !entry.file_type().map(|t| t.is_file()).unwrap_or(false) {
      continue;
    }

    let path = entry.path();

    // Glob filter: include set must match (when non-empty), exclude set
    // must not. Order matters because exclude wins on overlap. Glob
    // patterns are matched against the path RELATIVE to the search
    // root — same as ripgrep's `--glob` semantics. Without this,
    // patterns like `sub/**` never match because the walker hands us
    // absolute paths like /tmp/abc/sub/b.ts and globset expects the
    // relative segment.
    let rel = path.strip_prefix(root_path).unwrap_or(path);
    if let Some(ref ex) = exclude_set {
      if ex.is_match(rel) {
        continue;
      }
    }
    if let Some(ref inc) = glob_set {
      if !inc.is_match(rel) {
        continue;
      }
    }

    if let Some(s) = path.to_str() {
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

fn build_globset(globs: Option<&[String]>) -> Result<Option<GlobSet>> {
  let Some(globs) = globs else {
    return Ok(None);
  };
  let mut b = GlobSetBuilder::new();
  let mut have_includes = false;
  for g in globs {
    if g.starts_with('!') {
      continue;
    }
    have_includes = true;
    let glob = Glob::new(g).map_err(|e| Error::from_reason(e.to_string()))?;
    b.add(glob);
  }
  if !have_includes {
    return Ok(None);
  }
  let set = b.build().map_err(|e| Error::from_reason(e.to_string()))?;
  Ok(Some(set))
}

fn build_globset_excludes(globs: Option<&[String]>) -> Result<Option<GlobSet>> {
  let Some(globs) = globs else {
    return Ok(None);
  };
  let mut b = GlobSetBuilder::new();
  let mut have_excludes = false;
  for g in globs {
    let Some(stripped) = g.strip_prefix('!') else {
      continue;
    };
    have_excludes = true;
    let glob = Glob::new(stripped).map_err(|e| Error::from_reason(e.to_string()))?;
    b.add(glob);
  }
  if !have_excludes {
    return Ok(None);
  }
  let set = b.build().map_err(|e| Error::from_reason(e.to_string()))?;
  Ok(Some(set))
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
  /// `--max-columns`: drop matches in lines longer than this.
  pub max_columns: Option<u32>,
  /// `-m`: stop after this many matches per file.
  pub max_count_per_file: Option<u32>,
  /// File-level filters (same shape as findFiles).
  pub globs: Option<Vec<String>>,
  pub hidden: Option<bool>,
  pub no_ignore: Option<bool>,
}

#[napi(object)]
#[derive(Clone)]
pub struct ContentMatch {
  pub path: String,
  pub line_number: Option<u32>,
  pub content: String,
}

#[napi(catch_unwind)]
pub fn search_content(opts: SearchContentOptions) -> Result<Vec<ContentMatch>> {
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
    if let Err(_) = searcher.search_path(&matcher, &path, &mut sink) {
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
  }
  let searcher = sb.build();

  Ok((matcher, searcher))
}

fn walk_opts_from_search(opts: &SearchContentOptions) -> FindFilesOptions {
  FindFilesOptions {
    root: opts.root.clone(),
    globs: opts.globs.clone(),
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
    if line.len() as u32 > self.max_columns {
      // ripgrep --max-columns drops long lines silently. Same here.
      return Ok(true);
    }
    self.out.push(ContentMatch {
      path: self.path.to_owned(),
      line_number: mat.line_number().map(|n| n as u32),
      content: line.to_owned(),
    });
    self.remaining = self.remaining.saturating_sub(1);
    Ok(self.remaining > 0)
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
  // We DO honor the cancel flag both at walker level and sink level.
  let glob_set = build_globset(walk_opts.globs.as_deref())?;
  let exclude_set = build_globset_excludes(walk_opts.globs.as_deref())?;

  let mut builder = WalkBuilder::new(&walk_opts.root);
  // Same ordering rule as walk(): standard_filters(false) first, then
  // hidden() to re-apply hidden filtering. See comment at the matching
  // section above.
  if walk_opts.no_ignore.unwrap_or(false) {
    builder.standard_filters(false);
  }
  builder.hidden(!walk_opts.hidden.unwrap_or(false));
  let walk = builder.build();

  let max_per_file = opts.max_count_per_file.unwrap_or(u32::MAX);
  let max_columns = opts.max_columns.unwrap_or(u32::MAX);
  let entries_seen = AtomicUsize::new(0);
  let root_path = std::path::Path::new(&walk_opts.root);

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
    let rel = path.strip_prefix(root_path).unwrap_or(path);
    if let Some(ref ex) = exclude_set {
      if ex.is_match(rel) {
        continue;
      }
    }
    if let Some(ref inc) = glob_set {
      if !inc.is_match(rel) {
        continue;
      }
    }
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
