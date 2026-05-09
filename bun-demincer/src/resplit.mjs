#!/usr/bin/env node
/**
 * resplit.mjs — Module-Level Splitter with Dependency Graph & Vendor Flood-Fill
 *
 * Isolates every y()/h() wrapper from a Bun bundle into its own file,
 * builds a full dependency graph, and extracts export mappings.
 *
 * Usage:
 *   node resplit.mjs <bundle.js> [output-dir]
 *   node resplit.mjs --reassemble <resplit-dir> [output-file]
 *
 * Output:
 *   resplit/
 *     00-runtime.js            # bundler runtime helpers
 *     0001_createApiClient.js   # individual app modules (1 per wrapper)
 *     0042.js                  # anonymous module (no MR() exports)
 *     99-main.js               # entry point / trailing code
 *     vendor/
 *       zod/                   # individual vendor modules per package
 *         0001.js
 *         0002_ZodString.js
 *       _unidentified/         # vendor modules with no package match
 *     graph.json               # full dependency graph
 *     manifest.json            # metadata, module index, vendor mapping
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, dirname } from "path";

// ─── Reassembly mode ────────────────────────────────────────────────────────

if (process.argv[2] === "--reassemble") {
  const splitDir = process.argv[3];
  const outFile = process.argv[4] || join(splitDir, "..", "reassembled.js");
  if (!splitDir) {
    console.error("Usage: node resplit.mjs --reassemble <resplit-dir> [output-file]");
    process.exit(1);
  }
  reassemble(splitDir, outFile);
  process.exit(0);
}

function reassemble(splitDir, outFile) {
  const manifestPath = join(splitDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`manifest.json not found in ${splitDir}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));
  const sourceOrder = manifest.sourceOrder;
  if (!sourceOrder || sourceOrder.length === 0) {
    console.error("manifest.json has no sourceOrder");
    process.exit(1);
  }

  console.log(`Reassembling from ${splitDir}...`);

  // All modules (app + vendor) are individual files — read and strip header.
  const fileCache = new Map();
  function readFile(filename) {
    if (!fileCache.has(filename)) {
      const p = join(splitDir, filename);
      fileCache.set(filename, existsSync(p) ? readFileSync(p, "utf-8") : "");
    }
    return fileCache.get(filename);
  }

  // Reassemble in source order
  const parts = [];
  for (const entry of sourceOrder) {
    if (entry.type === "runtime" || entry.type === "main") {
      parts.push(readFile(entry.file));
    } else {
      // App or vendor module — individual file, strip header
      let content = readFile(entry.file);
      content = content.replace(/^\/\/ resplit: .+\n/, "");
      parts.push(content);
    }
  }

  const inner = parts.join("");
  const wrapped = `// @bun @bytecode @bun-cjs\n(function(exports, require, module, __filename, __dirname) {${inner}})`;

  writeFileSync(outFile, wrapped);
  console.log(`Wrote ${(wrapped.length / 1024 / 1024).toFixed(1)}MB to ${outFile}`);
  console.log("Done!");
}

// ─── Normal resplit mode ────────────────────────────────────────────────────

const srcPath = process.argv[2];
const outDir = process.argv[3] || "./resplit";

if (!srcPath) {
  console.error("Usage: node resplit.mjs <bundle.js> [output-dir]");
  console.error("       node resplit.mjs --reassemble <resplit-dir> [output-file]");
  process.exit(1);
}

console.log(`Reading ${srcPath}...`);
let src = readFileSync(srcPath, "utf-8");
console.log(`Source: ${(src.length / 1024 / 1024).toFixed(1)}MB`);

// Strip any existing split.mjs comments (the extracted file may have them)
src = src.replace(/\n\/\/ === (?:module|lazy|gap): \S+ ===\n/g, "\n");
src = src.replace(/\n\/\/ =+ \S+ =+\n/g, "\n");

mkdirSync(outDir, { recursive: true });

// ─── Step 1: Strip outer CJS wrapper ────────────────────────────────────────

let code = src;
const cjsPrefix = /^\s*\/\/[^\n]*\n\(function\(exports,\s*require,\s*module,\s*__filename,\s*__dirname\)\s*\{/;
const cjsMatch = code.match(cjsPrefix);
if (cjsMatch) {
  code = code.slice(cjsMatch[0].length);
  code = code.replace(/\}\)\s*$/, "");
  console.log("Stripped outer CJS wrapper");
}

// ─── Step 2: Build line offset index ────────────────────────────────────────

const lineOffsets = [0];
for (let i = 0; i < src.length; i++) {
  if (src[i] === "\n") lineOffsets.push(i + 1);
}
const wrapperOffset = cjsMatch ? cjsMatch[0].length : 0;

function charOffsetToLine(offsetInCode) {
  const srcOffset = offsetInCode + wrapperOffset;
  let lo = 0,
    hi = lineOffsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lineOffsets[mid] <= srcOffset) lo = mid;
    else hi = mid - 1;
  }
  return lo + 1;
}

// ─── Step 3: Auto-detect wrapper function names ─────────────────────────────

const preamble = code.slice(0, 5000);

// Auto-detect __commonJS: (P1, P2) => () => (P2 || P1((P2 = {exports: {}}).exports, P2), P2.exports)
// Parameter names vary per build (T,R in some versions, p,x in others)
// Leading context varies: comma-separated (,y=) or var-declared (var I=)
const ID = "[A-Za-z_$][A-Za-z0-9_$]*";
const factoryMatch = preamble.match(
  new RegExp(`(?:,|var\\s+)(${ID})\\s*=\\s*\\((${ID}),\\s*(${ID})\\)\\s*=>\\s*\\(\\)\\s*=>\\s*\\(\\s*\\3\\s*\\|\\|\\s*\\2\\s*\\(\\s*\\(\\s*\\3\\s*=\\s*\\{\\s*exports\\s*:\\s*\\{\\s*\\}`)
);
const factoryFn = factoryMatch ? factoryMatch[1] : null;

// Auto-detect __esm: (P1, P2) => () => (P1 && (P2 = P1(P1 = 0)), P2)
const lazyMatch = preamble.match(
  new RegExp(`(?:,|var\\s+)(${ID})\\s*=\\s*\\((${ID}),\\s*(${ID})\\)\\s*=>\\s*\\(\\)\\s*=>\\s*\\(\\s*\\2\\s*&&\\s*\\(\\s*\\3\\s*=\\s*\\2\\s*\\(\\s*\\2\\s*=\\s*0\\s*\\)\\s*\\)\\s*,\\s*\\3\\s*\\)`)
);
const lazyFn = lazyMatch ? lazyMatch[1] : null;

const modFn = factoryFn || "y";
const lazFn = lazyFn || "h";
console.log(`Module factory: ${modFn}() | Lazy initializer: ${lazFn}()`);

function escRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// ─── Step 4: Find all module wrappers ───────────────────────────────────────

const modules = [];
let m;

const modRegex = new RegExp(
  `var\\s+([A-Za-z0-9_$]+)\\s*=\\s*${escRe(modFn)}\\s*\\(`,
  "g"
);
while ((m = modRegex.exec(code)) !== null) {
  modules.push({
    type: "cjs",
    name: m[1],
    declStart: m.index,
    factoryStart: m.index + m[0].length,
  });
}

const lazRegex = new RegExp(
  `var\\s+([A-Za-z0-9_$]+)\\s*=\\s*${escRe(lazFn)}\\s*\\(`,
  "g"
);
while ((m = lazRegex.exec(code)) !== null) {
  modules.push({
    type: "esm",
    name: m[1],
    declStart: m.index,
    factoryStart: m.index + m[0].length,
  });
}

// Sort by position in source
modules.sort((a, b) => a.declStart - b.declStart);
console.log(
  `Found ${modules.filter((m) => m.type === "cjs").length} CJS (${modFn}) + ${modules.filter((m) => m.type === "esm").length} ESM (${lazFn}) = ${modules.length} total modules`
);

// Build module variable name set for dependency detection
const moduleVarSet = new Set(modules.map((m) => m.name));

// ─── Step 5: Extract module content & between-wrapper code ──────────────────

// Each module's content runs from its declStart to the next module's declStart.
// The "trailing" code after the wrapper closing (hoisted vars, MR() calls, etc.)
// is part of this module — it sits between the wrapper's close and the next wrapper's start.

for (let i = 0; i < modules.length; i++) {
  const mod = modules[i];
  const nextStart =
    i + 1 < modules.length ? modules[i + 1].declStart : code.length;
  mod.content = code.slice(mod.declStart, nextStart);
  mod.endPos = nextStart;
  mod.srcLineStart = charOffsetToLine(mod.declStart);
  mod.srcLineEnd = charOffsetToLine(nextStart - 1);
  mod.srcCharStart = mod.declStart + wrapperOffset;
  mod.srcCharEnd = nextStart + wrapperOffset;
  mod.size = mod.content.length;
}

// ─── Step 6: Extract MR() export names per module ───────────────────────────

const GENERIC_NAMES = new Set([
  "call",
  "default",
  "get",
  "set",
  "init",
  "run",
  "exec",
  "then",
  "next",
  "done",
  "type",
  "name",
  "value",
  "data",
  "error",
  "result",
  "options",
  "config",
]);

/**
 * Extract MR() export mappings from content.
 * Returns { exports: { exportName: localVar }, primaryName: string|null }
 */
function extractModuleExports(content) {
  const exports = {};
  const mrCallRe = /MR\([^,]+,\s*\{/g;
  let match;

  while ((match = mrCallRe.exec(content)) !== null) {
    const startIdx = match.index + match[0].length;
    let depth = 1;
    let endIdx = startIdx;

    while (endIdx < content.length && depth > 0) {
      const ch = content[endIdx];
      if (ch === "{") depth++;
      else if (ch === "}") depth--;
      endIdx++;
    }

    if (depth !== 0) continue;

    const body = content.substring(startIdx, endIdx - 1);
    const pairRe =
      /([A-Za-z_$][A-Za-z0-9_$]*):\s*\(\)\s*=>\s*([A-Za-z_$][A-Za-z0-9_$]*)/g;
    let pairMatch;

    while ((pairMatch = pairRe.exec(body)) !== null) {
      exports[pairMatch[1]] = pairMatch[2];
    }
  }

  // Select primary name: longest non-generic CamelCase/snake_case name
  let primaryName = null;
  let bestLen = 0;
  for (const name of Object.keys(exports)) {
    if (GENERIC_NAMES.has(name)) continue;
    if (name.length <= 2) continue;
    if (name.length > bestLen) {
      bestLen = name.length;
      primaryName = name;
    }
  }

  return { exports, primaryName };
}

// Build export map for all modules
let totalExports = 0;
let namedModules = 0;
for (const mod of modules) {
  const { exports, primaryName } = extractModuleExports(mod.content);
  mod.exports = exports;
  mod.primaryName = primaryName;
  mod.exportNames = Object.keys(exports);
  totalExports += mod.exportNames.length;
  if (primaryName) namedModules++;
}
console.log(
  `Exports: ${totalExports} total across ${modules.length} modules, ${namedModules} have a primary name`
);

// ─── Step 7: Build dependency graph ─────────────────────────────────────────

// For each module, find references to other module variables
// Pattern: any call to a known module variable — VARNAME() or v(VARNAME(), 1)

function extractDependencies(content, selfName) {
  const deps = new Set();

  // Match identifier calls: VARNAME() — but need to be careful to match
  // only standalone calls, not property access (obj.VARNAME)
  // We look for: start of string or non-word/non-dot char, then VARNAME(
  const callRe = /(?:^|[^.\w$])([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/g;
  let match;

  while ((match = callRe.exec(content)) !== null) {
    const name = match[1];
    if (name === selfName) continue;
    if (moduleVarSet.has(name)) {
      deps.add(name);
    }
  }

  return [...deps];
}

let totalEdges = 0;
for (const mod of modules) {
  mod.deps = extractDependencies(mod.content, mod.name);
  totalEdges += mod.deps.length;
}

const avgDeps = modules.length > 0 ? (totalEdges / modules.length).toFixed(1) : 0;
console.log(
  `Dependency graph: ${totalEdges} edges, avg ${avgDeps} deps/module`
);

// ─── Step 8: Write output files ─────────────────────────────────────────────
// Note: Vendor classification is NOT done here. Use match-vendors.mjs --classify
// after resplit to identify and move vendor modules.

const manifestModules = {};

// 10a: Write runtime preamble
const preambleContent = code.slice(
  0,
  modules.length > 0 ? modules[0].declStart : code.length
);
if (preambleContent.trim().length > 0) {
  writeFileSync(join(outDir, "00-runtime.js"), preambleContent);
  console.log(
    `  00-runtime.js (${(preambleContent.length / 1024).toFixed(1)}KB)`
  );
}

// 10b: Assign filenames to all modules (sequential, source-ordered)
let modIdx = 1;
for (const mod of modules) {
  const idxStr = String(modIdx).padStart(4, "0");
  const suffix = mod.primaryName ? `_${mod.primaryName}` : "";
  mod.file = `${idxStr}${suffix}.js`;
  mod.index = modIdx;
  modIdx++;
}

// 10c: Write individual module files
for (const mod of modules) {
  const header = `// resplit: ${mod.type} module ${mod.name} | exports: ${mod.exportNames.join(", ") || "(none)"} | deps: ${mod.deps.join(", ") || "(none)"}\n`;
  writeFileSync(join(outDir, mod.file), header + mod.content);
}
console.log(`  ${modIdx - 1} module files written`);

// 10e: Write trailing code (main execution)
const lastEnd =
  modules.length > 0 ? modules[modules.length - 1].endPos : 0;
const trailing = code.slice(lastEnd).trim();
if (trailing.length > 0) {
  writeFileSync(join(outDir, "99-main.js"), trailing);
  console.log(
    `  99-main.js (${(trailing.length / 1024).toFixed(1)}KB)`
  );
}

// 10f: Build sourceOrder (for reassembly) and fileOrder (for listing)
// sourceOrder: every module in original source position order, with file/name info
const sourceOrder = [];
if (preambleContent.trim().length > 0) {
  sourceOrder.push({ type: "runtime", file: "00-runtime.js" });
}
for (const mod of modules) {
  sourceOrder.push({
    type: "module",
    name: mod.name,
    file: mod.file,
  });
}
if (trailing.length > 0) {
  sourceOrder.push({ type: "main", file: "99-main.js" });
}

// fileOrder: unique file list for reference
const fileOrder = [];
if (preambleContent.trim().length > 0) fileOrder.push("00-runtime.js");
const seenFiles = new Set();
for (const mod of modules) {
  if (!seenFiles.has(mod.file)) {
    seenFiles.add(mod.file);
    fileOrder.push(mod.file);
  }
}
if (trailing.length > 0) fileOrder.push("99-main.js");

// Build manifest module entries
for (const mod of modules) {
  manifestModules[mod.name] = {
    index: mod.index,
    file: mod.file,
    type: mod.type,
    exports: mod.exportNames,
    primaryName: mod.primaryName,
    vendor: false,
    deps: mod.deps,
    srcLine: mod.srcLineStart,
    size: mod.size,
  };
}

// ─── Step 11: Write graph.json ──────────────────────────────────────────────

const graphModules = {};
for (const mod of modules) {
  graphModules[mod.name] = {
    deps: mod.deps,
    type: mod.type,
  };
}

const graph = {
  modules: graphModules,
  stats: {
    totalModules: modules.length,
    totalEdges,
    avgDeps: parseFloat(avgDeps),
    cjsModules: modules.filter((m) => m.type === "cjs").length,
    esmModules: modules.filter((m) => m.type === "esm").length,
  },
};

writeFileSync(join(outDir, "graph.json"), JSON.stringify(graph, null, 2));
console.log(`  graph.json (${modules.length} modules, ${totalEdges} edges)`);

// ─── Step 12: Write manifest.json ───────────────────────────────────────────

const manifest = {
  _meta: {
    source: srcPath,
    sourceSize: src.length,
    wrapperOffset,
    generatedAt: new Date().toISOString(),
    tool: "resplit.mjs",
  },
  fileOrder,
  sourceOrder,
  modules: manifestModules,
  stats: graph.stats,
};

writeFileSync(
  join(outDir, "manifest.json"),
  JSON.stringify(manifest, null, 2)
);

// ─── Summary ────────────────────────────────────────────────────────────────

console.log(`\n=== Summary ===`);
console.log(`Total modules: ${modules.length}`);
console.log(`  Named (have primaryName): ${namedModules}`);
console.log(`  Anonymous: ${modules.length - namedModules}`);
const extraFiles = (preambleContent.trim().length > 0 ? 1 : 0) + (trailing.length > 0 ? 1 : 0);
console.log(`Total files: ${modules.length + extraFiles}`);
console.log(`Dependency graph: ${totalEdges} edges`);
console.log(`Output: ${outDir}/`);
console.log("Done!");
