#!/usr/bin/env node
/**
 * Extract Name Rename Map from String-Leaking Patterns
 *
 * Scans split bundle files for patterns that leak readable names through string
 * literals (beyond MR() exports). Produces a JSON rename map compatible with
 * rename.mjs --batch.
 *
 * Patterns extracted:
 *   1. `this.name = "ReadableName"` in class constructors → class rename
 *   2. `X.displayName = "ReadableName"` → React context/component rename
 *
 * Usage:
 *   node extract-names.mjs [inputDir] [--out FILE] [--stats] [--exclude-existing FILE...]
 *
 * Examples:
 *   node extract-names.mjs                                           # scan default dir, print to stdout
 *   node extract-names.mjs ./split/ --out renames-names.json         # write to file
 *   node extract-names.mjs --stats                                   # print summary statistics
 *   node extract-names.mjs --exclude-existing renames-auto.json renames-v2.1.63.json
 */

import fs from "fs";
import path from "path";

const DEFAULT_INPUT_DIR = null; // require explicit path

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
  console.log(`Usage: node extract-names.mjs [inputDir] [options]

Scans split bundle files for name-leaking patterns and outputs a JSON rename
map { "minifiedVar": "readableName" }.

Patterns extracted:
  1. this.name = "X" in class constructors (error classes, etc.)
  2. X.displayName = "X" assignments (React contexts/components)

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
 * Returns a Map of minifiedVar -> readableName.
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
 * Extract class name renames from `this.name = "ReadableName"` in class bodies.
 *
 * Handles two patterns:
 *   1. class X extends Y { constructor(...) { ... this.name = "Z" } }
 *   2. X = class [Name] extends Y { constructor(...) { ... this.name = "Z" } }
 *
 * Returns array of { minifiedVar, readableName, pattern, file }.
 */
function extractClassNames(content, file) {
  const results = [];

  // Pattern 1: class X extends ... { ... this.name = "Y" }
  // We search for `class <identifier>` then look ahead for `this.name = "<string>"`
  // within a reasonable window (constructor body).
  const classRe = /class\s+(\w+)\s+extends\s+\w+[^{]*\{/g;
  let match;

  while ((match = classRe.exec(content)) !== null) {
    const className = match[1];
    const startIdx = match.index + match[0].length;

    // Look within next 500 chars for this.name = "..."
    const window = content.substring(startIdx, startIdx + 500);
    const nameMatch = window.match(/this\.name\s*=\s*"([^"]+)"/);
    if (nameMatch) {
      results.push({
        minifiedVar: className,
        readableName: nameMatch[1],
        pattern: "class_decl",
        file,
      });
    }
  }

  // Pattern 2: X = class [Name] extends ... { ... this.name = "Y" }
  const assignRe = /(\w+)\s*=\s*class\s+(?:\w+\s+)?extends\s+\w+[^{]*\{/g;

  while ((match = assignRe.exec(content)) !== null) {
    const varName = match[1];
    const startIdx = match.index + match[0].length;

    const window = content.substring(startIdx, startIdx + 500);
    const nameMatch = window.match(/this\.name\s*=\s*"([^"]+)"/);
    if (nameMatch) {
      // Only add if not already found by pattern 1 with same var
      const existing = results.find(
        (r) => r.minifiedVar === varName && r.readableName === nameMatch[1]
      );
      if (!existing) {
        results.push({
          minifiedVar: varName,
          readableName: nameMatch[1],
          pattern: "class_assign",
          file,
        });
      }
    }
  }

  return results;
}

/**
 * Extract displayName assignments: X.displayName = "ReadableName"
 *
 * Returns array of { minifiedVar, readableName, pattern, file }.
 */
function extractDisplayNames(content, file) {
  const results = [];
  const re = /(\w+)\.displayName\s*=\s*"([^"]+)"/g;
  let match;

  while ((match = re.exec(content)) !== null) {
    results.push({
      minifiedVar: match[1],
      readableName: match[2],
      pattern: "displayName",
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

  const stat = fs.statSync(opts.inputDir);
  if (!stat.isDirectory()) {
    console.error(`Error: not a directory: ${opts.inputDir}`);
    process.exit(1);
  }

  // Collect all .js files (app only — skip vendor/)
  const files = fs
    .readdirSync(opts.inputDir)
    .filter((f) => f.endsWith(".js") && fs.statSync(path.join(opts.inputDir, f)).isFile())
    .sort();

  if (files.length === 0) {
    console.error(`Error: no .js files found in ${opts.inputDir}`);
    process.exit(1);
  }

  // Load existing renames
  const existingRenames = loadExistingRenames(opts.excludeFiles);

  // Stats counters
  const stats = {
    classDecl: 0,
    classAssign: 0,
    displayName: 0,
    skippedHashName: 0,
    skippedShortVar: 0,
    skippedExisting: 0,
    skippedConflicts: 0,
    skippedSameName: 0,
    skippedDuplicateName: 0,
  };
  const warnings = [];

  // varMap: minifiedVar -> [{ readableName, pattern, file }]
  const varMap = new Map();

  for (const file of files) {
    const filePath = path.join(opts.inputDir, file);
    const content = fs.readFileSync(filePath, "utf-8");

    const classNames = extractClassNames(content, file);
    const displayNames = extractDisplayNames(content, file);

    for (const entry of [...classNames, ...displayNames]) {
      // Count by pattern
      if (entry.pattern === "class_decl") stats.classDecl++;
      else if (entry.pattern === "class_assign") stats.classAssign++;
      else if (entry.pattern === "displayName") stats.displayName++;

      // Skip names starting with # (DOM node names like #document, #text)
      if (entry.readableName.startsWith("#")) {
        stats.skippedHashName++;
        continue;
      }

      // Skip single-char minified vars (too risky for false positives)
      if (entry.minifiedVar.length === 1) {
        stats.skippedShortVar++;
        continue;
      }

      // Skip when var name already equals readable name (no-op rename)
      if (entry.minifiedVar === entry.readableName) {
        stats.skippedSameName++;
        continue;
      }

      // Skip if already in existing rename maps
      if (existingRenames.has(entry.minifiedVar)) {
        const existingTarget = existingRenames.get(entry.minifiedVar);
        if (existingTarget === entry.readableName) {
          stats.skippedExisting++;
        } else {
          stats.skippedExisting++;
          warnings.push(
            `EXISTING CONFLICT: ${entry.minifiedVar} -> "${entry.readableName}" (ours) vs "${existingTarget}" (existing)`
          );
        }
        continue;
      }

      if (!varMap.has(entry.minifiedVar)) {
        varMap.set(entry.minifiedVar, []);
      }
      varMap.get(entry.minifiedVar).push(entry);
    }
  }

  // Build the final rename map, handling conflicts
  const renameMap = {};

  for (const [minifiedVar, entries] of varMap) {
    const uniqueNames = [...new Set(entries.map((e) => e.readableName))];

    if (uniqueNames.length === 1) {
      renameMap[minifiedVar] = uniqueNames[0];
    } else {
      // Conflict: same minifiedVar maps to different names
      stats.skippedConflicts++;
      const details = entries
        .map((e) => `${e.readableName} (${e.pattern} in ${e.file})`)
        .join(", ");
      warnings.push(`CONFLICT: ${minifiedVar} -> ${details}`);
    }
  }

  // Check for duplicate target names (different vars -> same name)
  const targetToVars = new Map();
  for (const [v, name] of Object.entries(renameMap)) {
    if (!targetToVars.has(name)) targetToVars.set(name, []);
    targetToVars.get(name).push(v);
  }
  for (const [name, vars] of targetToVars) {
    if (vars.length > 1) {
      stats.skippedDuplicateName++;
      warnings.push(
        `DUPLICATE TARGET: "${name}" <- ${vars.join(", ")} (keeping all — rename.mjs handles scope)`
      );
    }
  }

  // Print warnings to stderr
  if (warnings.length > 0) {
    console.error(`\n--- Warnings (${warnings.length}) ---`);
    for (const w of warnings) {
      console.error(`  ${w}`);
    }
    console.error("");
  }

  // Print stats to stderr if requested
  if (opts.stats) {
    const included = Object.keys(renameMap).length;
    console.error("--- Name Extraction Stats ---");
    console.error(`  Files scanned:                ${files.length}`);
    console.error(`  class X extends { this.name } ${stats.classDecl} (decl) + ${stats.classAssign} (assign)`);
    console.error(`  X.displayName = "..."         ${stats.displayName}`);
    console.error(`  Skipped (# prefix):           ${stats.skippedHashName}`);
    console.error(`  Skipped (short var):          ${stats.skippedShortVar}`);
    console.error(`  Skipped (same name):          ${stats.skippedSameName}`);
    console.error(`  Skipped (in existing):        ${stats.skippedExisting}`);
    console.error(`  Skipped (conflicts):          ${stats.skippedConflicts}`);
    console.error(`  Duplicate targets:            ${stats.skippedDuplicateName}`);
    console.error(`  Included in output:           ${included}`);
    console.error("-----------------------------");
  }

  // Output the rename map (sorted by key for readability)
  const sorted = {};
  for (const key of Object.keys(renameMap).sort()) {
    sorted[key] = renameMap[key];
  }
  const output = JSON.stringify(sorted, null, 2) + "\n";

  if (opts.outFile) {
    fs.writeFileSync(opts.outFile, output, "utf-8");
    console.error(
      `Wrote ${Object.keys(sorted).length} renames to ${opts.outFile}`
    );
  } else {
    process.stdout.write(output);
  }
}

main();
