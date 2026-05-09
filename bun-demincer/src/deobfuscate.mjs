#!/usr/bin/env node
/**
 * Full Deobfuscation Pipeline for Bun Bundle Chunks
 *
 * Runs a multi-stage pipeline to transform minified split files into
 * beautifully formatted, human-readable code.
 *
 * Stages:
 *   1. wakaru unminify — structural transforms (!0→true, void 0→undefined,
 *      split comma exprs, restore ?./??/, var→const/let, arrow functions)
 *   2. lebab — ES5→ES6+ (safety net for anything wakaru missed:
 *      arrow, obj-shorthand, for-of, etc.)
 *   3. extract — auto-generate rename map from MR() export mappings
 *   3b. extract-names — auto-generate renames from this.name/displayName patterns
 *   4. rename.mjs — our AST-based identifier rename pass (batch JSON)
 *   5. prettier — final consistent formatting
 *
 * Usage:
 *   node deobfuscate.mjs --dir versions/2026-02-28_v2.1.63/decoded/
 *   node deobfuscate.mjs --dir decoded/ --batch renames-v2.1.63.json
 *   node deobfuscate.mjs --dir decoded/ --skip wakaru --skip lebab
 *   node deobfuscate.mjs --dir decoded/ --only prettier
 */

import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { execSync, spawnSync } from "child_process";
import { createRequire } from "module";

const require = createRequire(import.meta.url);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// @wakaru/unminify ESM dist has a broken prettier import (no .js extension),
// so we use CJS require which resolves fine.
const { runTransformationRules } = require("@wakaru/unminify");

// ── Argument parsing ──────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const defaultSkip = new Set(["lebab"]);
  const opts = {
    dir: null,
    manifest: null, // path to manifest.json for collision resolution
    batch: [],  // multiple batch files supported
    skip: defaultSkip,
    only: null, // if set, run only this stage
    concurrency: 4,
    strictWakaru: false,
    wakaruRules: null, // null => SAFE_WAKARU_RULES, [] => no rules, [..] => explicit
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case "--dir":
        opts.dir = args[++i];
        i++;
        break;
      case "--batch":
        opts.batch.push(args[++i]);
        i++;
        break;
      case "--skip":
        opts.skip.add(args[++i]);
        i++;
        break;
      case "--only":
        opts.only = args[++i];
        i++;
        break;
      case "--manifest":
        opts.manifest = args[++i];
        i++;
        break;
      case "--concurrency":
        opts.concurrency = parseInt(args[++i], 10);
        i++;
        break;
      case "--strict-wakaru":
        opts.strictWakaru = true;
        i++;
        break;
      case "--wakaru-rules": {
        const raw = args[++i];
        if (raw === undefined) {
          console.error("Error: --wakaru-rules requires a value");
          process.exit(1);
        }
        if (raw.trim().toLowerCase() === "none") {
          opts.wakaruRules = [];
        } else {
          opts.wakaruRules = raw
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
        }
        i++;
        break;
      }
      case "--help":
      case "-h":
        printUsage();
        process.exit(0);
      default:
        console.error(`Unknown option: ${args[i]}`);
        printUsage();
        process.exit(1);
    }
  }

  if (!opts.dir) {
    console.error("Error: --dir is required");
    printUsage();
    process.exit(1);
  }

  return opts;
}

function printUsage() {
  console.log(`
Usage: node deobfuscate.mjs --dir <path> [options]

Options:
  --dir <path>         Directory containing split .js files (required)
  --batch <path>       Rename JSON file for the rename stage
  --manifest <path>    Manifest JSON for collision resolution (auto-detected if in --dir)
  --skip <stage>       Skip a stage (wakaru, lebab, extract, extract-names, rename, prettier)
  --only <stage>       Run only this stage
  --concurrency <n>    Max concurrent wakaru transforms (default: 4)
  --strict-wakaru      Keep only wakaru transforms that are syntax-valid and idempotent
  --wakaru-rules <v>   Comma-separated wakaru rules, or "none" for empty set
  -h, --help           Show this help

Stages: wakaru → lebab → extract → extract-names → rename → prettier
  lebab is skipped by default (wakaru's internal lebab rule handles safe transforms)
  extract auto-generates a rename map from MR() export mappings
  extract-names finds renames from this.name/displayName patterns
  `);
}

// ── Stage 1: wakaru unminify (programmatic API) ──────────────────

// Safe transform rules — excludes rules that break CJS bundles or conflict
// with our pipeline. Rule order matches wakaru's default pipeline order.
const SAFE_WAKARU_RULES = [
  // Semantic-safe profile only: rules below are local syntactic canonicalization
  // and avoid control-flow/scoping/evaluation-order rewrites.
  //
  // Explicitly excluded as semantically risky in this codebase:
  // - un-curly-braces: wraps switch cases/flow bodies and can change lexical scope.
  // - un-sequence-expression: rewrites control flow and evaluation order heavily.
  // - un-variable-merging: hoists/splits declarations with heuristic for-loops.
  // - un-assignment-merging: changes chained assignment order/value evaluation.
  // - un-infinity: replaces 1/0 with Identifier Infinity (shadowing hazard).
  // - un-flip-comparisons: swaps operand evaluation order.
  //
  // 'prettier' — skip, we have our own prettier stage
  // 'module-mapping' — skip, may interfere with module system
  "un-boolean",
  "un-typeof",
  "un-numeric-literal",
  "un-bracket-notation",
  // 'prettier-1' — skip, we have our own prettier stage
];

function validateJavaScriptSyntax(code, filename) {
  try {
    new vm.Script(code, { filename });
    return null;
  } catch (err) {
    return err;
  }
}

function resolveWakaruRules(wakaruRulesOpt) {
  if (Array.isArray(wakaruRulesOpt)) {
    return wakaruRulesOpt;
  }
  return SAFE_WAKARU_RULES;
}

async function stageWakaru(dir, files, concurrency, strictWakaru = false, wakaruRulesOpt = null) {
  const activeRules = resolveWakaruRules(wakaruRulesOpt);
  console.log("\n━━━ Stage 1: wakaru unminify ━━━");
  console.log(
    `  Using programmatic API with ${activeRules.length} rules` +
      (strictWakaru ? " (strict mode enabled)" : ""),
  );

  const LARGE_FILE_THRESHOLD = 500_000; // 500KB

  // Separate large files from normal ones
  const largeFiles = [];
  const normalFiles = [];
  for (const f of files) {
    const filePath = path.join(dir, f);
    const size = fs.statSync(filePath).size;
    if (size > LARGE_FILE_THRESHOLD) {
      largeFiles.push(f);
    } else {
      normalFiles.push(f);
    }
  }

  if (largeFiles.length > 0) {
    console.log(`  Large files (>500KB, serial): ${largeFiles.join(", ")}`);
  }

  let processed = 0;
  let errors = 0;

  // Transform a single file
  async function transformFile(f) {
    const filePath = path.join(dir, f);
    const source = fs.readFileSync(filePath, "utf-8");
    const tick = () => {
      process.stdout.write(
        `  ${path.basename(dir)}: ${processed + errors}/${files.length} files\r`
      );
    };

    try {
      const result = await runTransformationRules(
        { path: f, source },
        activeRules,
      );
      const transformedCode = result.code ?? source;

      if (strictWakaru && transformedCode !== source) {
        const syntaxErr = validateJavaScriptSyntax(transformedCode, f);
        if (syntaxErr) {
          console.warn(`  Warning: strict-wakaru rejected ${f} (syntax): ${syntaxErr.message}`);
          errors++;
          tick();
          return;
        }

        // Determinism gate: applying the same rules again should be a no-op.
        const secondPass = await runTransformationRules(
          { path: f, source: transformedCode },
          activeRules,
        );
        const secondCode = secondPass.code ?? transformedCode;
        if (secondCode !== transformedCode) {
          console.warn(`  Warning: strict-wakaru rejected ${f} (non-idempotent output)`);
          errors++;
          tick();
          return;
        }
      }

      if (transformedCode !== source) {
        fs.writeFileSync(filePath, transformedCode, "utf-8");
      }
      processed++;
    } catch (err) {
      console.warn(`  Warning: wakaru failed on ${f}: ${err.message}`);
      errors++;
    }
    tick();
  }

  // Process large files one at a time
  for (const f of largeFiles) {
    await transformFile(f);
  }

  // Process normal files in batches with concurrency
  for (let i = 0; i < normalFiles.length; i += concurrency) {
    const batch = normalFiles.slice(i, i + concurrency);
    await Promise.all(batch.map(transformFile));
  }
  console.log();

  console.log(
    `  Processed ${processed}/${files.length} files` +
      (errors > 0 ? ` (${errors} errors)` : "")
  );
  console.log("  Done.");
}

// ── Stage 2: lebab ────────────────────────────────────────────────

function stageLebab(dir, files) {
  console.log("\n━━━ Stage 2: lebab (ES5→ES6+) ━━━");

  const lebab = require("lebab");
  // Safe transforms only — these won't break code
  const transforms = [
    "arrow",
    "arrow-return",
    "for-of",
    "arg-rest",
    "arg-spread",
    "obj-method",
    "obj-shorthand",
    "no-strict",
    "multi-var",
  ];

  let changed = 0;
  let totalWarnings = 0;

  for (const f of files) {
    const filePath = path.join(dir, f);
    const code = fs.readFileSync(filePath, "utf-8");

    try {
      const result = lebab.transform(code, transforms);
      if (result.code !== code) {
        fs.writeFileSync(filePath, result.code, "utf-8");
        changed++;
      }
      totalWarnings += result.warnings.length;
    } catch (err) {
      console.warn(`  Warning: lebab failed on ${f}: ${err.message}`);
    }
  }

  console.log(`  Modified ${changed}/${files.length} files (${totalWarnings} warnings)`);
  console.log("  Done.");
}

// ── Stage 3: extract-exports (auto-rename map) ──────────────────

function stageExtract(dir) {
  console.log("\n━━━ Stage 3: extract (auto-rename from MR() exports) ━━━");

  const extractMjs = path.join(__dirname, "extract-exports.mjs");
  const outFile = path.join(dir, ".auto-renames.json");

  try {
    const result = execSync(
      `node "${extractMjs}" "${dir}" --out "${outFile}" --stats`,
      {
        cwd: __dirname,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60000,
      }
    );

    // --stats output goes to stderr
    if (!fs.existsSync(outFile)) {
      console.warn("  Warning: extract-exports produced no output file");
      return null;
    }

    const data = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    const count = Object.keys(data).length;
    console.log(`  Extracted ${count} auto-renames from MR() export mappings`);

    return outFile;
  } catch (err) {
    // Print any stats/info from stderr
    if (err.stderr) {
      const stats = err.stderr.toString().trim();
      if (stats) console.log(`  ${stats}`);
    }
    console.warn("  Warning: extract-exports failed, continuing without auto-renames");
    // Clean up partial output
    if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true });
    return null;
  }
}

// ── Stage 3b: extract-names (this.name/displayName patterns) ─────

function stageExtractNames(dir, existingBatchFiles) {
  console.log("\n━━━ Stage 3b: extract-names (this.name/displayName patterns) ━━━");

  const extractNamesMjs = path.join(__dirname, "extract-names.mjs");
  const outFile = path.join(dir, ".auto-names.json");

  // Build --exclude-existing args from all batch files collected so far
  const excludeArgs = existingBatchFiles
    .filter((f) => fs.existsSync(f))
    .map((f) => `"${f}"`)
    .join(" ");
  const excludeFlag = excludeArgs ? `--exclude-existing ${excludeArgs}` : "";

  try {
    execSync(
      `node "${extractNamesMjs}" "${dir}" --out "${outFile}" --stats ${excludeFlag}`,
      {
        cwd: __dirname,
        stdio: ["pipe", "pipe", "pipe"],
        timeout: 60000,
      }
    );

    if (!fs.existsSync(outFile)) {
      console.warn("  Warning: extract-names produced no output file");
      return null;
    }

    const data = JSON.parse(fs.readFileSync(outFile, "utf-8"));
    const count = Object.keys(data).length;
    console.log(`  Extracted ${count} auto-renames from name patterns`);

    return outFile;
  } catch (err) {
    if (err.stderr) {
      const stats = err.stderr.toString().trim();
      if (stats) console.log(`  ${stats}`);
    }
    console.warn("  Warning: extract-names failed, continuing without name renames");
    if (fs.existsSync(outFile)) fs.rmSync(outFile, { force: true });
    return null;
  }
}

// ── Stage 4: rename.mjs ──────────────────────────────────────────

/**
 * Extract all identifiers declared in a runtime/skip file.
 * These are Bun's module system plumbing (h, v, y, MR, etc.) referenced by
 * ALL modules including vendor — renaming them in app code would break vendor
 * code that still references the original names.
 */
function extractRuntimeIdentifiers(filePath) {
  const code = fs.readFileSync(filePath, "utf-8");
  const ids = new Set();
  // var declarations (including comma-separated: var A,B,C=...)
  for (const m of code.matchAll(/var\s+([\s\S]*?)(?=;(?:var\b|function\b|class\b|\s*$))/g)) {
    for (const id of m[1].matchAll(/([A-Za-z_$][\w$]*)\s*(?=[=,;])/g)) {
      ids.add(id[1]);
    }
  }
  // Standalone var without assignment
  for (const m of code.matchAll(/var\s+([A-Za-z_$][\w$]*)\s*[,;]/g)) ids.add(m[1]);
  // function declarations
  for (const m of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) ids.add(m[1]);
  // Destructured imports: var{x:alias,...}=Object
  for (const m of code.matchAll(/var\s*\{([^}]+)\}/g)) {
    for (const pair of m[1].split(",")) {
      const colonMatch = pair.match(/:\s*([A-Za-z_$][\w$]*)/);
      if (colonMatch) ids.add(colonMatch[1]);
      else {
        const plain = pair.trim().match(/^([A-Za-z_$][\w$]*)/);
        if (plain) ids.add(plain[1]);
      }
    }
  }
  // Remove built-in names that happen to appear
  for (const builtin of ["Object", "WeakMap", "exports", "TypeError", "Promise", "SuppressedError", "Symbol"]) {
    ids.delete(builtin);
  }
  return ids;
}

function stageRename(dir, batchFiles, manifestPath, skipFiles) {
  console.log("\n━━━ Stage 4: rename (AST identifier rename) ━━━");

  if (!batchFiles || batchFiles.length === 0) {
    console.log("  Skipped (no --batch file provided)");
    return;
  }

  const renameMjs = path.join(__dirname, "rename.mjs");

  // Merge all batch files into a single rename map
  const merged = {};
  for (const bf of batchFiles) {
    const batchPath = path.resolve(bf);
    if (!fs.existsSync(batchPath)) {
      console.warn(`  Warning: batch file not found: ${batchPath}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(batchPath, "utf-8"));
    Object.assign(merged, data);
  }

  if (Object.keys(merged).length === 0) {
    console.log("  Skipped (no renames to apply)");
    return;
  }

  // Exclude runtime identifiers — these are Bun module system globals referenced
  // by all files including vendor. Renaming them in app code would break vendor.
  const runtimeExclusions = new Set();
  for (const sf of skipFiles) {
    const sfPath = path.join(dir, sf);
    if (fs.existsSync(sfPath)) {
      for (const id of extractRuntimeIdentifiers(sfPath)) {
        runtimeExclusions.add(id);
      }
    }
  }
  const excluded = [];
  for (const id of runtimeExclusions) {
    if (id in merged) {
      excluded.push(`${id} → ${merged[id]}`);
      delete merged[id];
    }
  }
  if (excluded.length > 0) {
    console.log(`  Excluded ${excluded.length} runtime identifier(s): ${excluded.join(", ")}`);
  }

  if (Object.keys(merged).length === 0) {
    console.log("  Skipped (no renames to apply after exclusions)");
    return;
  }

  // Write merged renames to temp file
  const tmpBatch = path.join(dir, ".rename-batch-tmp.json");
  fs.writeFileSync(tmpBatch, JSON.stringify(merged, null, 2));

  const renameArgs = [
    renameMjs,
    "--batch",
    tmpBatch,
    "--dir",
    dir,
  ];
  if (manifestPath) {
    renameArgs.push("--manifest", manifestPath);
  }
  renameArgs.push("--smart");
  try {
    // Stream output live so long rename passes don't look "stuck".
    const result = spawnSync("node", renameArgs, {
      cwd: __dirname,
      stdio: "inherit",
      timeout: 600000,
    });

    if (result.error) {
      throw result.error;
    }
    if (result.signal) {
      throw new Error(`Rename process killed by signal ${result.signal}`);
    }
    if (typeof result.status === "number" && result.status !== 0) {
      throw new Error(`Rename stage failed with exit code ${result.status}`);
    }
  } catch (err) {
    throw new Error(err.message || "Rename stage failed");
  } finally {
    // Clean up
    fs.rmSync(tmpBatch, { force: true });
  }

  console.log("  Done.");
}

// ── Stage 5: prettier ─────────────────────────────────────────────

async function formatWithFallback(prettier, code) {
  const parsers = ["babel", "babel-flow", "meriyah", "acorn"];
  for (const parser of parsers) {
    try {
      return { result: await prettier.format(code, {
        parser,
        printWidth: 100,
        tabWidth: 2,
        semi: true,
        singleQuote: false,
        trailingComma: "all",
      }), parser };
    } catch (err) {
      // Try next parser
    }
  }
  return null; // all parsers failed
}

async function stagePrettier(dir, files) {
  console.log("\n━━━ Stage 5: prettier (final formatting) ━━━");

  const prettier = await import("prettier");

  let formatted = 0;
  let errors = 0;
  let fallbacks = 0;

  for (const f of files) {
    const filePath = path.join(dir, f);
    const code = fs.readFileSync(filePath, "utf-8");

    const formatted_result = await formatWithFallback(prettier, code);
    if (formatted_result) {
      if (formatted_result.parser !== "babel") {
        fallbacks++;
        console.log(`  Fallback: ${f} formatted with parser "${formatted_result.parser}"`);
      }
      if (formatted_result.result !== code) {
        fs.writeFileSync(filePath, formatted_result.result, "utf-8");
        formatted++;
      }
    } else {
      console.warn(`  Warning: prettier failed on ${f} (all parsers failed)`);
      errors++;
    }
  }

  console.log(
    `  Formatted ${formatted}/${files.length} files` +
    (fallbacks > 0 ? ` (${fallbacks} used fallback parser)` : "") +
    (errors > 0 ? ` (${errors} errors)` : "")
  );
  console.log("  Done.");
}

// ── Main ──────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const dir = path.resolve(opts.dir);

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  // Auto-detect manifest.json in --dir if not explicitly provided
  if (!opts.manifest) {
    const autoManifest = path.join(dir, "manifest.json");
    if (fs.existsSync(autoManifest)) {
      opts.manifest = autoManifest;
      console.log(`Auto-detected manifest: ${autoManifest}`);
    }
  }
  const manifestPath = opts.manifest ? path.resolve(opts.manifest) : null;

  // Find all app JS files (exclude manifest.json, vendor/, and special non-module
  // files like runtime/main that contain Bun internals and must not be transformed)
  const SKIP_FILES = new Set(["00-runtime.js", "99-main.js"]);
  const allFiles = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".js") && !SKIP_FILES.has(f))
    .sort();

  const vendorDir = path.join(dir, "vendor");
  const vendorCount = fs.existsSync(vendorDir)
    ? fs.readdirSync(vendorDir, { recursive: true }).filter(f => f.endsWith(".js")).length
    : 0;

  console.log(
    `Deobfuscation pipeline: ${allFiles.length} app files in ${dir}` +
    (vendorCount
      ? ` (structural stages skip ${vendorCount} vendor files; smart rename may update linked vendor references)`
      : "")
  );

  const stages = ["wakaru", "lebab", "extract", "extract-names", "rename", "prettier"];
  const activeStages = opts.only
    ? stages.filter((s) => s === opts.only)
    : stages.filter((s) => !opts.skip.has(s));

  console.log(`Active stages: ${activeStages.join(" → ")}`);

  const startTime = Date.now();
  let autoRenamesFile = null; // track for cleanup after rename
  let autoNamesFile = null;   // track for cleanup after rename

  for (const stage of activeStages) {
    const stageStart = Date.now();

    switch (stage) {
      case "wakaru":
        await stageWakaru(
          dir,
          allFiles,
          opts.concurrency,
          opts.strictWakaru,
          opts.wakaruRules,
        );
        break;
      case "lebab":
        stageLebab(dir, allFiles);
        break;
      case "extract":
        autoRenamesFile = stageExtract(dir);
        if (autoRenamesFile) {
          opts.batch.push(autoRenamesFile);
        }
        break;
      case "extract-names":
        autoNamesFile = stageExtractNames(dir, opts.batch);
        if (autoNamesFile) {
          opts.batch.push(autoNamesFile);
        }
        break;
      case "rename":
        stageRename(dir, opts.batch, manifestPath, SKIP_FILES);
        // Clean up auto-generated renames files
        if (autoRenamesFile) {
          fs.rmSync(autoRenamesFile, { force: true });
          autoRenamesFile = null;
        }
        if (autoNamesFile) {
          fs.rmSync(autoNamesFile, { force: true });
          autoNamesFile = null;
        }
        break;
      case "prettier":
        await stagePrettier(dir, allFiles);
        break;
    }

    const elapsed = ((Date.now() - stageStart) / 1000).toFixed(1);
    console.log(`  (${elapsed}s)`);
  }

  // Final cleanup in case rename was skipped but extract ran
  if (autoRenamesFile && fs.existsSync(autoRenamesFile)) {
    fs.rmSync(autoRenamesFile, { force: true });
  }
  if (autoNamesFile && fs.existsSync(autoNamesFile)) {
    fs.rmSync(autoNamesFile, { force: true });
  }

  const totalElapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log(`\nPipeline complete in ${totalElapsed}s`);
}

main().catch((err) => {
  console.error("Pipeline failed:", err);
  process.exit(1);
});
