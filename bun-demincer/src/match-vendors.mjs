#!/usr/bin/env node
/**
 * match-vendors.mjs — Vendor fingerprint matching tool
 *
 * Identifies escaped vendor (npm library) modules in the resplit app pile
 * by fingerprinting reference npm packages and matching against extracted modules.
 *
 * Algorithm:
 *   1. Build fingerprint DB: scan every .js/.mjs/.cjs/.json file in reference npm packages,
 *      extract string literals + property/method names as fingerprint sets
 *   2. Match: for each app module, extract same fingerprint, compute containment score
 *      against every file in the DB: score = |module ∩ file| / |module|
 *   3. Output: vendor-overrides.json with matched modules + package/file attribution
 *
 * Usage:
 *   node match-vendors.mjs <resplit-dir> --npm-dir <path> [options]
 */

import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default || _traverse;

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

// ─── CLI arg parsing ─────────────────────────────────────────────────────────

function printUsage() {
  console.log(`Usage: node match-vendors.mjs <resplit-dir> [options]

Identify escaped vendor modules by fingerprint matching against npm packages.

Options:
  --npm-dir <path>         node_modules directory with reference packages (required for matching)
  --db <path>              Load/save fingerprint DB (default: vendor-fingerprints.json)
  --rebuild-db             Force rebuild fingerprint DB even if file exists
  --out <path>             Output vendor overrides JSON (default: vendor-overrides.json)
  --threshold <n>          Min containment score to flag as vendor (default: 0.5)
  --min-overlap <n>        Min absolute feature overlap count (default: 10)
  --top-n <n>              Show top N matches per module (default: 1)
  --suspects               Also show unmatched modules with vendor-like signals
  --classify               Full pipeline: fingerprint match + flood-fill + manifest update + file move
  --flood-fill-only        Skip fingerprint matching, just flood-fill from existing vendor seeds
  --no-move                Classify in manifest but don't move files to vendor/ dirs
  --dry-run                Only build DB + report matches, don't write output
  -h, --help               Show this help
`);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    resplitDir: null,
    npmDir: null,
    db: "vendor-fingerprints.json",
    rebuildDb: false,
    out: "vendor-overrides.json",
    threshold: 0.5,
    minOverlap: 10,
    topN: 1,
    suspects: false,
    classify: false,
    floodFillOnly: false,
    noMove: false,
    dryRun: false,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case "--npm-dir":
        opts.npmDir = args[++i];
        i++;
        break;
      case "--db":
        opts.db = args[++i];
        i++;
        break;
      case "--rebuild-db":
        opts.rebuildDb = true;
        i++;
        break;
      case "--out":
        opts.out = args[++i];
        i++;
        break;
      case "--threshold":
        opts.threshold = parseFloat(args[++i]);
        i++;
        break;
      case "--min-overlap":
        opts.minOverlap = parseInt(args[++i], 10);
        i++;
        break;
      case "--top-n":
        opts.topN = parseInt(args[++i], 10);
        i++;
        break;
      case "--suspects":
        opts.suspects = true;
        i++;
        break;
      case "--classify":
        opts.classify = true;
        i++;
        break;
      case "--flood-fill-only":
        opts.floodFillOnly = true;
        i++;
        break;
      case "--no-move":
        opts.noMove = true;
        i++;
        break;
      case "--dry-run":
        opts.dryRun = true;
        i++;
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
      default:
        if (args[i].startsWith("--")) {
          console.error(`Unknown option: ${args[i]}`);
          printUsage();
          process.exit(1);
        }
        if (!opts.resplitDir) {
          opts.resplitDir = args[i];
        }
        i++;
        break;
    }
  }

  if (!opts.resplitDir) {
    console.error("Error: <resplit-dir> is required");
    printUsage();
    process.exit(1);
  }
  const needsNpmDir = !opts.floodFillOnly && (!fs.existsSync(opts.db) || opts.rebuildDb);
  if (!opts.npmDir && needsNpmDir) {
    console.error("Error: --npm-dir is required (unless --flood-fill-only or --db points to an existing DB)");
    printUsage();
    process.exit(1);
  }

  return opts;
}

// ─── Fingerprint extraction ─────────────────────────────────────────────────

/**
 * Extract fingerprint from JavaScript source code.
 * Returns { strings: Set<string>, properties: Set<string> }
 */
function extractFingerprintJS(code) {
  const strings = new Set();
  const properties = new Set();

  let ast;
  try {
    ast = parse(code, {
      sourceType: "unambiguous",
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      errorRecovery: true,
      plugins: ["jsx"],
    });
  } catch {
    // If Babel can't parse, fall back to regex extraction
    return extractFingerprintRegex(code);
  }

  try {
    traverse(ast, {
      StringLiteral(nodePath) {
        const val = nodePath.node.value;
        if (val.length >= 5) strings.add(val);
      },
      TemplateLiteral(nodePath) {
        for (const quasi of nodePath.node.quasis) {
          const raw = quasi.value.raw;
          if (raw.length >= 5) strings.add(raw);
        }
      },
      ObjectProperty(nodePath) {
        const key = nodePath.node.key;
        let name;
        if (key.type === "Identifier") name = key.name;
        else if (key.type === "StringLiteral") name = key.value;
        if (name && name.length > 2 && !COMMON_PROPS.has(name)) {
          properties.add(name);
        }
      },
      MemberExpression(nodePath) {
        if (!nodePath.node.computed && nodePath.node.property.type === "Identifier") {
          const name = nodePath.node.property.name;
          if (name.length > 2 && !COMMON_PROPS.has(name)) {
            properties.add(name);
          }
        }
      },
      ObjectMethod(nodePath) {
        const key = nodePath.node.key;
        if (key.type === "Identifier" && key.name.length > 2 && !COMMON_PROPS.has(key.name)) {
          properties.add(key.name);
        }
      },
      ClassMethod(nodePath) {
        const key = nodePath.node.key;
        if (key.type === "Identifier" && key.name.length > 2 && !COMMON_PROPS.has(key.name)) {
          properties.add(key.name);
        }
      },
    });
  } catch {
    // Traverse can fail on edge-case ASTs (duplicate declarations, etc.)
    // Fall back to regex extraction, merging any results we already got
    const regexFP = extractFingerprintRegex(code);
    for (const s of regexFP.strings) strings.add(s);
    for (const p of regexFP.properties) properties.add(p);
  }

  return { strings, properties };
}

/**
 * Regex fallback for unparseable JS files.
 */
function extractFingerprintRegex(code) {
  const strings = new Set();
  const properties = new Set();

  // Extract quoted strings ≥5 chars
  for (const m of code.matchAll(/"([^"\\]{5,})"/g)) strings.add(m[1]);
  for (const m of code.matchAll(/'([^'\\]{5,})'/g)) strings.add(m[1]);

  // Extract property access patterns: .propName
  for (const m of code.matchAll(/\.([a-zA-Z_$][a-zA-Z0-9_$]{2,})/g)) {
    if (!COMMON_PROPS.has(m[1])) properties.add(m[1]);
  }

  // Extract object keys: { keyName: or keyName(
  for (const m of code.matchAll(/([a-zA-Z_$][a-zA-Z0-9_$]{2,})\s*[:(]/g)) {
    if (!COMMON_PROPS.has(m[1])) properties.add(m[1]);
  }

  return { strings, properties };
}

/**
 * Extract fingerprint from JSON content.
 */
function extractFingerprintJSON(content) {
  const strings = new Set();
  const properties = new Set();

  let obj;
  try {
    obj = JSON.parse(content);
  } catch {
    return { strings, properties };
  }

  function walk(val) {
    if (val === null || val === undefined) return;
    if (typeof val === "string") {
      if (val.length >= 5) strings.add(val);
      return;
    }
    if (Array.isArray(val)) {
      for (const item of val) walk(item);
      return;
    }
    if (typeof val === "object") {
      for (const key of Object.keys(val)) {
        if (key.length > 2 && !COMMON_PROPS.has(key)) properties.add(key);
        walk(val[key]);
      }
    }
  }

  walk(obj);
  return { strings, properties };
}

/**
 * Extract fingerprint for data-heavy modules (typed arrays like Uint16Array/Uint8Array).
 * Creates a synthetic fingerprint from array shapes.
 */
function extractDataFingerprint(code) {
  const strings = new Set();
  // Match patterns like: new Uint16Array([1,2,3,...])
  const dataPatterns = code.matchAll(/new\s+(Uint8Array|Uint16Array|Uint32Array|Int8Array|Int16Array|Int32Array|Float32Array|Float64Array)\s*\(\s*\[([^\]]{20,})\]/g);
  for (const m of dataPatterns) {
    const type = m[1];
    const values = m[2].split(",").map(v => v.trim()).slice(0, 20);
    const sig = `__DATA_${type}_${values.length}_${values.join(",")}`;
    strings.add(sig);
  }
  return strings;
}

/**
 * Main fingerprint extraction entry point.
 */
function extractFingerprint(code, filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".json") {
    return extractFingerprintJSON(code);
  }

  const fp = extractFingerprintJS(code);

  // Also check for data-heavy content
  const dataFPs = extractDataFingerprint(code);
  for (const s of dataFPs) fp.strings.add(s);

  return fp;
}

// ─── npm package scanning ────────────────────────────────────────────────────

const SKIP_DIRS = new Set(["node_modules", ".git", "test", "tests", "__tests__", "spec", "benchmark", "benchmarks", "example", "examples", "coverage", ".nyc_output"]);
const SKIP_EXTS = new Set([".d.ts", ".map", ".min.js", ".min.mjs"]);
const SCAN_EXTS = new Set([".js", ".mjs", ".cjs", ".json"]);

/**
 * Recursively list scannable files in a directory.
 */
function listFiles(dir, maxDepth = 10) {
  const results = [];
  if (maxDepth <= 0) return results;

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return results;
  }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith(".")) continue;
      results.push(...listFiles(full, maxDepth - 1));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      if (!SCAN_EXTS.has(ext)) continue;
      if (SKIP_EXTS.has(ext)) continue;
      if (entry.name === "package.json" || entry.name.endsWith(".d.ts")) continue;
      // Skip READMEs, LICENSEs, changelogs
      const base = entry.name.toUpperCase();
      if (base.startsWith("README") || base.startsWith("LICENSE") || base.startsWith("CHANGELOG")) continue;
      results.push(full);
    }
  }
  return results;
}

/**
 * Scan a single npm package and return per-file fingerprints.
 */
function scanPackage(pkgDir, pkgName) {
  const files = listFiles(pkgDir);
  const fingerprints = [];

  for (const filePath of files) {
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      continue;
    }
    // Skip files > 500KB
    if (stat.size > 500_000) continue;

    let code;
    try {
      code = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Skip very small files (< 50 bytes)
    if (code.length < 50) continue;

    const relPath = path.relative(pkgDir, filePath);
    const fp = extractFingerprint(code, filePath);

    // Only include files with meaningful fingerprints
    if (fp.strings.size + fp.properties.size < 3) continue;

    fingerprints.push({
      package: pkgName,
      file: relPath,
      strings: [...fp.strings],
      properties: [...fp.properties],
    });
  }

  return fingerprints;
}

/**
 * List all top-level packages in node_modules (handles scoped packages).
 */
function listPackages(npmDir) {
  const packages = [];
  let entries;
  try {
    entries = fs.readdirSync(npmDir, { withFileTypes: true });
  } catch (e) {
    console.error(`Cannot read npm directory: ${npmDir}`);
    process.exit(1);
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (entry.name.startsWith(".")) continue;

    if (entry.name.startsWith("@")) {
      // Scoped package: @scope/pkg
      const scopeDir = path.join(npmDir, entry.name);
      try {
        const scopeEntries = fs.readdirSync(scopeDir, { withFileTypes: true });
        for (const se of scopeEntries) {
          if (se.isDirectory() && !se.name.startsWith(".")) {
            packages.push({
              name: `${entry.name}/${se.name}`,
              dir: path.join(scopeDir, se.name),
            });
          }
        }
      } catch {}
    } else {
      packages.push({
        name: entry.name,
        dir: path.join(npmDir, entry.name),
      });
    }
  }

  return packages;
}

// ─── Fingerprint DB ──────────────────────────────────────────────────────────

/**
 * Build fingerprint database from all packages in npmDir.
 */
function buildFingerprintDB(npmDir) {
  const packages = listPackages(npmDir);
  console.log(`Scanning ${packages.length} packages in ${npmDir}...`);

  const db = [];
  let fileCount = 0;
  let skippedCount = 0;

  for (let i = 0; i < packages.length; i++) {
    const pkg = packages[i];
    if ((i + 1) % 100 === 0 || i === packages.length - 1) {
      process.stdout.write(`\r  [${i + 1}/${packages.length}] Scanning ${pkg.name}...              `);
    }

    const fingerprints = scanPackage(pkg.dir, pkg.name);
    if (fingerprints.length === 0) {
      skippedCount++;
      continue;
    }

    fileCount += fingerprints.length;
    db.push(...fingerprints);
  }

  process.stdout.write("\r" + " ".repeat(80) + "\r");
  console.log(`DB built: ${db.length} file fingerprints from ${packages.length - skippedCount} packages (${skippedCount} empty/skipped)`);

  return db;
}

/**
 * Save fingerprint DB to JSON.
 * Converts arrays to compressed format to save space.
 */
function saveDB(db, dbPath) {
  const out = {
    _meta: {
      generatedAt: new Date().toISOString(),
      entries: db.length,
      tool: "match-vendors.mjs",
    },
    files: db,
  };
  fs.writeFileSync(dbPath, JSON.stringify(out));
  const sizeMB = (fs.statSync(dbPath).size / 1048576).toFixed(1);
  console.log(`DB saved: ${dbPath} (${sizeMB} MB, ${db.length} entries)`);
}

/**
 * Load fingerprint DB from JSON.
 */
function loadDB(dbPath) {
  const raw = JSON.parse(fs.readFileSync(dbPath, "utf-8"));
  console.log(`DB loaded: ${dbPath} (${raw.files.length} entries, generated ${raw._meta.generatedAt})`);
  // Convert string arrays back to Sets for matching (done lazily in matching phase)
  return raw.files;
}

// ─── Matching ────────────────────────────────────────────────────────────────

/**
 * Compute containment score: what fraction of module's features are found in the reference file?
 */
function computeScore(moduleStrings, moduleProps, fileStrings, fileProps) {
  let stringIntersect = 0;
  for (const s of moduleStrings) {
    if (fileStrings.has(s)) stringIntersect++;
  }

  let propIntersect = 0;
  for (const p of moduleProps) {
    if (fileProps.has(p)) propIntersect++;
  }

  const moduleStringCount = moduleStrings.size;
  const modulePropCount = moduleProps.size;

  if (moduleStringCount === 0 && modulePropCount === 0) {
    return { score: 0, stringScore: 0, propScore: 0, unanalyzable: true };
  }

  const stringScore = moduleStringCount > 0 ? stringIntersect / moduleStringCount : 0;
  const propScore = modulePropCount > 0 ? propIntersect / modulePropCount : 0;

  // Weighted average, handling missing dimensions
  let score;
  if (moduleStringCount === 0) {
    score = propScore;
  } else if (modulePropCount === 0) {
    score = stringScore;
  } else {
    score = 0.5 * stringScore + 0.5 * propScore;
  }

  return {
    score,
    stringScore,
    propScore,
    stringOverlap: stringIntersect,
    propOverlap: propIntersect,
    moduleStrings: moduleStringCount,
    moduleProps: modulePropCount,
  };
}

/**
 * Match all app modules against the fingerprint DB.
 */
function matchModules(resplitDir, manifest, db, opts) {
  const appModules = Object.entries(manifest.modules)
    .filter(([, m]) => !m.vendor)
    .sort((a, b) => (b[1].size || 0) - (a[1].size || 0));

  console.log(`\nMatching ${appModules.length} app modules against ${db.length} reference files...`);

  // Pre-convert DB entries to Sets for fast lookup
  const dbSets = db.map(entry => ({
    package: entry.package,
    file: entry.file,
    strings: new Set(entry.strings),
    properties: new Set(entry.properties),
  }));

  const matches = {};
  const suspects = [];
  let matchCount = 0;
  let unanalyzable = 0;

  for (let i = 0; i < appModules.length; i++) {
    const [modName, modInfo] = appModules[i];

    if ((i + 1) % 200 === 0 || i === appModules.length - 1) {
      process.stdout.write(`\r  [${i + 1}/${appModules.length}] Matching... (${matchCount} found)     `);
    }

    // Read module file
    const filePath = path.join(resplitDir, modInfo.file);
    let code;
    try {
      code = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    // Extract module fingerprint
    const modFP = extractFingerprint(code, filePath);

    const modFeatureCount = modFP.strings.size + modFP.properties.size;
    if (modFeatureCount < 5) {
      // Too few features to match meaningfully
      continue;
    }

    // Score against all DB entries
    const topMatches = [];
    for (const dbEntry of dbSets) {
      const result = computeScore(modFP.strings, modFP.properties, dbEntry.strings, dbEntry.properties);

      if (result.unanalyzable) {
        unanalyzable++;
        break;
      }

      const totalOverlap = (result.stringOverlap || 0) + (result.propOverlap || 0);
      if (result.score >= opts.threshold && totalOverlap >= opts.minOverlap) {
        topMatches.push({
          package: dbEntry.package,
          file: dbEntry.file,
          ...result,
        });
      }
    }

    if (topMatches.length > 0) {
      // Sort by score descending
      topMatches.sort((a, b) => b.score - a.score);
      const best = topMatches[0];

      const totalOverlap = (best.stringOverlap || 0) + (best.propOverlap || 0);
      matches[modInfo.file] = {
        moduleName: modName,
        package: best.package,
        file: best.file,
        score: Math.round(best.score * 1000) / 1000,
        stringScore: Math.round(best.stringScore * 1000) / 1000,
        propScore: Math.round(best.propScore * 1000) / 1000,
        overlap: totalOverlap,
        moduleFeatures: modFeatureCount,
        moduleSize: modInfo.size || code.length,
      };

      if (opts.topN > 1) {
        matches[modInfo.file].altMatches = topMatches.slice(1, opts.topN).map(m => ({
          package: m.package,
          file: m.file,
          score: Math.round(m.score * 1000) / 1000,
        }));
      }

      matchCount++;
    } else if (opts.suspects) {
      // Check for vendor-like signals
      const signals = [];
      if ((modInfo.size || code.length) > 20000) signals.push("large");
      if (modInfo.deps.length === 0) signals.push("no-deps");
      if (modFP.strings.size > 100) signals.push("many-strings");
      if (/Uint16Array|Uint8Array|Uint32Array/.test(code)) signals.push("typed-array-data");
      if (/\\u[0-9a-f]{4}/i.test(code)) signals.push("unicode-escapes");

      // Check if only called by vendor modules
      const callers = [];
      for (const [otherName, otherInfo] of Object.entries(manifest.modules)) {
        if (otherInfo.deps && otherInfo.deps.includes(modName)) {
          callers.push({ name: otherName, vendor: otherInfo.vendor });
        }
      }
      const appCallers = callers.filter(c => !c.vendor);
      if (callers.length > 0 && appCallers.length === 0) signals.push("only-vendor-callers");

      if (signals.length >= 2) {
        suspects.push({
          file: modInfo.file,
          moduleName: modName,
          size: modInfo.size || code.length,
          signals,
          fingerprintSize: modFP.strings.size + modFP.properties.size,
        });
      }
    }
  }

  process.stdout.write("\r" + " ".repeat(80) + "\r");
  return { matches, suspects, unanalyzable };
}

// ─── Reporting ───────────────────────────────────────────────────────────────

function printReport(matches, suspects, opts) {
  const matchEntries = Object.entries(matches).sort((a, b) => b[1].score - a[1].score);

  console.log(`\n${"═".repeat(70)}`);
  console.log(`VENDOR FINGERPRINT MATCHES: ${matchEntries.length} modules identified`);
  console.log(`${"═".repeat(70)}\n`);

  // Group by package
  const byPackage = {};
  for (const [moduleFile, match] of matchEntries) {
    if (!byPackage[match.package]) byPackage[match.package] = [];
    byPackage[match.package].push({ moduleFile, ...match });
  }

  for (const [pkg, modules] of Object.entries(byPackage).sort((a, b) => b[1].length - a[1].length)) {
    const totalSize = modules.reduce((sum, m) => sum + (m.moduleSize || 0), 0);
    console.log(`\n  ${pkg} (${modules.length} module${modules.length > 1 ? "s" : ""}, ${(totalSize / 1024).toFixed(0)} KB total)`);
    for (const m of modules.sort((a, b) => b.score - a.score)) {
      const scoreStr = (m.score * 100).toFixed(1).padStart(5);
      const sizeStr = ((m.moduleSize || 0) / 1024).toFixed(0).padStart(4);
      const overlapStr = `${m.overlap || "?"}/${m.moduleFeatures || "?"}`;
      const refFile = m.file.length > 40 ? "..." + m.file.slice(-37) : m.file;
      console.log(`    ${m.moduleFile.padEnd(45)} ${scoreStr}%  ${sizeStr} KB  [${overlapStr.padStart(9)}]  ← ${refFile}`);
      if (m.altMatches && m.altMatches.length > 0) {
        for (const alt of m.altMatches) {
          console.log(`      alt: ${alt.package}/${alt.file} (${(alt.score * 100).toFixed(1)}%)`);
        }
      }
    }
  }

  if (suspects.length > 0) {
    console.log(`\n${"─".repeat(70)}`);
    console.log(`UNMATCHED SUSPECTS: ${suspects.length} modules with vendor-like signals`);
    console.log(`${"─".repeat(70)}\n`);

    suspects.sort((a, b) => b.size - a.size);
    for (const s of suspects) {
      const sizeStr = (s.size / 1024).toFixed(0).padStart(4);
      console.log(`  ${s.file.padEnd(45)} ${sizeStr} KB  signals: ${s.signals.join(", ")}`);
    }
  }

  console.log(`\n${"─".repeat(70)}`);
  console.log(`Summary: ${matchEntries.length} vendor modules matched (threshold: ${opts.threshold})`);
  if (suspects.length > 0) console.log(`         ${suspects.length} unmatched suspects`);
  const totalMatchedKB = matchEntries.reduce((sum, [, m]) => sum + (m.moduleSize || 0), 0) / 1024;
  console.log(`         ${totalMatchedKB.toFixed(0)} KB of vendor code identified`);
  console.log(`${"─".repeat(70)}\n`);
}

// ─── Forward-dep flood-fill ──────────────────────────────────────────────────

/**
 * Reverse-caller flood-fill: mark a module as vendor if ALL its callers
 * (modules that import it) are already vendor. This is conservative — a single
 * app import prevents classification, avoiding false positives for shared deps.
 *
 * Uses the improved fingerprint DB seeds (not regex seeds like the old resplit),
 * so it starts from a much larger and more accurate set of confirmed vendors.
 */
function reverseCallerFloodFill(manifest) {
  const modules = manifest.modules;

  // Build reverse dep map: module → list of modules that import it
  const reverseDeps = new Map();
  for (const [name, mod] of Object.entries(modules)) {
    if (!mod.deps) continue;
    for (const dep of mod.deps) {
      if (!reverseDeps.has(dep)) reverseDeps.set(dep, []);
      reverseDeps.get(dep).push(name);
    }
  }

  const seedCount = Object.values(modules).filter(m => m.vendor).length;
  let floodCount = 0;
  let changed = true;
  let iterations = 0;

  while (changed) {
    changed = false;
    iterations++;
    for (const [name, mod] of Object.entries(modules)) {
      if (mod.vendor) continue;

      const callers = reverseDeps.get(name) || [];
      if (callers.length === 0) continue;

      // Check if ALL callers are vendor
      let allVendor = true;
      let anyVendor = false;
      const callerPackages = new Set();

      for (const callerName of callers) {
        const callerMod = modules[callerName];
        if (!callerMod) continue;
        if (callerMod.vendor) {
          anyVendor = true;
          if (callerMod.vendorPackage) callerPackages.add(callerMod.vendorPackage);
        } else {
          allVendor = false;
          break;
        }
      }

      if (allVendor && anyVendor) {
        mod.vendor = true;
        mod.vendorPackage = callerPackages.size === 1
          ? [...callerPackages][0]
          : "_unidentified";
        floodCount++;
        changed = true;
      }
    }
  }

  return { seedCount, floodCount, iterations };
}

// ─── Classify mode: manifest update + file moving ────────────────────────────

function classifyAndMove(manifest, manifestPath, resplitDir, noMove, dryRun) {
  const modules = manifest.modules;
  const vendorModules = Object.entries(modules).filter(([, m]) => m.vendor);
  const appModules = Object.entries(modules).filter(([, m]) => !m.vendor);

  console.log(`\nClassification: ${vendorModules.length} vendor, ${appModules.length} app`);

  if (noMove || dryRun) {
    // Just update manifest without moving files
    if (!dryRun) {
      fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
      console.log(`Manifest updated: ${manifestPath}`);
    } else {
      console.log("Dry run — no files changed");
    }

    // Show package breakdown
    const byPkg = new Map();
    for (const [, mod] of vendorModules) {
      const pkg = mod.vendorPackage || "_unidentified";
      byPkg.set(pkg, (byPkg.get(pkg) || 0) + 1);
    }
    const sorted = [...byPkg.entries()].sort((a, b) => b[1] - a[1]);
    console.log(`\nVendor packages (${sorted.length}):`);
    for (const [pkg, count] of sorted.slice(0, 20)) {
      console.log(`  ${pkg}: ${count} modules`);
    }
    if (sorted.length > 20) console.log(`  ... and ${sorted.length - 20} more`);
    return;
  }

  // Move vendor files to vendor/<pkg>/ directories
  const vendorDir = path.join(resplitDir, "vendor");
  fs.mkdirSync(vendorDir, { recursive: true });

  // Group by package for organized output
  const byPkg = new Map();
  for (const [name, mod] of vendorModules) {
    const pkg = mod.vendorPackage || "_unidentified";
    if (!byPkg.has(pkg)) byPkg.set(pkg, []);
    byPkg.get(pkg).push([name, mod]);
  }

  let movedCount = 0;
  const pkgIdxMap = new Map(); // per-package sequential index

  for (const [pkg, mods] of [...byPkg.entries()].sort()) {
    const pkgDir = path.join(vendorDir, pkg);
    fs.mkdirSync(pkgDir, { recursive: true });
    pkgIdxMap.set(pkg, 1);

    for (const [name, mod] of mods) {
      const oldPath = path.join(resplitDir, mod.file);
      const vidx = pkgIdxMap.get(pkg);
      const idxStr = String(vidx).padStart(4, "0");
      // Keep primaryName suffix if present
      const suffix = mod.primaryName ? `_${mod.primaryName}` : "";
      const newFile = `vendor/${pkg}/${idxStr}${suffix}.js`;
      const newPath = path.join(resplitDir, newFile);

      if (fs.existsSync(oldPath)) {
        fs.renameSync(oldPath, newPath);
        movedCount++;
      }

      mod.file = newFile;
      mod.index = 0; // vendor modules don't have app index
      pkgIdxMap.set(pkg, vidx + 1);
    }
  }

  // Update sourceOrder and fileOrder
  if (manifest.sourceOrder) {
    for (const entry of manifest.sourceOrder) {
      if (entry.type === "module" && modules[entry.name]) {
        entry.file = modules[entry.name].file;
      }
    }
  }
  manifest.fileOrder = [];
  if (manifest.sourceOrder) {
    const seen = new Set();
    for (const entry of manifest.sourceOrder) {
      if (!seen.has(entry.file)) {
        seen.add(entry.file);
        manifest.fileOrder.push(entry.file);
      }
    }
  }

  // Add vendorPackages summary to manifest
  manifest.vendorPackages = {};
  for (const [pkg, mods] of byPkg) {
    manifest.vendorPackages[pkg] = mods.map(([name]) => name);
  }

  // Clean up empty directories in root (where flat files used to be)
  // Don't remove non-empty dirs — app files still live there
  // Just write updated manifest
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  console.log(`Moved ${movedCount} files to vendor/ (${byPkg.size} packages)`);
  console.log(`Manifest updated: ${manifestPath}`);
}

// ─── Main ────────────────────────────────────────────────────────────────────

const opts = parseArgs();

// Validate inputs
if (!fs.existsSync(opts.resplitDir)) {
  console.error(`Error: resplit directory not found: ${opts.resplitDir}`);
  process.exit(1);
}
const manifestPath = path.join(opts.resplitDir, "manifest.json");
if (!fs.existsSync(manifestPath)) {
  console.error(`Error: manifest.json not found in ${opts.resplitDir}`);
  process.exit(1);
}
if (opts.npmDir && !fs.existsSync(opts.npmDir)) {
  console.error(`Error: npm directory not found: ${opts.npmDir}`);
  process.exit(1);
}

// Load manifest
const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
const totalMods = Object.keys(manifest.modules).length;
const vendorMods = Object.values(manifest.modules).filter(m => m.vendor).length;
console.log(`Loaded manifest: ${totalMods} modules (${totalMods - vendorMods} app, ${vendorMods} vendor)`);

// ─── Flood-fill-only mode ─────────────────────────────────────────────────

if (opts.floodFillOnly) {
  console.log("\nRunning reverse-caller flood-fill from existing vendor seeds...");
  const { seedCount, floodCount } = reverseCallerFloodFill(manifest);
  console.log(`Flood-fill: ${seedCount} seeds → +${floodCount} propagated → ${seedCount + floodCount} total vendor`);
  classifyAndMove(manifest, manifestPath, opts.resplitDir, opts.noMove, opts.dryRun);
  process.exit(0);
}

// ─── Normal / classify mode ───────────────────────────────────────────────

// Phase 1: Build or load fingerprint DB
let db;
if (fs.existsSync(opts.db) && !opts.rebuildDb) {
  db = loadDB(opts.db);
} else {
  const startTime = Date.now();
  db = buildFingerprintDB(opts.npmDir);
  saveDB(db, opts.db);
  console.log(`DB build time: ${((Date.now() - startTime) / 1000).toFixed(1)}s`);
}

// Phase 2: Match
const startMatch = Date.now();
const { matches, suspects } = matchModules(opts.resplitDir, manifest, db, opts);
console.log(`Match time: ${((Date.now() - startMatch) / 1000).toFixed(1)}s`);

// Phase 3: Report
printReport(matches, suspects, opts);

if (opts.classify) {
  // ─── Classify mode: apply matches to manifest + flood-fill + move ─────

  // Apply fingerprint matches to manifest
  let fpMatchCount = 0;
  for (const [file, match] of Object.entries(matches)) {
    const modName = match.moduleName;
    if (manifest.modules[modName]) {
      manifest.modules[modName].vendor = true;
      manifest.modules[modName].vendorPackage = match.package;
      fpMatchCount++;
    }
  }
  console.log(`\nApplied ${fpMatchCount} fingerprint matches to manifest`);

  // Forward-dep flood-fill from matched seeds
  console.log("Running reverse-caller flood-fill...");
  const { seedCount, floodCount } = reverseCallerFloodFill(manifest);
  console.log(`Flood-fill: ${seedCount} seeds → +${floodCount} propagated → ${seedCount + floodCount} total vendor`);

  // Update manifest + move files
  classifyAndMove(manifest, manifestPath, opts.resplitDir, opts.noMove, opts.dryRun);

} else {
  // ─── Legacy mode: write vendor-overrides JSON ─────────────────────────
  if (!opts.dryRun && Object.keys(matches).length > 0) {
    const output = {
      _meta: {
        generatedAt: new Date().toISOString(),
        tool: "match-vendors.mjs",
        threshold: opts.threshold,
        resplitDir: opts.resplitDir,
        npmDir: opts.npmDir,
        dbFile: opts.db,
      },
      overrides: matches,
    };
    fs.writeFileSync(opts.out, JSON.stringify(output, null, 2));
    console.log(`Output written: ${opts.out} (${Object.keys(matches).length} overrides)`);
  } else if (opts.dryRun) {
    console.log("Dry run — no output written");
  }
}
