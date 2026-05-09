#!/usr/bin/env node
/**
 * diff-versions.mjs — Cross-version diffing for Bun-compiled bundles
 *
 * Compares two extracted versions by matching modules across builds
 * and normalizing Bun's non-deterministic identifiers before diffing.
 *
 * Algorithm:
 *   Phase 1: Ensure resplit output exists (auto-run resplit.mjs if missing)
 *   Phase 2: Load manifests & fingerprint all app modules (strings + properties + exports)
 *   Phase 3: Match modules across versions (export match → fingerprint similarity → structural)
 *   Phase 4: Normalize identifiers & diff matched pairs
 *   Phase 5: Generate JSON report + optional human-readable changelog
 *
 * Usage:
 *   node diff-versions.mjs <version-a> <version-b> [options]
 *
 *   version-a/b    Path or shorthand (e.g., v2.1.58 → auto-resolves versions/*_v2.1.58/)
 *
 * Options:
 *   --out <path>        JSON report output (default: stdout)
 *   --changelog         Print human-readable changelog to stderr
 *   --threshold <n>     Min match score (default: 0.3)
 *   --include-vendor    Also diff vendor modules (default: skip)
 *   --show-diff         Include full normalized diff text in JSON
 *   --stats             Print summary stats to stderr
 *   --dry-run           Only fingerprint and match, skip diffing
 *   -h, --help          Show help
 */

import fs from "fs";

/** Find the largest .js file in a directory (the main bundle) */
function findLargestBundle(dir) {
  if (!fs.existsSync(dir)) return null;
  let best = null, bestSize = 0;
  for (const f of fs.readdirSync(dir)) {
    if (!f.endsWith(".js")) continue;
    const full = path.join(dir, f);
    const size = fs.statSync(full).size;
    if (size > bestSize) { best = full; bestSize = size; }
  }
  return best;
}
import path from "path";
import { execFileSync, execSync } from "child_process";
import os from "os";

const __dirname = path.dirname(new URL(import.meta.url).pathname);
const VERSIONS_DIR = path.join(__dirname, "versions");

// ─── Common properties to exclude (too ubiquitous for fingerprinting) ────────

const COMMON_PROPS = new Set([
  "prototype", "exports", "default", "length", "push", "call", "apply",
  "bind", "toString", "valueOf", "constructor", "name", "value", "type",
  "key", "error", "message", "data", "then", "catch", "resolve", "reject",
  "get", "set", "has", "delete", "forEach", "map", "filter", "reduce",
  "indexOf", "slice", "join", "split", "replace", "test", "match",
  "create", "assign", "keys", "values", "entries", "from", "log", "warn",
  "start", "end", "index", "result", "options", "config", "state", "code",
  "path", "url", "emit", "write", "read", "close", "open", "next", "done",
  "add", "remove", "on", "off", "once", "size", "id", "src", "run",
  "undefined", "null", "true", "false", "module", "require", "define",
  "return", "throw", "new", "this", "self", "args", "callback", "fn",
  "err", "res", "req", "buf", "str", "obj", "val", "ret", "tmp", "ref",
  "node", "parent", "child", "children", "left", "right", "body", "init",
]);

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.error(`Usage: node diff-versions.mjs <version-a> <version-b> [options]

Arguments:
  version-a/b    Path or shorthand (e.g., v2.1.58, 2.1.58)

Options:
  --out <path>        JSON report output (default: stdout)
  --changelog         Print human-readable changelog to stderr
  --threshold <n>     Min match score (default: 0.3)
  --include-vendor    Also diff vendor modules (default: skip)
  --show-diff         Include full normalized diff text in JSON
  --stats             Print summary stats to stderr
  --dry-run           Only fingerprint and match, skip diffing
  -h, --help          Show help`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    versionA: null,
    versionB: null,
    out: null,
    changelog: false,
    threshold: 0.3,
    includeVendor: false,
    showDiff: false,
    stats: false,
    dryRun: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
    else if (a === "--out") opts.out = args[++i];
    else if (a === "--changelog") opts.changelog = true;
    else if (a === "--threshold") opts.threshold = parseFloat(args[++i]);
    else if (a === "--include-vendor") opts.includeVendor = true;
    else if (a === "--show-diff") opts.showDiff = true;
    else if (a === "--stats") opts.stats = true;
    else if (a === "--dry-run") opts.dryRun = true;
    else if (!opts.versionA) opts.versionA = a;
    else if (!opts.versionB) opts.versionB = a;
  }

  if (!opts.versionA || !opts.versionB) {
    console.error("Error: two version arguments required");
    printHelp();
    process.exit(1);
  }

  return opts;
}

// ─── Version resolution ──────────────────────────────────────────────────────

function resolveVersionDir(name) {
  // If it's already an absolute path, use directly
  if (path.isAbsolute(name) && fs.existsSync(name)) return name;

  // Strip leading "v" if present
  const ver = name.replace(/^v/, "");

  // Search versions dir for matching folder
  const dirs = fs.readdirSync(VERSIONS_DIR).filter(d => d.includes("_v")).sort();
  const match = dirs.find(d => d.includes(`_v${ver}`));
  if (match) return path.join(VERSIONS_DIR, match);

  // Try as relative path
  const resolved = path.resolve(name);
  if (fs.existsSync(resolved)) return resolved;

  console.error(`Error: cannot resolve version "${name}"`);
  console.error(`Available versions: ${dirs.map(d => d.replace(/.*_v/, "")).join(", ")}`);
  process.exit(1);
}

function extractVersionNumber(versionDir) {
  const base = path.basename(versionDir);
  const m = base.match(/_v([\d.]+)/);
  return m ? m[1] : base;
}

// ─── Phase 1: Ensure resplit ─────────────────────────────────────────────────

function ensureResplit(versionDir) {
  const resplitDir = path.join(versionDir, "resplit");
  const manifestPath = path.join(resplitDir, "manifest.json");

  if (fs.existsSync(manifestPath)) {
    return resplitDir;
  }

  // Find the extracted bundle (largest .js file in extracted/)
  const extractedDir = path.join(versionDir, "extracted");
  const bundlePath = findLargestBundle(extractedDir);
  if (!bundlePath) {
    console.error(`Error: no resplit and no extracted bundle in ${extractedDir}`);
    process.exit(1);
  }

  console.error(`Resplitting ${path.basename(versionDir)}...`);
  const resplitScript = path.join(__dirname, "resplit.mjs");
  execSync(`node ${resplitScript} "${bundlePath}" "${resplitDir}"`, {
    stdio: ["pipe", "pipe", "inherit"],
  });
  console.error(`  Done.`);

  return resplitDir;
}

// ─── Phase 2: Load & fingerprint modules ─────────────────────────────────────

function extractFingerprint(code) {
  const strings = new Set();
  const properties = new Set();

  // Extract quoted strings ≥5 chars
  for (const m of code.matchAll(/"([^"\\]{5,})"/g)) strings.add(m[1]);
  for (const m of code.matchAll(/'([^'\\]{5,})'/g)) strings.add(m[1]);

  // Extract property access: .propName
  for (const m of code.matchAll(/\.([a-zA-Z_$][a-zA-Z0-9_$]{2,})/g)) {
    if (!COMMON_PROPS.has(m[1])) properties.add(m[1]);
  }

  // Extract object keys: { keyName: or keyName(
  for (const m of code.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]{2,})\s*[:(]/g)) {
    if (!COMMON_PROPS.has(m[1])) properties.add(m[1]);
  }

  return { strings, properties };
}

function loadVersion(versionDir, resplitDir, includeVendor) {
  const manifestPath = path.join(resplitDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));

  const modules = new Map(); // name → { name, file, type, exports, vendor, size, deps, strings, properties }
  let totalModules = 0;
  let appModules = 0;

  for (const [name, meta] of Object.entries(manifest.modules)) {
    totalModules++;
    if (meta.vendor && !includeVendor) continue;
    if (!meta.vendor) appModules++;

    const filePath = path.join(resplitDir, meta.file);
    if (!fs.existsSync(filePath)) continue;

    const source = fs.readFileSync(filePath, "utf8");
    const fp = extractFingerprint(source);
    const exportSet = new Set((meta.exports || []).filter(e => e && e.length > 0));

    modules.set(name, {
      name,
      file: meta.file,
      type: meta.type,
      exports: exportSet,
      vendor: !!meta.vendor,
      size: meta.size || source.length,
      deps: meta.deps || [],
      depCount: (meta.deps || []).length,
      strings: fp.strings,
      properties: fp.properties,
      source, // keep for diffing
    });
  }

  return {
    version: extractVersionNumber(versionDir),
    versionDir,
    resplitDir,
    manifest,
    modules,
    totalModules,
    appModules: includeVendor ? totalModules : appModules,
  };
}

// ─── Phase 3: Match modules across versions ──────────────────────────────────

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) {
    if (setB.has(item)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function matchModules(verA, verB, threshold) {
  const matched = [];      // { idA, idB, score, method }
  const unmatchedA = new Set(verA.modules.keys());
  const unmatchedB = new Set(verB.modules.keys());

  // --- Pass 1: Exact export set match ---
  const exportIndexB = new Map(); // exportKey → moduleId
  for (const [id, mod] of verB.modules) {
    if (mod.exports.size > 0) {
      const key = [...mod.exports].sort().join("\0");
      // Only use if unique in B
      if (exportIndexB.has(key)) {
        exportIndexB.set(key, null); // mark as ambiguous
      } else {
        exportIndexB.set(key, id);
      }
    }
  }

  for (const [idA, modA] of verA.modules) {
    if (modA.exports.size === 0) continue;
    const key = [...modA.exports].sort().join("\0");
    const idB = exportIndexB.get(key);
    if (idB && unmatchedB.has(idB)) {
      matched.push({ idA, idB, score: 1.0, method: "export" });
      unmatchedA.delete(idA);
      unmatchedB.delete(idB);
    }
  }

  const exportMatches = matched.length;

  // --- Pass 2: Fingerprint similarity with inverted index ---
  // Build inverted indices for B (strings + properties)
  const stringIndex = new Map(); // string → Set<moduleId>
  const propIndex = new Map();   // property → Set<moduleId>
  for (const idB of unmatchedB) {
    const mod = verB.modules.get(idB);
    for (const s of mod.strings) {
      if (!stringIndex.has(s)) stringIndex.set(s, new Set());
      stringIndex.get(s).add(idB);
    }
    for (const p of mod.properties) {
      if (!propIndex.has(p)) propIndex.set(p, new Set());
      propIndex.get(p).add(idB);
    }
  }

  // Score candidates
  const candidates = []; // { idA, idB, score }
  for (const idA of unmatchedA) {
    const modA = verA.modules.get(idA);
    if (modA.strings.size === 0 && modA.properties.size === 0) continue;

    // Collect candidate IDs from inverted indices (strings + properties)
    const candidateIds = new Set();
    for (const s of modA.strings) {
      const ids = stringIndex.get(s);
      if (ids) for (const id of ids) candidateIds.add(id);
    }
    // Also check properties for modules with few/no strings
    if (modA.strings.size < 3) {
      for (const p of modA.properties) {
        const ids = propIndex.get(p);
        if (ids) for (const id of ids) candidateIds.add(id);
      }
    }

    for (const idB of candidateIds) {
      if (!unmatchedB.has(idB)) continue;
      const modB = verB.modules.get(idB);

      const stringScore = jaccard(modA.strings, modB.strings);
      const propScore = jaccard(modA.properties, modB.properties);
      const sizeRatio = Math.min(modA.size, modB.size) / Math.max(modA.size, modB.size);

      // Weight depends on what features are available
      let score;
      if (modA.strings.size >= 3 && modB.strings.size >= 3) {
        score = 0.6 * stringScore + 0.3 * propScore + 0.1 * sizeRatio;
      } else if (modA.properties.size >= 3 && modB.properties.size >= 3) {
        // Property-heavy matching for modules with few strings
        score = 0.2 * stringScore + 0.6 * propScore + 0.2 * sizeRatio;
      } else {
        score = 0.4 * stringScore + 0.4 * propScore + 0.2 * sizeRatio;
      }

      if (score >= threshold) {
        candidates.push({ idA, idB, score });
      }
    }
  }

  // Greedy best-match assignment
  candidates.sort((a, b) => b.score - a.score);
  for (const { idA, idB, score } of candidates) {
    if (!unmatchedA.has(idA) || !unmatchedB.has(idB)) continue;
    matched.push({ idA, idB, score, method: "fingerprint" });
    unmatchedA.delete(idA);
    unmatchedB.delete(idB);
  }

  const fingerprintMatches = matched.length - exportMatches;

  // --- Pass 3: Dep-topology matching ---
  // If all of a module's deps have been matched, use the matched dep set as a fingerprint
  let depTopoMatches = 0;
  let changed = true;
  while (changed) {
    changed = false;
    // Build index: sorted matched-dep-set → unmatched B module
    const matchAtoB = new Map();
    for (const { idA, idB } of matched) matchAtoB.set(idA, idB);

    const depKeyIndex = new Map(); // depKey → [moduleId]
    for (const idB of unmatchedB) {
      const mod = verB.modules.get(idB);
      if (mod.deps.length === 0) continue;
      // Check if all deps of B are matched (i.e., have a counterpart in A)
      const matchBtoA = new Map();
      for (const { idA, idB: iB } of matched) matchBtoA.set(iB, idA);

      const mappedDeps = mod.deps.map(d => matchBtoA.get(d)).filter(Boolean);
      if (mappedDeps.length === 0) continue;
      if (mappedDeps.length < mod.deps.length * 0.5) continue; // need at least half deps matched

      const key = `${mod.type}:${mappedDeps.sort().join(",")}`;
      if (!depKeyIndex.has(key)) depKeyIndex.set(key, []);
      depKeyIndex.get(key).push(idB);
    }

    for (const idA of [...unmatchedA]) {
      const modA = verA.modules.get(idA);
      if (modA.deps.length === 0) continue;

      const mappedDeps = modA.deps.map(d => matchAtoB.get(d)).filter(Boolean);
      if (mappedDeps.length === 0) continue;
      if (mappedDeps.length < modA.deps.length * 0.5) continue;

      // Reconstruct key using B's dep names (the mapped deps ARE B dep names via matchAtoB)
      // But we need A's deps mapped through matchAtoB, which gives us B dep names
      // The depKeyIndex was built with B's deps mapped through matchBtoA (giving A dep names)
      // So we need to use A dep names for the key
      const aDepNames = modA.deps.filter(d => matchAtoB.has(d));
      if (aDepNames.length === 0) continue;

      const key = `${modA.type}:${aDepNames.sort().join(",")}`;
      const bucket = depKeyIndex.get(key);
      if (!bucket) continue;

      // Find best size match among candidates
      let bestId = null, bestRatio = 0;
      for (const idB of bucket) {
        if (!unmatchedB.has(idB)) continue;
        const modB = verB.modules.get(idB);
        const ratio = Math.min(modA.size, modB.size) / Math.max(modA.size, modB.size);
        if (ratio > bestRatio) { bestRatio = ratio; bestId = idB; }
      }

      if (bestId && bestRatio >= 0.5) {
        matched.push({ idA, idB: bestId, score: 0.7 * bestRatio, method: "dep-topology" });
        unmatchedA.delete(idA);
        unmatchedB.delete(bestId);
        depTopoMatches++;
        changed = true;
      }
    }
  }

  // --- Pass 4: Structural fallback for tiny modules ---
  const tinyB = new Map(); // "type:depCount" → [moduleId]
  for (const idB of unmatchedB) {
    const mod = verB.modules.get(idB);
    const key = `${mod.type}:${mod.depCount}`;
    if (!tinyB.has(key)) tinyB.set(key, []);
    tinyB.get(key).push(idB);
  }

  const structuralCandidates = [];
  for (const idA of unmatchedA) {
    const modA = verA.modules.get(idA);
    const key = `${modA.type}:${modA.depCount}`;
    const bucket = tinyB.get(key);
    if (!bucket) continue;

    for (const idB of bucket) {
      if (!unmatchedB.has(idB)) continue;
      const modB = verB.modules.get(idB);
      const sizeRatio = Math.min(modA.size, modB.size) / Math.max(modA.size, modB.size);
      if (sizeRatio >= 0.9) {
        structuralCandidates.push({ idA, idB, score: sizeRatio * 0.4, sizeRatio });
      }
    }
  }

  structuralCandidates.sort((a, b) => b.score - a.score);
  for (const { idA, idB, score } of structuralCandidates) {
    if (!unmatchedA.has(idA) || !unmatchedB.has(idB)) continue;
    matched.push({ idA, idB, score, method: "structural" });
    unmatchedA.delete(idA);
    unmatchedB.delete(idB);
  }

  const structuralMatches = matched.length - exportMatches - fingerprintMatches - depTopoMatches;

  return {
    matched,
    unmatchedA: [...unmatchedA],
    unmatchedB: [...unmatchedB],
    stats: { exportMatches, fingerprintMatches, depTopoMatches, structuralMatches },
  };
}

// ─── Phase 4: Normalize & diff ───────────────────────────────────────────────

/**
 * Detect preamble function names from the bundle's runtime section.
 * These helpers have stable structure but different names across builds:
 *   - cjsFactory: y = (T, R) => () => (R || T(...), R.exports)   — always 'y'?
 *   - esmLazy:    Q/h = (T, R) => () => (T && (R = T(T=0)), R)
 *   - interop:    x/v = (T, R, A) => { ... __esModule ... }
 *   - esmInterop: sI/OW = (T) => { ... __esModule ... }
 *   - exportReg:  gR/MR = (T, R) => { ... defineProperty ... configurable ... set ... }
 *   - reExport:   R9 = (T, R, A) => { ... "default" ... }
 */
function detectPreamble(resplitDir) {
  const runtimePath = path.join(resplitDir, "00-runtime.js");
  if (!fs.existsSync(runtimePath)) return {};

  const src = fs.readFileSync(runtimePath, "utf8").slice(0, 4000);
  const preamble = {};

  // Note: preamble functions may be declared with `var NAME=` or `,NAME=` (comma-separated)
  const decl = `(?:var\\s+|,\\s*)`;

  // CJS factory: y = (T, R) => () => (R || T(
  {
    const m = src.match(new RegExp(decl + `([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R\\)\\s*=>\\s*\\(\\)\\s*=>\\s*\\(R\\s*\\|\\|\\s*T\\s*\\(`));
    if (m) preamble.cjsFactory = m[1];
  }

  // ESM lazy: Q = (T, R) => () => (T && (R = T(T=0)), R)
  {
    const m = src.match(new RegExp(decl + `([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R\\)\\s*=>\\s*\\(\\)\\s*=>\\s*\\(T\\s*&&\\s*\\(R\\s*=\\s*T\\(T\\s*=\\s*0\\)\\)`));
    if (m) preamble.esmLazy = m[1];
  }

  // Export register: gR = (T, R) => { for (var A in R) ...configurable
  {
    const m = src.match(new RegExp(decl + `([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R\\)\\s*=>\\s*\\{\\s*for\\s*\\(var\\s+A\\s+in\\s+R\\)[^}]*configurable`));
    if (m) preamble.exportReg = m[1];
  }

  // Interop (3 params): x = (T, R, A) => { var _ = T!=null ...
  // Distinguished from reExport by first statement: `var _ = T != null`
  {
    const m = src.match(new RegExp(decl + `([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R,\\s*A\\)\\s*=>\\s*\\{var\\s+_\\s*=\\s*T\\s*!=\\s*null`));
    if (m) preamble.interop = m[1];
  }

  // ESM interop (1 param): sI = (T) => { var R = (...WeakMap)...
  // Distinguished by (T) => { ... __esModule
  {
    const m = src.match(new RegExp(decl + `([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T\\)\\s*=>\\s*\\{var\\s+R\\s*=`));
    if (m) preamble.esmInterop = m[1];
  }

  // Re-export: R9 = (T, R, A) => { var _ = ...getOwnPropertyNames (via local alias)
  // Distinguished from interop by: first statement accesses getOwnPropertyNames result
  {
    const m = src.match(new RegExp(decl + `([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R,\\s*A\\)\\s*=>\\s*\\{var\\s+_\\s*=\\s*[a-zA-Z_$]+\\(R\\)`));
    if (m) preamble.reExport = m[1];
  }

  return preamble;
}

/**
 * Build a mapping of dep variable names between two matched versions.
 * For each dep in A's module, find the corresponding dep in B via the match table.
 */
function buildDepMapping(modA, modB, matchLookup) {
  const mapping = new Map(); // A dep name → B dep name
  // Try to align deps by their matched counterpart
  for (const depA of modA.deps) {
    const matchedDepB = matchLookup.get(depA);
    if (matchedDepB) mapping.set(depA, matchedDepB);
  }
  return mapping;
}

// JS keywords and built-in names that should never be normalized
const JS_KEYWORDS = new Set([
  "var", "let", "const", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "try", "catch", "finally",
  "throw", "new", "delete", "typeof", "instanceof", "in", "of", "void",
  "this", "super", "class", "extends", "import", "export", "default", "from",
  "as", "async", "await", "yield", "static", "get", "set", "true", "false",
  "null", "undefined", "NaN", "Infinity", "arguments", "eval",
  // Common globals
  "console", "process", "require", "module", "exports", "global", "globalThis",
  "Object", "Array", "String", "Number", "Boolean", "Symbol", "BigInt",
  "Function", "Promise", "Error", "TypeError", "RangeError", "SyntaxError",
  "RegExp", "Date", "Map", "Set", "WeakMap", "WeakSet", "Proxy", "Reflect",
  "JSON", "Math", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI",
  "decodeURI", "encodeURIComponent", "decodeURIComponent", "escape", "unescape",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "setImmediate",
  "Buffer", "URL", "URLSearchParams", "TextEncoder", "TextDecoder",
  "AbortController", "AbortSignal", "fetch", "Response", "Request", "Headers",
  "Event", "EventTarget", "ReadableStream", "WritableStream", "TransformStream",
  "Uint8Array", "Int8Array", "Uint16Array", "Int16Array", "Uint32Array",
  "Int32Array", "Float32Array", "Float64Array", "ArrayBuffer", "DataView",
  "SharedArrayBuffer", "Atomics", "queueMicrotask", "structuredClone",
  "performance", "crypto", "btoa", "atob", "navigator", "window", "document",
]);

/**
 * Normalize a module's source for cross-version comparison.
 *
 * Strategy: replace ALL minified identifiers (module name, deps, preamble funcs,
 * AND local variables/functions) with positional tokens based on first-appearance
 * order. This handles Bun's non-deterministic identifier assignment.
 *
 * Identifiers inside strings and property accesses (.foo, {foo:) are preserved.
 */
function normalizeSource(source, moduleName, deps, preamble, matchAtoB) {
  // Strip the resplit header comment
  let code = source.replace(/^\/\/ resplit:.*\n/, "");

  // Build the set of known identifiers to normalize:
  // 1. Module's own name
  // 2. Dep names
  // 3. Preamble function names
  // 4. All other minified identifiers (detected by pattern)

  // Scan for all identifiers and record their first position.
  // We use a simple approach: find all word-boundary identifiers,
  // skip property accesses (preceded by .), and collect minified-looking names.
  // We intentionally don't skip strings/regex/comments because:
  // - String content is stable across versions (same identifiers inside)
  // - Trying to skip quotes fails on regex literals (/['"]/) confusing the tokenizer
  // - The diff compares normalized output of both versions, so symmetric treatment is correct
  const identifiers = new Map(); // name → first position

  const idRe = /(?<!\.)(?<![a-zA-Z0-9_$])([a-zA-Z_$][a-zA-Z0-9_$]*)(?![a-zA-Z0-9_$])/g;
  let m;
  while ((m = idRe.exec(code)) !== null) {
    const name = m[1];
    if (!JS_KEYWORDS.has(name) && isMinifiedName(name)) {
      if (!identifiers.has(name)) {
        identifiers.set(name, m.index + (m[0].length - name.length));
      }
    }
  }

  // Classify identifiers into categories for stable naming
  const depSet = new Set(deps);
  const preambleNameMap = new Map(); // name → stable alias
  const preambleAliases = {
    cjsFactory: "$CJS_FACTORY",
    esmLazy: "$ESM_LAZY",
    interop: "$INTEROP",
    esmInterop: "$ESM_INTEROP",
    exportReg: "$EXPORT_REG",
    reExport: "$RE_EXPORT",
  };

  // Add preamble names, module name, and dep names to identifiers if not already there
  // (they may be single-char names excluded by isMinifiedName)
  for (const [role, stableName] of Object.entries(preambleAliases)) {
    const actual = preamble[role];
    if (actual) {
      preambleNameMap.set(actual, stableName);
      if (!identifiers.has(actual)) {
        // Find first occurrence in code
        const idx = code.indexOf(actual);
        if (idx !== -1) identifiers.set(actual, idx);
      }
    }
  }
  if (moduleName && !identifiers.has(moduleName)) {
    const idx = code.indexOf(moduleName);
    if (idx !== -1) identifiers.set(moduleName, idx);
  }
  for (const dep of deps) {
    if (!identifiers.has(dep)) {
      const idx = code.indexOf(dep);
      if (idx !== -1) identifiers.set(dep, idx);
    }
  }

  // Sort all identifiers by first appearance
  const sorted = [...identifiers.entries()].sort((a, b) => a[1] - b[1]);

  // Assign stable names
  const nameMap = new Map(); // original → replacement
  let depIdx = 0;
  let localIdx = 0;

  for (const [name] of sorted) {
    if (name === moduleName) {
      nameMap.set(name, "$MOD");
    } else if (preambleNameMap.has(name)) {
      nameMap.set(name, preambleNameMap.get(name));
    } else if (depSet.has(name)) {
      nameMap.set(name, `$DEP_${depIdx++}`);
    } else {
      nameMap.set(name, `$L${localIdx++}`);
    }
  }

  if (nameMap.size === 0) return code;

  // Step 1: Extract quoted strings and replace with placeholders
  // This protects string content from identifier normalization
  const strings = [];
  const codeWithPlaceholders = code.replace(
    /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'/g,
    (match) => {
      const idx = strings.length;
      strings.push(match);
      return `\x00STR${idx}\x00`;
    }
  );

  // Step 2: Normalize identifiers (not preceded by '.')
  const normalized = codeWithPlaceholders.replace(
    /(?<!\.)(?<![a-zA-Z0-9_$])([a-zA-Z_$][a-zA-Z0-9_$]*)(?![a-zA-Z0-9_$])/g,
    (match, name) => nameMap.get(name) || name
  );

  // Step 3: Restore strings
  const result = normalized.replace(/\x00STR(\d+)\x00/g, (_, idx) => strings[+idx]);

  return result;
}

/**
 * Check if a name looks like a Bun-minified identifier.
 * Bun generates names like: xR_, V__, l6R, TJ9, MR_, i$A, etc.
 * Also handles single-char locals (X, h, C, G, W) which change between builds.
 */
function isMinifiedName(name) {
  // Very long names (>6 chars) are likely meaningful, not minified
  if (name.length > 6) return false;

  // Names that are all uppercase and >3 chars are likely constants (e.g. TRUE, NODE)
  if (name.length > 3 && /^[A-Z_]+$/.test(name)) return false;

  return true;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Diff two normalized sources using the system diff command.
 * Returns { diffText, diffLines, changed }
 */
function diffSources(normalizedA, normalizedB, labelA, labelB) {
  const tmpDir = os.tmpdir();
  const fileA = path.join(tmpDir, `diff-a-${process.pid}.js`);
  const fileB = path.join(tmpDir, `diff-b-${process.pid}.js`);

  try {
    fs.writeFileSync(fileA, normalizedA);
    fs.writeFileSync(fileB, normalizedB);

    try {
      execFileSync("diff", ["-u", "--label", labelA, "--label", labelB, fileA, fileB]);
      // Exit 0 = identical
      return { diffText: "", diffLines: 0, changed: false };
    } catch (e) {
      if (e.status === 1) {
        // Exit 1 = differences found
        const diffText = e.stdout?.toString("utf8") || "";
        const diffLines = diffText.split("\n").filter(l => l.startsWith("+") || l.startsWith("-"))
          .filter(l => !l.startsWith("+++") && !l.startsWith("---")).length;
        return { diffText, diffLines, changed: true };
      }
      // Exit 2+ = error
      return { diffText: `diff error: ${e.message}`, diffLines: -1, changed: true };
    }
  } finally {
    try { fs.unlinkSync(fileA); } catch {}
    try { fs.unlinkSync(fileB); } catch {}
  }
}

// ─── Phase 5: Report ─────────────────────────────────────────────────────────

function generateReport(verA, verB, matchResult, diffResults, opts) {
  const report = {
    _meta: {
      tool: "diff-versions.mjs",
      generatedAt: new Date().toISOString(),
      versionA: {
        version: verA.version,
        dir: path.basename(verA.versionDir),
        totalModules: verA.totalModules,
        appModules: verA.appModules,
      },
      versionB: {
        version: verB.version,
        dir: path.basename(verB.versionDir),
        totalModules: verB.totalModules,
        appModules: verB.appModules,
      },
      options: {
        threshold: opts.threshold,
        includeVendor: opts.includeVendor,
      },
    },
    summary: {
      matched: matchResult.matched.length,
      unchanged: 0,
      changed: 0,
      newInB: matchResult.unmatchedB.length,
      removedFromA: matchResult.unmatchedA.length,
      matchMethods: matchResult.stats,
    },
    changed: [],
    new: [],
    removed: [],
  };

  // Process diff results
  if (diffResults) {
    for (const { idA, idB, score, method, diff } of diffResults) {
      if (!diff.changed) {
        report.summary.unchanged++;
      } else {
        const modA = verA.modules.get(idA);
        const modB = verB.modules.get(idB);
        const sizeDiff = modB.size - modA.size;

        // Classify as normalization artifact if:
        // - Size change is 0 and diff is tiny (≤2 lines) → dep numbering shift
        // - Size change is tiny (≤5 bytes) and diff lines is proportionally small
        //   → identifier length differences from minifier
        const absSizeDiff = Math.abs(sizeDiff);
        const isArtifact = (absSizeDiff === 0 && diff.diffLines <= 2) ||
          (absSizeDiff <= 5 && diff.diffLines <= 4);

        if (isArtifact) {
          report.summary.unchanged++;
          report.summary.likelyUnchanged = (report.summary.likelyUnchanged || 0) + 1;
        } else {
          report.summary.changed++;
          const entry = {
            idA, idB, score: Math.round(score * 1000) / 1000,
            method,
            fileA: modA.file, fileB: modB.file,
            sizeA: modA.size, sizeB: modB.size,
            sizeChange: sizeDiff > 0 ? `+${sizeDiff}` : `${sizeDiff}`,
            diffLines: diff.diffLines,
            exportsA: [...modA.exports],
            exportsB: [...modB.exports],
          };
          if (opts.showDiff) entry.diff = diff.diffText;
          report.changed.push(entry);
        }
      }
    }
  } else {
    // dry-run: all matched count as "unchanged" placeholder
    report.summary.unchanged = matchResult.matched.length;
  }

  // New modules in B
  for (const id of matchResult.unmatchedB) {
    const mod = verB.modules.get(id);
    report.new.push({
      id,
      file: mod.file,
      type: mod.type,
      size: mod.size,
      exports: [...mod.exports],
      topStrings: [...mod.strings].slice(0, 10),
      depCount: mod.depCount,
    });
  }

  // Removed modules from A
  for (const id of matchResult.unmatchedA) {
    const mod = verA.modules.get(id);
    report.removed.push({
      id,
      file: mod.file,
      type: mod.type,
      size: mod.size,
      exports: [...mod.exports],
      topStrings: [...mod.strings].slice(0, 10),
      depCount: mod.depCount,
    });
  }

  // Sort changed by diffLines descending
  report.changed.sort((a, b) => b.diffLines - a.diffLines);

  return report;
}

function printChangelog(report) {
  const { _meta, summary } = report;
  console.error(`\n${"═".repeat(70)}`);
  console.error(`  Changelog: v${_meta.versionA.version} → v${_meta.versionB.version}`);
  console.error(`${"═".repeat(70)}\n`);

  console.error(`  Modules A: ${_meta.versionA.appModules} app / ${_meta.versionA.totalModules} total`);
  console.error(`  Modules B: ${_meta.versionB.appModules} app / ${_meta.versionB.totalModules} total`);
  console.error(`  Matched:   ${summary.matched} (${summary.matchMethods.exportMatches} export + ${summary.matchMethods.fingerprintMatches} fingerprint + ${summary.matchMethods.depTopoMatches} dep-topo + ${summary.matchMethods.structuralMatches} structural)`);
  console.error(`  Unchanged: ${summary.unchanged}${summary.likelyUnchanged ? ` (incl. ~${summary.likelyUnchanged} fuzzy)` : ""}`);
  console.error(`  Changed:   ${summary.changed}`);
  console.error(`  New in B:  ${summary.newInB}`);
  console.error(`  Removed:   ${summary.removedFromA}\n`);

  if (report.changed.length > 0) {
    console.error(`── Changed modules ──────────────────────────────────────────────────`);
    for (const c of report.changed) {
      const exports = c.exportsB.length > 0 ? ` [${c.exportsB.join(", ")}]` : "";
      console.error(`  ${c.idA} → ${c.idB}  ${c.sizeChange} bytes  ${c.diffLines} diff lines${exports}`);
    }
    console.error();
  }

  if (report.new.length > 0) {
    console.error(`── New modules ──────────────────────────────────────────────────────`);
    for (const n of report.new) {
      const exports = n.exports.length > 0 ? ` [${n.exports.join(", ")}]` : "";
      console.error(`  + ${n.id} (${n.type}, ${n.size}b, ${n.depCount} deps)${exports}`);
      if (n.topStrings.length > 0) {
        console.error(`    strings: ${n.topStrings.slice(0, 5).map(s => `"${s.slice(0, 40)}"`).join(", ")}`);
      }
    }
    console.error();
  }

  if (report.removed.length > 0) {
    console.error(`── Removed modules ──────────────────────────────────────────────────`);
    for (const r of report.removed) {
      const exports = r.exports.length > 0 ? ` [${r.exports.join(", ")}]` : "";
      console.error(`  - ${r.id} (${r.type}, ${r.size}b, ${r.depCount} deps)${exports}`);
    }
    console.error();
  }
}

function printStats(verA, verB, matchResult, diffResults, elapsed) {
  console.error(`\n── Stats ────────────────────────────────────────────────────────────`);
  console.error(`  Version A: v${verA.version} (${verA.modules.size} modules fingerprinted)`);
  console.error(`  Version B: v${verB.version} (${verB.modules.size} modules fingerprinted)`);
  console.error(`  Matching:  ${matchResult.stats.exportMatches} export + ${matchResult.stats.fingerprintMatches} fingerprint + ${matchResult.stats.depTopoMatches} dep-topo + ${matchResult.stats.structuralMatches} structural = ${matchResult.matched.length} matched`);
  console.error(`  Unmatched: ${matchResult.unmatchedA.length} from A, ${matchResult.unmatchedB.length} from B`);
  if (diffResults) {
    const unchanged = diffResults.filter(d => !d.diff.changed).length;
    const changed = diffResults.filter(d => d.diff.changed).length;
    console.error(`  Diff:      ${unchanged} unchanged, ${changed} changed`);
  }
  console.error(`  Time:      ${(elapsed / 1000).toFixed(1)}s`);
  console.error();
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();

  // Phase 1: Ensure resplit
  const dirA = resolveVersionDir(opts.versionA);
  const dirB = resolveVersionDir(opts.versionB);
  const resplitA = ensureResplit(dirA);
  const resplitB = ensureResplit(dirB);

  // Phase 2: Load & fingerprint
  console.error(`Loading v${extractVersionNumber(dirA)}...`);
  const verA = loadVersion(dirA, resplitA, opts.includeVendor);
  console.error(`  ${verA.modules.size} modules fingerprinted`);

  console.error(`Loading v${extractVersionNumber(dirB)}...`);
  const verB = loadVersion(dirB, resplitB, opts.includeVendor);
  console.error(`  ${verB.modules.size} modules fingerprinted`);

  // Phase 3: Match
  console.error(`Matching modules...`);
  const matchResult = matchModules(verA, verB, opts.threshold);
  console.error(`  ${matchResult.matched.length} matched, ${matchResult.unmatchedA.length} unmatched in A, ${matchResult.unmatchedB.length} unmatched in B`);

  // Phase 4: Normalize & diff
  let diffResults = null;
  if (!opts.dryRun) {
    console.error(`Normalizing & diffing ${matchResult.matched.length} pairs...`);

    // Detect preamble for both versions
    const preambleA = detectPreamble(resplitA);
    const preambleB = detectPreamble(resplitB);

    // Build match lookup: A module name → B module name
    const matchAtoB = new Map();
    const matchBtoA = new Map();
    for (const { idA, idB } of matchResult.matched) {
      matchAtoB.set(idA, idB);
      matchBtoA.set(idB, idA);
    }

    diffResults = [];
    let diffCount = 0;
    for (const { idA, idB, score, method } of matchResult.matched) {
      const modA = verA.modules.get(idA);
      const modB = verB.modules.get(idB);

      const normalizedA = normalizeSource(modA.source, idA, modA.deps, preambleA, matchAtoB);
      const normalizedB = normalizeSource(modB.source, idB, modB.deps, preambleB, matchAtoB);

      const diff = diffSources(normalizedA, normalizedB, `a/${modA.file}`, `b/${modB.file}`);
      diffResults.push({ idA, idB, score, method, diff });

      if (diff.changed) diffCount++;
    }
    console.error(`  ${matchResult.matched.length - diffCount} unchanged, ${diffCount} changed`);
  }

  const elapsed = Date.now() - t0;

  // Phase 5: Report
  const report = generateReport(verA, verB, matchResult, diffResults, opts);

  if (opts.stats) printStats(verA, verB, matchResult, diffResults, elapsed);
  if (opts.changelog) printChangelog(report);

  // Output JSON
  const json = JSON.stringify(report, null, 2);
  if (opts.out) {
    fs.writeFileSync(opts.out, json);
    console.error(`Report written to ${opts.out}`);
  } else {
    process.stdout.write(json + "\n");
  }
}

main().catch(e => { console.error(e); process.exit(1); });
