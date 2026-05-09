#!/usr/bin/env node
/**
 * Extract Error Class Names from Throw Patterns and Factory Functions
 *
 * Scans decoded modules for error class patterns that extract-names.mjs misses:
 *   1. Error factory: `const X = fVT("ERR_CODE", "message")` — creates named error classes
 *   2. Error factory variants: similar patterns creating error subclasses
 *   3. `throw new X(...)` where X is minified — cross-references with class definitions
 *      that have `this.name = "Y"` to find matches not caught by extract-names
 *
 * Note: `class X extends Error { this.name = "Y" }` is already handled by extract-names.mjs.
 * This script covers additional patterns.
 *
 * Usage:
 *   node extract-errors.mjs <inputDir> [--out FILE] [--stats] [--exclude-existing FILE...]
 *
 * Examples:
 *   node extract-errors.mjs versions/2026-02-28_v2.1.63/decoded-resplit/ --stats
 *   node extract-errors.mjs ./decoded-resplit/ --out renames-errors.json
 */

import fs from "fs";
import path from "path";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    inputDir: null,
    outFile: null,
    stats: false,
    excludeFiles: [],
  };

  let i = 0;
  while (i < args.length) {
    if (args[i] === "--out") {
      opts.outFile = args[++i];
      i++;
    } else if (args[i] === "--stats") {
      opts.stats = true;
      i++;
    } else if (args[i] === "--exclude-existing") {
      i++;
      while (i < args.length && !args[i].startsWith("--")) {
        opts.excludeFiles.push(args[i]);
        i++;
      }
    } else if (args[i] === "--help" || args[i] === "-h") {
      printUsage();
      process.exit(0);
    } else if (!args[i].startsWith("--")) {
      opts.inputDir = args[i];
      i++;
    } else {
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
    }
  }

  if (!opts.inputDir) {
    console.error("Error: input directory is required (pass as first argument)");
    printUsage();
    process.exit(1);
  }

  return opts;
}

function printUsage() {
  console.log(`Usage: node extract-errors.mjs <inputDir> [options]

Scans decoded modules for error class patterns not caught by extract-names.mjs.
Produces a JSON rename map { "minifiedVar": "readableName" }.

Patterns extracted:
  1. Error factory: const X = fVT("ERR_CODE", "message") → X renamed to ErrorCode
  2. throw new X(...) cross-referenced with class definitions

Arguments:
  inputDir                   Directory containing .js files to scan (required)

Options:
  --out FILE                 Write JSON output to FILE instead of stdout
  --stats                    Print summary statistics to stderr
  --exclude-existing FILE... Skip vars already renamed in these JSON files
  -h, --help                 Show this help message`);
}

/**
 * Load existing rename maps to avoid conflicts.
 */
function loadExistingRenames(files) {
  const existing = new Map();
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`Warning: exclude file not found: ${file}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    for (const [key, val] of Object.entries(data)) {
      existing.set(key, val);
    }
  }
  return existing;
}

/**
 * Convert an error code like "ERR_STREAM_WRITE_AFTER_END" to a PascalCase class name.
 * Strips the ERR_ prefix and converts to PascalCase + "Error" suffix.
 */
function errorCodeToClassName(code) {
  // Remove ERR_ or ERR_FR_ prefix
  let cleaned = code.replace(/^ERR_(?:FR_)?/, "");
  // Convert UPPER_SNAKE_CASE to PascalCase
  const pascal = cleaned
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
  // Add Error suffix if not already present
  if (!pascal.endsWith("Error")) {
    return pascal + "Error";
  }
  return pascal;
}

/**
 * Convert an error message to a class name.
 * e.g., "write after end" → "WriteAfterEndError"
 */
function errorMessageToClassName(message) {
  // Take first few words (up to 5) to form a name
  const words = message
    .replace(/[^a-zA-Z0-9\s]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, 5);
  if (words.length === 0) return null;
  const pascal = words
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  if (!pascal.endsWith("Error")) {
    return pascal + "Error";
  }
  return pascal;
}

/**
 * Extract error factory patterns from a file.
 * Pattern: `const/let/var X = factoryFn("ERR_CODE", "message" [, parent])`
 * where factoryFn creates Error subclasses.
 */
function extractErrorFactories(content, file) {
  const results = [];

  // Generic factory pattern: VARNAME = someFn("ERR_...", "message" ...)
  // The factory function name itself may be minified, so match broadly
  const factoryRe =
    /(?:const|let|var)\s+(\w+)\s*=\s*(\w+)\(\s*"(ERR_[A-Z_]+)"\s*,\s*"([^"]+)"/g;
  let match;

  while ((match = factoryRe.exec(content)) !== null) {
    const varName = match[1];
    const factoryFn = match[2];
    const errorCode = match[3];
    const errorMessage = match[4];

    // Skip single-char vars
    if (varName.length === 1) continue;

    // Generate readable name from error code
    const readableName = errorCodeToClassName(errorCode);
    if (!readableName) continue;

    results.push({
      minifiedVar: varName,
      readableName,
      pattern: "error_factory",
      errorCode,
      errorMessage,
      factoryFn,
      file,
    });
  }

  return results;
}

/**
 * Extract error classes defined with class X extends Error/SomeError
 * that DON'T have this.name = "..." (those are caught by extract-names.mjs).
 * Instead, look for other identification patterns.
 */
function extractUnnamedErrorClasses(content, file) {
  const results = [];

  // Pattern: class X extends Error {} (empty body or no this.name)
  const classRe = /(?:class\s+(\w+)|(\w+)\s*=\s*class\s+\w*)\s+extends\s+(\w+)\s*\{/g;
  let match;

  while ((match = classRe.exec(content)) !== null) {
    const className = match[1] || match[2];
    const parentClass = match[3];
    const startIdx = match.index + match[0].length;

    // Check if this class has this.name = "..." (already handled by extract-names)
    const window = content.substring(startIdx, startIdx + 500);
    if (window.match(/this\.name\s*=\s*"/)) continue;

    // Skip single-char vars
    if (className.length <= 1) continue;
    // Skip already readable names
    if (className.length > 5 && /[a-z]/.test(className)) continue;

    // Try to infer name from parent class
    if (parentClass === "Error" || parentClass === "TypeError" || parentClass === "RangeError") {
      // No this.name and extends basic Error — try to infer from context
      // Look for static properties or usage patterns
      const staticNameMatch = content.match(
        new RegExp(`${className}\\.name\\s*=\\s*"([^"]+)"`)
      );
      if (staticNameMatch) {
        results.push({
          minifiedVar: className,
          readableName: staticNameMatch[1],
          pattern: "error_static_name",
          file,
        });
      }
    }
  }

  return results;
}

/**
 * Find throw sites with minified constructor names and try to infer
 * readable names from error messages.
 */
function extractThrowPatterns(content, file) {
  const results = [];

  // throw new X("descriptive message") where X is short (2-4 chars)
  const throwRe = /throw\s+new\s+([A-Z]\w{1,3})\(\s*"([^"]{5,100})"/g;
  let match;

  while ((match = throwRe.exec(content)) !== null) {
    const className = match[1];
    const errorMessage = match[2];

    // Only consider truly minified names (2-4 chars, mostly uppercase)
    if (className.length > 4) continue;

    // Check if this class has a this.name = "..." definition in the same file
    const nameDefRe = new RegExp(
      `class\\s+${className}|${className}\\s*=\\s*class`
    );
    if (nameDefRe.test(content)) {
      // Class is defined here — extract-names.mjs or error_factory should handle it
      continue;
    }

    results.push({
      minifiedVar: className,
      errorMessage,
      pattern: "throw_site",
      file,
    });
  }

  return results;
}

function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.inputDir)) {
    console.error(`Error: input directory not found: ${opts.inputDir}`);
    process.exit(1);
  }

  // Collect app .js files only (skip vendor/ — no renames generated from vendor code)
  const files = fs
    .readdirSync(opts.inputDir)
    .filter((f) => f.endsWith(".js"))
    .sort();

  if (files.length === 0) {
    console.error(`Error: no .js files found in ${opts.inputDir}`);
    process.exit(1);
  }

  const existingRenames = loadExistingRenames(opts.excludeFiles);

  const stats = {
    errorFactory: 0,
    errorStaticName: 0,
    throwSite: 0,
    skippedExisting: 0,
    skippedConflicts: 0,
    skippedSameName: 0,
  };
  const warnings = [];

  // varMap: minifiedVar -> [{ readableName, pattern, file }]
  const varMap = new Map();
  // Also collect throw sites for reporting (may not yield renames)
  const throwSites = [];

  for (const file of files) {
    const filePath = path.join(opts.inputDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    const factories = extractErrorFactories(content, file);
    const unnamed = extractUnnamedErrorClasses(content, file);
    const throws = extractThrowPatterns(content, file);

    for (const entry of [...factories, ...unnamed]) {
      if (entry.pattern === "error_factory") stats.errorFactory++;
      else if (entry.pattern === "error_static_name") stats.errorStaticName++;

      // Skip if var name already equals readable name
      if (entry.minifiedVar === entry.readableName) {
        stats.skippedSameName++;
        continue;
      }

      // Skip if already in existing rename maps
      if (existingRenames.has(entry.minifiedVar)) {
        stats.skippedExisting++;
        continue;
      }

      if (!varMap.has(entry.minifiedVar)) {
        varMap.set(entry.minifiedVar, []);
      }
      varMap.get(entry.minifiedVar).push(entry);
    }

    for (const t of throws) {
      stats.throwSite++;
      throwSites.push(t);
    }
  }

  // Build the final rename map
  const renameMap = {};

  for (const [minifiedVar, entries] of varMap) {
    const uniqueNames = [...new Set(entries.map((e) => e.readableName))];

    if (uniqueNames.length === 1) {
      renameMap[minifiedVar] = uniqueNames[0];
    } else {
      stats.skippedConflicts++;
      const details = entries
        .map((e) => `${e.readableName} (${e.pattern} in ${e.file})`)
        .join(", ");
      warnings.push(`CONFLICT: ${minifiedVar} -> ${details}`);
    }
  }

  // Print unmatched throw sites (for manual review)
  const unmatchedThrows = throwSites.filter(
    (t) => !renameMap[t.minifiedVar] && !existingRenames.has(t.minifiedVar),
  );
  if (unmatchedThrows.length > 0) {
    console.error(
      `\n--- Unmatched Throw Sites (${unmatchedThrows.length}, for manual review) ---`,
    );
    for (const t of unmatchedThrows) {
      console.error(
        `  throw new ${t.minifiedVar}("${t.errorMessage.substring(0, 60)}...") in ${t.file}`,
      );
    }
    console.error("");
  }

  // Print warnings
  if (warnings.length > 0) {
    console.error(`\n--- Warnings (${warnings.length}) ---`);
    for (const w of warnings) {
      console.error(`  ${w}`);
    }
    console.error("");
  }

  // Print stats
  if (opts.stats) {
    const included = Object.keys(renameMap).length;
    console.error("--- Error Extraction Stats ---");
    console.error(`  Files scanned:            ${files.length}`);
    console.error(`  Error factory patterns:   ${stats.errorFactory}`);
    console.error(`  Error static names:       ${stats.errorStaticName}`);
    console.error(`  Throw sites (minified):   ${stats.throwSite}`);
    console.error(`  Skipped (same name):      ${stats.skippedSameName}`);
    console.error(`  Skipped (in existing):    ${stats.skippedExisting}`);
    console.error(`  Skipped (conflicts):      ${stats.skippedConflicts}`);
    console.error(`  Included in output:       ${included}`);
    console.error("------------------------------");
  }

  // Output the rename map
  const sorted = {};
  for (const key of Object.keys(renameMap).sort()) {
    sorted[key] = renameMap[key];
  }
  const output = JSON.stringify(sorted, null, 2) + "\n";

  if (opts.outFile) {
    fs.writeFileSync(opts.outFile, output, "utf-8");
    console.error(
      `Wrote ${Object.keys(sorted).length} renames to ${opts.outFile}`,
    );
  } else {
    process.stdout.write(output);
  }
}

main();
