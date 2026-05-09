#!/usr/bin/env node
/**
 * transfer-artifacts.mjs — Transfer artifacts from a reference version to a target version
 *
 * Uses content-based module matching to carry all processed artifacts
 * (renames, vendor classifications, directory layout) from a reference version
 * to any target version. Only genuinely new/changed modules need fresh processing.
 *
 * Algorithm:
 *   Phase 1: Load both versions, match modules
 *   Phase 2: Build identifier mapping (positional normalization)
 *   Phase 3: Transfer artifacts (vendor/folder, re-extract patterns, AI renames, manual renames)
 *   Phase 4: Generate output files
 *   Phase 5: Report stats
 *
 * Usage:
 *   node transfer-artifacts.mjs <target-version> [options]
 *
 *   target-version    Path or shorthand (e.g., v2.1.59, 2.1.59)
 *
 * Options:
 *   --reference <ver>    Reference version (default: v2.1.63)
 *   --layout <path>      Reference layout source (layout JSON file/dir)
 *   --out <dir>          Output directory (default: <targetDir>/transferred/)
 *   --dry-run            Show what would transfer, don't write
 *   --stats              Print transfer statistics
 *   -h, --help           Show help
 */

import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";

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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function resolveVersionsDir() {
  const candidates = [
    path.join(process.cwd(), "versions"),
    path.resolve(__dirname, "..", "versions"),
    path.join(process.cwd(), "clau-decode", "versions"),
    path.resolve(__dirname, "..", "..", "clau-decode", "versions"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isDirectory()) return candidate;
  }
  return candidates[0];
}

const VERSIONS_DIR = resolveVersionsDir();

// ─── Common properties to exclude (from diff-versions.mjs) ──────────────────

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

const JS_KEYWORDS = new Set([
  "var", "let", "const", "function", "return", "if", "else", "for", "while",
  "do", "switch", "case", "break", "continue", "try", "catch", "finally",
  "throw", "new", "delete", "typeof", "instanceof", "in", "of", "void",
  "this", "super", "class", "extends", "import", "export", "default", "from",
  "as", "async", "await", "yield", "static", "get", "set", "true", "false",
  "null", "undefined", "NaN", "Infinity", "arguments", "eval",
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

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printHelp() {
  console.error(`Usage: node transfer-artifacts.mjs <target-version> [options]
       node transfer-artifacts.mjs --build-cache [--reference <ver>]

Arguments:
  target-version       Path or shorthand (e.g., v2.1.59, 2.1.59)

Options:
  --reference <ver>    Reference version (default: v2.1.63)
  --layout <path>      Reference layout source (layout JSON file/dir)
  --out <dir>          Output directory (default: <targetDir>/transferred/)
  --dry-run            Show what would transfer, don't write
  --stats              Print transfer statistics
  --build-cache        Build reference cache (fingerprints + identifier maps) and exit
  --cache <file>       Use pre-built cache instead of reading ref source files
  --resplit <dir>      Override ref resplit directory (default: <versionDir>/resplit)
  --target-resplit <d> Override target resplit directory
  -h, --help           Show help`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    target: null,
    reference: "v2.1.63",
    out: null,
    dryRun: false,
    stats: false,
    buildCache: false,
    cache: null,
    layout: null,
    resplit: null,
    targetResplit: null,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "-h" || a === "--help") { printHelp(); process.exit(0); }
    else if (a === "--reference") opts.reference = args[++i];
    else if (a === "--out") opts.out = args[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--stats") opts.stats = true;
    else if (a === "--build-cache") opts.buildCache = true;
    else if (a === "--cache") opts.cache = args[++i];
    else if (a === "--layout") opts.layout = args[++i];
    else if (a === "--resplit") opts.resplit = args[++i];
    else if (a === "--target-resplit") opts.targetResplit = args[++i];
    else if (!opts.target) opts.target = a;
  }

  if (!opts.buildCache && !opts.target) {
    console.error("Error: target version argument required (or use --build-cache)");
    printHelp();
    process.exit(1);
  }

  return opts;
}

// ─── Version resolution (from diff-versions.mjs) ────────────────────────────

function resolveVersionDir(name) {
  if (path.isAbsolute(name) && fs.existsSync(name)) return name;
  const ver = name.replace(/^v/, "");
  const dirs = fs.readdirSync(VERSIONS_DIR).filter(d => d.includes("_v")).sort();
  const match = dirs.find(d => d.includes(`_v${ver}`));
  if (match) return path.join(VERSIONS_DIR, match);
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

function loadModulesFromJsonFile(filePath) {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
  if (!parsed || typeof parsed !== "object" || !parsed.modules || typeof parsed.modules !== "object") {
    return null;
  }
  return parsed.modules;
}

function findLayoutJsonInDir(dirPath, refVer) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return null;
  const exact = path.join(dirPath, `layout-v${refVer}.json`);
  if (fs.existsSync(exact)) return exact;
  const entries = fs.readdirSync(dirPath).filter(n => /^layout-v[\d.]+\.json$/.test(n)).sort().reverse();
  if (entries.length === 0) return null;
  return path.join(dirPath, entries[0]);
}

function resolveReferenceLayout(refDir, refVer, explicitLayoutPath) {
  const candidates = [];
  if (explicitLayoutPath) candidates.push(path.resolve(explicitLayoutPath));
  candidates.push(path.join(refDir, "artifacts", `layout-v${refVer}.json`));
  candidates.push(path.join(refDir, "artifacts"));
  candidates.push(path.join(__dirname, `layout-v${refVer}.json`));

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const st = fs.statSync(candidate);
    if (st.isFile()) {
      const modules = loadModulesFromJsonFile(candidate);
      if (modules) return { modules, sourcePath: candidate, sourceKind: "layout-json" };
      continue;
    }
    if (st.isDirectory()) {
      const layoutJson = findLayoutJsonInDir(candidate, refVer);
      if (layoutJson) {
        const modules = loadModulesFromJsonFile(layoutJson);
        if (modules) return { modules, sourcePath: layoutJson, sourceKind: "layout-json" };
      }
      const manifestPath = path.join(candidate, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        const modules = loadModulesFromJsonFile(manifestPath);
        if (modules) return { modules, sourcePath: manifestPath, sourceKind: "manifest-fallback" };
      }
    }
  }

  const legacyManifest = path.join(refDir, "decoded-organized", "manifest.json");
  if (fs.existsSync(legacyManifest)) {
    const modules = loadModulesFromJsonFile(legacyManifest);
    if (modules) return { modules, sourcePath: legacyManifest, sourceKind: "manifest-fallback" };
  }

  return null;
}

// ─── Ensure resplit (from diff-versions.mjs) ─────────────────────────────────

function ensureResplit(versionDir) {
  const resplitDir = path.join(versionDir, "resplit");
  const manifestPath = path.join(resplitDir, "manifest.json");
  if (fs.existsSync(manifestPath)) return resplitDir;

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

// ─── Fingerprinting & loading (from diff-versions.mjs) ──────────────────────

function extractFingerprint(code) {
  const strings = new Set();
  const properties = new Set();
  for (const m of code.matchAll(/"([^"\\]{5,})"/g)) strings.add(m[1]);
  for (const m of code.matchAll(/'([^'\\]{5,})'/g)) strings.add(m[1]);
  for (const m of code.matchAll(/\.([a-zA-Z_$][a-zA-Z0-9_$]{2,})/g)) {
    if (!COMMON_PROPS.has(m[1])) properties.add(m[1]);
  }
  for (const m of code.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]{2,})\s*[:(]/g)) {
    if (!COMMON_PROPS.has(m[1])) properties.add(m[1]);
  }
  return { strings, properties };
}

function loadVersion(versionDir, resplitDir, includeVendor) {
  const manifestPath = path.join(resplitDir, "manifest.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const modules = new Map();
  let totalModules = 0, appModules = 0;

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
      name, file: meta.file, type: meta.type,
      exports: exportSet, vendor: !!meta.vendor,
      size: meta.size || source.length,
      deps: meta.deps || [],
      depCount: (meta.deps || []).length,
      strings: fp.strings, properties: fp.properties,
      source,
    });
  }

  return {
    version: extractVersionNumber(versionDir),
    versionDir, resplitDir, manifest, modules,
    totalModules, appModules: includeVendor ? totalModules : appModules,
  };
}

// ─── Module matching (from diff-versions.mjs) ────────────────────────────────

function jaccard(setA, setB) {
  if (setA.size === 0 && setB.size === 0) return 1;
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const item of setA) { if (setB.has(item)) intersection++; }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function matchModules(verA, verB, threshold = 0.3) {
  const matched = [];
  const unmatchedA = new Set(verA.modules.keys());
  const unmatchedB = new Set(verB.modules.keys());

  // Pass 1: Exact export set match
  const exportIndexB = new Map();
  for (const [id, mod] of verB.modules) {
    if (mod.exports.size > 0) {
      const key = [...mod.exports].sort().join("\0");
      exportIndexB.set(key, exportIndexB.has(key) ? null : id);
    }
  }
  for (const [idA, modA] of verA.modules) {
    if (modA.exports.size === 0) continue;
    const key = [...modA.exports].sort().join("\0");
    const idB = exportIndexB.get(key);
    if (idB && unmatchedB.has(idB)) {
      matched.push({ idA, idB, score: 1.0, method: "export" });
      unmatchedA.delete(idA); unmatchedB.delete(idB);
    }
  }

  // Pass 2: Fingerprint similarity with inverted index
  const stringIndex = new Map();
  const propIndex = new Map();
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

  const candidates = [];
  for (const idA of unmatchedA) {
    const modA = verA.modules.get(idA);
    if (modA.strings.size === 0 && modA.properties.size === 0) continue;
    const candidateIds = new Set();
    for (const s of modA.strings) {
      const ids = stringIndex.get(s);
      if (ids) for (const id of ids) candidateIds.add(id);
    }
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
      let score;
      if (modA.strings.size >= 3 && modB.strings.size >= 3) {
        score = 0.6 * stringScore + 0.3 * propScore + 0.1 * sizeRatio;
      } else if (modA.properties.size >= 3 && modB.properties.size >= 3) {
        score = 0.2 * stringScore + 0.6 * propScore + 0.2 * sizeRatio;
      } else {
        score = 0.4 * stringScore + 0.4 * propScore + 0.2 * sizeRatio;
      }
      if (score >= threshold) candidates.push({ idA, idB, score });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  for (const { idA, idB, score } of candidates) {
    if (!unmatchedA.has(idA) || !unmatchedB.has(idB)) continue;
    matched.push({ idA, idB, score, method: "fingerprint" });
    unmatchedA.delete(idA); unmatchedB.delete(idB);
  }

  // Pass 3: Dep-topology matching
  let depTopoMatches = 0;
  let changed = true;
  while (changed) {
    changed = false;
    const matchAtoB = new Map();
    for (const { idA, idB } of matched) matchAtoB.set(idA, idB);
    const depKeyIndex = new Map();
    for (const idB of unmatchedB) {
      const mod = verB.modules.get(idB);
      if (mod.deps.length === 0) continue;
      const matchBtoA = new Map();
      for (const { idA, idB: iB } of matched) matchBtoA.set(iB, idA);
      const mappedDeps = mod.deps.map(d => matchBtoA.get(d)).filter(Boolean);
      if (mappedDeps.length === 0 || mappedDeps.length < mod.deps.length * 0.5) continue;
      const key = `${mod.type}:${mappedDeps.sort().join(",")}`;
      if (!depKeyIndex.has(key)) depKeyIndex.set(key, []);
      depKeyIndex.get(key).push(idB);
    }
    for (const idA of [...unmatchedA]) {
      const modA = verA.modules.get(idA);
      if (modA.deps.length === 0) continue;
      const matchAtoB2 = new Map();
      for (const { idA: iA, idB } of matched) matchAtoB2.set(iA, idB);
      const mappedDeps = modA.deps.map(d => matchAtoB2.get(d)).filter(Boolean);
      if (mappedDeps.length === 0 || mappedDeps.length < modA.deps.length * 0.5) continue;
      const aDepNames = modA.deps.filter(d => matchAtoB2.has(d));
      if (aDepNames.length === 0) continue;
      const key = `${modA.type}:${aDepNames.sort().join(",")}`;
      const bucket = depKeyIndex.get(key);
      if (!bucket) continue;
      let bestId = null, bestRatio = 0;
      for (const idB of bucket) {
        if (!unmatchedB.has(idB)) continue;
        const modB = verB.modules.get(idB);
        const ratio = Math.min(modA.size, modB.size) / Math.max(modA.size, modB.size);
        if (ratio > bestRatio) { bestRatio = ratio; bestId = idB; }
      }
      if (bestId && bestRatio >= 0.5) {
        matched.push({ idA, idB: bestId, score: 0.7 * bestRatio, method: "dep-topology" });
        unmatchedA.delete(idA); unmatchedB.delete(bestId);
        depTopoMatches++; changed = true;
      }
    }
  }

  // Pass 4: Structural fallback for tiny modules
  const tinyB = new Map();
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
      if (sizeRatio >= 0.9) structuralCandidates.push({ idA, idB, score: sizeRatio * 0.4 });
    }
  }
  structuralCandidates.sort((a, b) => b.score - a.score);
  for (const { idA, idB, score } of structuralCandidates) {
    if (!unmatchedA.has(idA) || !unmatchedB.has(idB)) continue;
    matched.push({ idA, idB, score, method: "structural" });
    unmatchedA.delete(idA); unmatchedB.delete(idB);
  }

  return { matched, unmatchedA: [...unmatchedA], unmatchedB: [...unmatchedB] };
}

// ─── Identifier mapping ─────────────────────────────────────────────────────

function isMinifiedName(name) {
  if (name.length > 6) return false;
  if (name.length > 3 && /^[A-Z_]+$/.test(name)) return false;
  return true;
}

function detectPreamble(resplitDir) {
  const runtimePath = path.join(resplitDir, "00-runtime.js");
  if (!fs.existsSync(runtimePath)) return {};
  const src = fs.readFileSync(runtimePath, "utf8").slice(0, 4000);
  const preamble = {};
  const decl = `(?:var\\s+|,\\s*)`;

  const patterns = [
    ["cjsFactory", `${decl}([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R\\)\\s*=>\\s*\\(\\)\\s*=>\\s*\\(R\\s*\\|\\|\\s*T\\s*\\(`],
    ["esmLazy", `${decl}([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R\\)\\s*=>\\s*\\(\\)\\s*=>\\s*\\(T\\s*&&\\s*\\(R\\s*=\\s*T\\(T\\s*=\\s*0\\)\\)`],
    ["exportReg", `${decl}([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R\\)\\s*=>\\s*\\{\\s*for\\s*\\(var\\s+A\\s+in\\s+R\\)[^}]*configurable`],
    ["interop", `${decl}([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R,\\s*A\\)\\s*=>\\s*\\{var\\s+_\\s*=\\s*T\\s*!=\\s*null`],
    ["esmInterop", `${decl}([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T\\)\\s*=>\\s*\\{var\\s+R\\s*=`],
    ["reExport", `${decl}([a-zA-Z_$][a-zA-Z0-9_$]*)\\s*=\\s*\\(T,\\s*R,\\s*A\\)\\s*=>\\s*\\{var\\s+_\\s*=\\s*[a-zA-Z_$]+\\(R\\)`],
  ];

  for (const [role, pattern] of patterns) {
    const m = src.match(new RegExp(pattern));
    if (m) preamble[role] = m[1];
  }
  return preamble;
}

/**
 * Collect all minified identifiers from a module's source and build a positional map.
 * Returns Map<originalName, positionalToken> (e.g., "xR_" → "$L0", "CD" → "$MOD")
 */
function collectIdentifierMap(source, moduleName, deps, preamble) {
  const code = source.replace(/^\/\/ resplit:.*\n/, "");
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

  const depSet = new Set(deps);
  const preambleNameMap = new Map();
  const preambleAliases = {
    cjsFactory: "$CJS_FACTORY", esmLazy: "$ESM_LAZY",
    interop: "$INTEROP", esmInterop: "$ESM_INTEROP",
    exportReg: "$EXPORT_REG", reExport: "$RE_EXPORT",
  };

  for (const [role, stableName] of Object.entries(preambleAliases)) {
    const actual = preamble[role];
    if (actual) {
      preambleNameMap.set(actual, stableName);
      if (!identifiers.has(actual)) {
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

  // Sort by first appearance → assign positional tokens
  const sorted = [...identifiers.entries()].sort((a, b) => a[1] - b[1]);
  const nameMap = new Map(); // original → token
  let depIdx = 0, localIdx = 0;

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

  return nameMap;
}

/**
 * Build a bidirectional identifier mapping between two matched modules.
 * Returns { refToTarget, targetToRef, refMapSize, targetMapSize }
 */
function buildIdentifierMapping(refMod, targetMod, preambleRef, preambleTarget) {
  const refMap = collectIdentifierMap(refMod.source, refMod.name, refMod.deps, preambleRef);
  const targetMap = collectIdentifierMap(targetMod.source, targetMod.name, targetMod.deps, preambleTarget);

  // Invert both: token → originalName
  const refTokenToName = new Map();
  for (const [name, token] of refMap) refTokenToName.set(token, name);

  const targetTokenToName = new Map();
  for (const [name, token] of targetMap) targetTokenToName.set(token, name);

  // Build bidirectional map via shared tokens
  const refToTarget = new Map();
  const targetToRef = new Map();

  for (const [token, refName] of refTokenToName) {
    const targetName = targetTokenToName.get(token);
    if (targetName) {
      refToTarget.set(refName, targetName);
      targetToRef.set(targetName, refName);
    }
  }

  return { refToTarget, targetToRef, refMapSize: refMap.size, targetMapSize: targetMap.size };
}

// ─── Diff detection (unchanged vs changed) ───────────────────────────────────

/**
 * Quick check if two matched modules are unchanged (same structure after normalization).
 *
 * Strategy: normalize both sources (replace minified identifiers with positional tokens)
 * and compare. This handles Bun's non-deterministic identifier names.
 * For speed, we compare normalized lengths first, then fall back to full comparison
 * only when lengths match but we need to be sure.
 */
function isModuleUnchanged(refMod, targetMod, mapping) {
  // Fast reject: if sizes differ by more than a small threshold, it's changed
  // (small diffs can be from identifier length differences: e.g., "xR_" vs "yS_")
  const sizeDiff = Math.abs(refMod.size - targetMod.size);
  if (sizeDiff > 20) return false;

  // If string+property fingerprints are identical, module is definitely unchanged
  const stringSim = jaccard(refMod.strings, targetMod.strings);
  const propSim = jaccard(refMod.properties, targetMod.properties);
  if (stringSim === 1.0 && propSim === 1.0 && sizeDiff === 0) return true;

  // If fingerprints differ significantly, it's changed
  if (stringSim < 0.95 || propSim < 0.95) return false;

  // Grey zone: fingerprints are close but not identical.
  // Compare identifier counts — if different, structure changed.
  if (mapping.refMapSize !== mapping.targetMapSize) return false;

  // Same number of identifiers with very similar fingerprints and small size diff → unchanged
  return sizeDiff <= 10;
}

// ─── Reference cache ─────────────────────────────────────────────────────────

/**
 * Build a cache of the reference version's fingerprints and identifier maps.
 * Stores all modules (app + vendor) with full fingerprints.
 * App modules also get identifier position maps for rename transfer.
 * This allows transfer without needing the ref's source files.
 */
function buildRefCache(refDir, resplitDir) {
  const verRef = loadVersion(refDir, resplitDir, true);
  const preamble = detectPreamble(resplitDir);

  let appCount = 0, vendorCount = 0;
  for (const mod of verRef.modules.values()) { mod.vendor ? vendorCount++ : appCount++; }
  console.error(`Building cache for ${verRef.modules.size} modules (${appCount} app + ${vendorCount} vendor)...`);

  const cache = {
    _meta: {
      version: verRef.version,
      generatedAt: new Date().toISOString(),
      tool: "transfer-artifacts.mjs --build-cache",
      moduleCount: appCount,
      vendorCount,
      totalModules: verRef.modules.size,
    },
    preamble,
    modules: {},
  };

  for (const [name, mod] of verRef.modules) {
    if (mod.vendor) {
      // Vendor: full fingerprints (now feasible — resplit writes individual vendor
      // files, so each module has its own strings/properties). No identifier map
      // needed (no renames to transfer).
      cache.modules[name] = {
        strings: [...mod.strings],
        properties: [...mod.properties],
        exports: [...mod.exports],
        deps: mod.deps,
        size: mod.size,
        type: mod.type,
        vendor: true,
        depCount: mod.depCount,
      };
    } else {
      // App: store full fingerprints + identifier map for rename transfer
      const identMap = collectIdentifierMap(mod.source, mod.name, mod.deps, preamble);

      cache.modules[name] = {
        strings: [...mod.strings],
        properties: [...mod.properties],
        identMap: Object.fromEntries(identMap),
        exports: [...mod.exports],
        deps: mod.deps,
        size: mod.size,
        type: mod.type,
        depCount: mod.depCount,
      };
    }
  }

  return cache;
}

/**
 * Load reference version from pre-built cache.
 * Cache has all modules (app + vendor) with full fingerprints.
 * App modules also have identMaps for rename transfer.
 */
function loadFromCache(cachePath) {
  const cache = JSON.parse(fs.readFileSync(cachePath, "utf8"));
  const modules = new Map();

  // Load all modules from cache (app: fingerprints + identMaps, vendor: fingerprints only)
  for (const [name, entry] of Object.entries(cache.modules)) {
    modules.set(name, {
      name,
      file: null,
      type: entry.type,
      exports: new Set(entry.exports),
      vendor: !!entry.vendor,
      size: entry.size,
      deps: entry.deps,
      depCount: entry.depCount,
      strings: new Set(entry.strings || []),
      properties: new Set(entry.properties || []),
      source: null,
      _identMap: entry.identMap ? new Map(Object.entries(entry.identMap)) : null,
    });
  }

  return {
    version: cache._meta.version,
    modules,
    totalModules: modules.size,
    appModules: cache._meta.moduleCount,
    preamble: cache.preamble,
  };
}

/**
 * Build identifier mapping using pre-computed cache for the ref side.
 */
function buildIdentifierMappingFromCache(refMod, targetMod, preambleTarget) {
  const refMap = refMod._identMap; // pre-computed from cache
  const targetMap = collectIdentifierMap(targetMod.source, targetMod.name, targetMod.deps, preambleTarget);

  // Invert both: token → originalName
  const refTokenToName = new Map();
  for (const [name, token] of refMap) refTokenToName.set(token, name);

  const targetTokenToName = new Map();
  for (const [name, token] of targetMap) targetTokenToName.set(token, name);

  const refToTarget = new Map();
  const targetToRef = new Map();

  for (const [token, refName] of refTokenToName) {
    const targetName = targetTokenToName.get(token);
    if (targetName) {
      refToTarget.set(refName, targetName);
      targetToRef.set(targetName, refName);
    }
  }

  return { refToTarget, targetToRef, refMapSize: refMap.size, targetMapSize: targetMap.size };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const t0 = Date.now();

  // ── Build cache mode ───────────────────────────────────────────────────

  if (opts.buildCache) {
    const refDir = resolveVersionDir(opts.reference);
    const refVer = extractVersionNumber(refDir);
    const resplitRef = opts.resplit ? path.resolve(opts.resplit) : ensureResplit(refDir);

    console.error(`Building reference cache for v${refVer} (resplit: ${path.basename(resplitRef)})...`);
    const cache = buildRefCache(refDir, resplitRef);

    // Write cache as streaming JSON (too large for single JSON.stringify)
    const cachePath = path.join(__dirname, `ref-cache-v${refVer}.json`);
    const fd = fs.openSync(cachePath, "w");
    fs.writeSync(fd, `{"_meta":${JSON.stringify(cache._meta)},"preamble":${JSON.stringify(cache.preamble)},"modules":{\n`);
    const moduleIds = Object.keys(cache.modules);
    for (let i = 0; i < moduleIds.length; i++) {
      const id = moduleIds[i];
      const comma = i < moduleIds.length - 1 ? "," : "";
      fs.writeSync(fd, `${JSON.stringify(id)}:${JSON.stringify(cache.modules[id])}${comma}\n`);
    }
    fs.writeSync(fd, "}}\n");
    fs.closeSync(fd);
    const sizeMB = (fs.statSync(cachePath).size / 1024 / 1024).toFixed(1);
    console.error(`Cache written to ${cachePath} (${sizeMB}MB, ${cache._meta.totalModules} modules: ${cache._meta.moduleCount} app + ${cache._meta.vendorCount} vendor)`);
    console.error(`Time: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    return;
  }

  // ── Phase 1: Load & Match ──────────────────────────────────────────────

  const targetDir = resolveVersionDir(opts.target);
  const refDir = resolveVersionDir(opts.reference);
  const targetVer = extractVersionNumber(targetDir);
  const refVer = extractVersionNumber(refDir);

  // Auto-detect cache file if not specified
  let cachePath = opts.cache;
  if (!cachePath) {
    const autoCache = path.join(__dirname, `ref-cache-v${refVer}.json`);
    if (fs.existsSync(autoCache)) cachePath = autoCache;
  }

  const useCache = !!cachePath;

  console.error(`Transfer: v${refVer} → v${targetVer}${useCache ? " (using cache)" : ""}`);

  // Load reference layout metadata (JSON artifact preferred, manifest fallback)
  const refLayout = resolveReferenceLayout(refDir, refVer, opts.layout);
  let refLayoutModules = null;
  if (refLayout) {
    refLayoutModules = refLayout.modules;
    console.error(
      `Loaded reference layout (${Object.keys(refLayoutModules).length} modules) from ${refLayout.sourcePath} [${refLayout.sourceKind}]`,
    );
  } else {
    console.error("Warning: no reference layout found (layout-v*.json or decoded-organized/manifest.json)");
  }

  let verRef, preambleRef;

  if (useCache) {
    console.error(`Loading reference from cache: ${path.basename(cachePath)}...`);
    verRef = loadFromCache(cachePath);
    preambleRef = verRef.preamble;
    console.error(`  ${verRef.modules.size} modules loaded from cache (${verRef.appModules} app + ${verRef.modules.size - verRef.appModules} vendor)`);
  } else {
    const resplitRef = ensureResplit(refDir);
    console.error(`Loading v${refVer} (reference, with vendor)...`);
    verRef = loadVersion(refDir, resplitRef, true);
    preambleRef = detectPreamble(resplitRef);
    console.error(`  ${verRef.modules.size} modules loaded from source`);
  }

  const resplitTarget = opts.targetResplit ? path.resolve(opts.targetResplit) : ensureResplit(targetDir);

  console.error(`Loading v${targetVer} (target, with vendor)...`);
  const verTarget = loadVersion(targetDir, resplitTarget, true);
  console.error(`  ${verTarget.modules.size} modules loaded`);

  console.error(`Matching modules...`);
  const matchResult = matchModules(verRef, verTarget);
  console.error(`  ${matchResult.matched.length} matched, ${matchResult.unmatchedA.length} removed, ${matchResult.unmatchedB.length} new`);

  // Build match lookup maps
  const matchRefToTarget = new Map();
  const matchTargetToRef = new Map();
  for (const { idA, idB } of matchResult.matched) {
    matchRefToTarget.set(idA, idB);
    matchTargetToRef.set(idB, idA);
  }

  // ── Phase 2: Build Identifier Mapping ──────────────────────────────────

  console.error(`Building identifier mappings...`);
  const preambleTarget = detectPreamble(resplitTarget);

  // For each matched pair, determine if unchanged and build identifier mapping
  const identMappings = new Map(); // refId → { refToTarget, targetToRef, unchanged }
  let unchangedCount = 0, changedCount = 0;

  for (const { idA: refId, idB: targetId } of matchResult.matched) {
    const refMod = verRef.modules.get(refId);
    const targetMod = verTarget.modules.get(targetId);

    // Use cache-aware mapping if ref has pre-computed identMap
    let mapping;
    if (refMod._identMap) {
      // Cache has pre-computed identMap for this module
      mapping = buildIdentifierMappingFromCache(refMod, targetMod, preambleTarget);
    } else if (refMod._identMap === null) {
      // Cache explicitly skipped this module (vendor) — no identifier mapping needed
      mapping = { refToTarget: new Map(), targetToRef: new Map(), refMapSize: 0, targetMapSize: 0 };
    } else {
      // No cache — compute from source
      mapping = buildIdentifierMapping(refMod, targetMod, preambleRef, preambleTarget);
    }
    const unchanged = isModuleUnchanged(refMod, targetMod, mapping);
    if (unchanged) unchangedCount++;
    else changedCount++;

    identMappings.set(refId, { ...mapping, unchanged, targetId });
  }

  console.error(`  ${unchangedCount} unchanged, ${changedCount} changed`);

  // ── Phase 3: Transfer Artifacts ────────────────────────────────────────

  // 3a. Vendor + folder from reference layout
  console.error(`Transferring vendor/folder metadata...`);
  const targetManifest = JSON.parse(fs.readFileSync(path.join(resplitTarget, "manifest.json"), "utf8"));
  const enrichedModules = {};
  let vendorTransferred = 0, folderTransferred = 0;

  for (const [targetId, targetMeta] of Object.entries(targetManifest.modules)) {
    const refId = matchTargetToRef.get(targetId);
    const enriched = { ...targetMeta };

    if (refId && refLayoutModules && refLayoutModules[refId]) {
      const refMeta = refLayoutModules[refId];

      // Copy vendor classification
      if (refMeta.vendor !== undefined) {
        enriched.vendor = refMeta.vendor;
        if (refMeta.vendorPackage) {
          enriched.vendorPackage = refMeta.vendorPackage;
          vendorTransferred++;
        }
      }

      // Copy semantic file path (directory + filename)
      if (refMeta.file) {
        enriched.organizedFile = refMeta.file;
        folderTransferred++;
      }

      // Translate deps using match map
      if (enriched.deps) {
        enriched.translatedDeps = enriched.deps.map(d => {
          const refDep = matchTargetToRef.get(d);
          if (refDep && matchRefToTarget.has(refDep)) return d; // exists in target
          return d;
        });
      }
    }

    enrichedModules[targetId] = enriched;
  }

  console.error(`  ${vendorTransferred} vendor packages, ${folderTransferred} folder assignments transferred`);

  // 3b. Re-extract pattern-based renames from target
  console.error(`Re-extracting pattern-based renames from target...`);
  const reExtracted = {};
  let reExtractedCount = 0;

  if (!opts.dryRun) {
    const extractExportsScript = path.join(__dirname, "extract-exports.mjs");
    const extractNamesScript = path.join(__dirname, "extract-names.mjs");

    // Run extract-exports on target resplit
    try {
      const exportsJson = execSync(
        `node "${extractExportsScript}" "${resplitTarget}"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      );
      const exports = JSON.parse(exportsJson);
      for (const [k, v] of Object.entries(exports)) {
        reExtracted[k] = v;
        reExtractedCount++;
      }
    } catch (e) {
      console.error(`  Warning: extract-exports failed: ${e.message}`);
    }

    // Run extract-names on target resplit
    try {
      const namesJson = execSync(
        `node "${extractNamesScript}" "${resplitTarget}"`,
        { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }
      );
      const names = JSON.parse(namesJson);
      for (const [k, v] of Object.entries(names)) {
        if (!reExtracted[k]) { // don't override exports
          reExtracted[k] = v;
          reExtractedCount++;
        }
      }
    } catch (e) {
      console.error(`  Warning: extract-names failed: ${e.message}`);
    }
  }

  console.error(`  ${reExtractedCount} renames re-extracted`);

  // 3c. Transfer AI renames via identifier mapping
  console.error(`Transferring AI renames...`);
  const transferredRenames = {};
  let aiRenamesTransferred = 0, aiRenamesSkipped = 0;
  const needsProcessing = []; // modules needing fresh AI rename

  // Load progress files
  const aiBatchProgressPath = path.join(__dirname, `renames-ai-v${refVer}.progress.json`);
  const aiScopedProgressPath = path.join(__dirname, "renames-scoped-ai.progress.json");

  let aiBatchProgress = {};
  let aiScopedProgress = {};

  if (fs.existsSync(aiBatchProgressPath)) {
    aiBatchProgress = JSON.parse(fs.readFileSync(aiBatchProgressPath, "utf8"));
    console.error(`  Loaded AI batch progress: ${Object.keys(aiBatchProgress).length} modules`);
  } else {
    console.error(`  Warning: no AI batch progress at ${aiBatchProgressPath}`);
  }

  if (fs.existsSync(aiScopedProgressPath)) {
    aiScopedProgress = JSON.parse(fs.readFileSync(aiScopedProgressPath, "utf8"));
    console.error(`  Loaded AI scoped progress: ${Object.keys(aiScopedProgress).length} modules`);
  } else {
    console.error(`  Warning: no AI scoped progress at ${aiScopedProgressPath}`);
  }

  // Transfer AI renames for each matched module
  for (const { idA: refId, idB: targetId } of matchResult.matched) {
    const mapping = identMappings.get(refId);

    // Get renames from both progress files for this ref module
    const batchRenames = aiBatchProgress[refId] || {};
    const scopedEntry = aiScopedProgress[refId];
    const scopedRenames = scopedEntry?.renames || {};

    const hasRenames = Object.keys(batchRenames).length > 0 || Object.keys(scopedRenames).length > 0;
    if (!hasRenames) continue;

    // Merge: batch first, then scoped overrides
    const mergedRenames = { ...batchRenames, ...scopedRenames };

    // Translate each rename key using the identifier mapping
    for (const [refMinified, humanName] of Object.entries(mergedRenames)) {
      const targetMinified = mapping.refToTarget.get(refMinified);
      if (targetMinified && targetMinified !== humanName) {
        // Don't overwrite re-extracted names (higher priority sources like exports)
        if (!reExtracted[targetMinified]) {
          transferredRenames[targetMinified] = humanName;
          aiRenamesTransferred++;
        }
      } else {
        aiRenamesSkipped++;
      }
    }
  }

  console.error(`  ${aiRenamesTransferred} AI renames transferred, ${aiRenamesSkipped} skipped (no mapping)`);

  // 3d. Transfer manual renames
  console.error(`Transferring manual renames...`);
  let manualTransferred = 0;

  const manualFiles = [
    path.join(__dirname, `renames-v${refVer}.json`),
    path.join(__dirname, `renames-v${refVer}-pass2.json`),
  ];

  // Build reverse index: which module contains which ref identifier?
  // Manual renames are typically module-scope identifiers not in AI progress files.
  // We find them by checking which ref module's identifier map contains each key.
  const refIdToModule = new Map(); // refIdentifier → refModuleId

  // First check AI progress files
  for (const [refModId, renames] of Object.entries(aiBatchProgress)) {
    for (const refMinified of Object.keys(renames)) {
      refIdToModule.set(refMinified, refModId);
    }
  }
  for (const [refModId, entry] of Object.entries(aiScopedProgress)) {
    if (entry.renames) {
      for (const refMinified of Object.keys(entry.renames)) {
        refIdToModule.set(refMinified, refModId);
      }
    }
  }

  // Also index all identifiers from the identifier mappings we already built
  for (const [refModId, mapping] of identMappings) {
    for (const refName of mapping.refToTarget.keys()) {
      if (!refIdToModule.has(refName)) {
        refIdToModule.set(refName, refModId);
      }
    }
  }

  for (const manualFile of manualFiles) {
    if (!fs.existsSync(manualFile)) continue;
    const manual = JSON.parse(fs.readFileSync(manualFile, "utf8"));

    for (const [refKey, humanName] of Object.entries(manual)) {
      // Case 1: Key is a module ID — translate via match map
      if (matchRefToTarget.has(refKey)) {
        const targetId = matchRefToTarget.get(refKey);
        if (!reExtracted[targetId] && !transferredRenames[targetId]) {
          transferredRenames[targetId] = humanName;
          manualTransferred++;
        }
        continue;
      }

      // Case 2: Key is an internal identifier — find its module, use identifier mapping
      const containingModule = refIdToModule.get(refKey);
      if (containingModule) {
        const mapping = identMappings.get(containingModule);
        if (mapping) {
          const targetKey = mapping.refToTarget.get(refKey);
          if (targetKey && targetKey !== humanName && !reExtracted[targetKey] && !transferredRenames[targetKey]) {
            transferredRenames[targetKey] = humanName;
            manualTransferred++;
          }
        }
      }
    }
  }

  console.error(`  ${manualTransferred} manual renames transferred`);

  // Identify modules needing fresh AI processing
  for (const { idA: refId, idB: targetId } of matchResult.matched) {
    const mapping = identMappings.get(refId);
    if (!mapping.unchanged) {
      needsProcessing.push({ id: targetId, reason: "changed", matchedRef: refId });
    }
  }
  for (const targetId of matchResult.unmatchedB) {
    const mod = verTarget.modules.get(targetId);
    needsProcessing.push({
      id: targetId,
      reason: "new",
      type: mod.type,
      size: mod.size,
      vendor: mod.vendor,
    });
  }

  // ── Phase 4: Generate Outputs ──────────────────────────────────────────

  const outDir = opts.out || path.join(targetDir, "transferred");

  if (!opts.dryRun) {
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Enriched target manifest
    const enrichedManifest = {
      ...targetManifest,
      _meta: {
        ...targetManifest._meta,
        transferredFrom: `v${refVer}`,
        referenceLayoutSource: refLayout?.sourcePath || null,
        referenceLayoutType: refLayout?.sourceKind || null,
        transferredAt: new Date().toISOString(),
        transferTool: "transfer-artifacts.mjs",
      },
      modules: enrichedModules,
    };
    fs.writeFileSync(
      path.join(outDir, "manifest.json"),
      JSON.stringify(enrichedManifest, null, 2)
    );

    // Flat rename JSON (all transferred)
    fs.writeFileSync(
      path.join(outDir, `renames-transferred-v${targetVer}.json`),
      JSON.stringify(transferredRenames, null, 2)
    );

    // Re-extracted renames
    fs.writeFileSync(
      path.join(outDir, `renames-re-extracted-v${targetVer}.json`),
      JSON.stringify(reExtracted, null, 2)
    );

    // Needs-processing list
    fs.writeFileSync(
      path.join(outDir, `needs-processing-v${targetVer}.json`),
      JSON.stringify(needsProcessing, null, 2)
    );

    console.error(`\nOutput written to ${outDir}/`);
  }

  // ── Phase 5: Report ────────────────────────────────────────────────────

  const elapsed = Date.now() - t0;
  const totalTransferred = Object.keys(transferredRenames).length;
  const totalReExtracted = Object.keys(reExtracted).length;

  const newAppModules = needsProcessing.filter(m => m.reason === "new" && !m.vendor).length;
  const changedAppModules = needsProcessing.filter(m => m.reason === "changed").length;

  if (opts.stats || true) { // always show stats
    console.error(`\n${"═".repeat(70)}`);
    console.error(`  Artifact Transfer: v${refVer} → v${targetVer}`);
    console.error(`${"═".repeat(70)}`);
    console.error();
    console.error(`  Modules (ref):     ${verRef.modules.size}`);
    console.error(`  Modules (target):  ${verTarget.modules.size}`);
    console.error(`  Matched:           ${matchResult.matched.length}`);
    console.error(`  Unchanged:         ${unchangedCount}`);
    console.error(`  Changed:           ${changedCount}`);
    console.error(`  New in target:     ${matchResult.unmatchedB.length}`);
    console.error(`  Removed from ref:  ${matchResult.unmatchedA.length}`);
    console.error();
    console.error(`  ── Transferred ──`);
    console.error(`  Vendor packages:   ${vendorTransferred}`);
    console.error(`  Folder assignments:${folderTransferred}`);
    console.error(`  AI renames:        ${aiRenamesTransferred}`);
    console.error(`  Manual renames:    ${manualTransferred}`);
    console.error(`  Re-extracted:      ${totalReExtracted}`);
    console.error(`  Total renames:     ${totalTransferred + totalReExtracted}`);
    console.error();
    console.error(`  ── Needs Processing ──`);
    console.error(`  Changed modules:   ${changedAppModules} (have partial renames)`);
    console.error(`  New app modules:   ${newAppModules} (need full AI rename)`);
    console.error(`  New vendor modules:${needsProcessing.filter(m => m.reason === "new" && m.vendor).length}`);
    console.error();
    console.error(`  Time: ${(elapsed / 1000).toFixed(1)}s`);
    console.error();

    if (!opts.dryRun) {
      console.error(`  ── Output Files ──`);
      console.error(`  ${outDir}/manifest.json`);
      console.error(`  ${outDir}/renames-transferred-v${targetVer}.json`);
      console.error(`  ${outDir}/renames-re-extracted-v${targetVer}.json`);
      console.error(`  ${outDir}/needs-processing-v${targetVer}.json`);
      console.error();
      console.error(`  ── Next Steps ──`);
      console.error(`  1. Merge renames: jq -s 'add' transferred/renames-re-extracted-v${targetVer}.json transferred/renames-transferred-v${targetVer}.json > renames-all-v${targetVer}.json`);
      console.error(`  2. Deobfuscate:   node deobfuscate.mjs --dir ${resplitTarget} --batch renames-all-v${targetVer}.json --only rename`);
      console.error(`  3. AI rename new: node ai-rename.mjs (only ${newAppModules} new modules)`);
    }
    console.error();
  }
}

main().catch(e => { console.error(e); process.exit(1); });
