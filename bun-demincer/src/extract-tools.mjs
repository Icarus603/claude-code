#!/usr/bin/env node
/**
 * Extract Tool/Command Names from userFacingName Patterns
 *
 * Scans decoded modules for tool and command configuration objects that contain
 * `userFacingName()` methods. Extracts tool metadata (name, type, description,
 * aliases) and produces both a tool index and a rename map for any still-minified
 * config variables.
 *
 * Patterns extracted:
 *   1. `userFacingName() { return "X"; }` — method returning string literal
 *   2. `userFacingName: () => "X"` — arrow returning string literal
 *   3. `userFacingName: () => VARIABLE` — arrow returning a variable (resolved if possible)
 *
 * Also extracts from the same config object:
 *   - `name: "X"` — internal tool/command name
 *   - `type: "X"` — tool type (local, local-jsx, prompt, etc.)
 *   - `description: "X"` or `description() { ... }` — tool description
 *   - `aliases: [...]` — command aliases
 *   - `source: "X"` — tool source
 *
 * Usage:
 *   node extract-tools.mjs <inputDir> [--out FILE] [--index FILE] [--stats]
 *
 * Examples:
 *   node extract-tools.mjs versions/2026-02-28_v2.1.63/decoded-resplit/ --stats
 *   node extract-tools.mjs ./decoded-resplit/ --out renames-tools.json --index tools-index.json
 */

import fs from "fs";
import path from "path";

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    inputDir: null,
    outFile: null,
    indexFile: null,
    stats: false,
  };

  let i = 0;
  while (i < args.length) {
    if (args[i] === "--out") {
      opts.outFile = args[++i];
      i++;
    } else if (args[i] === "--index") {
      opts.indexFile = args[++i];
      i++;
    } else if (args[i] === "--stats") {
      opts.stats = true;
      i++;
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
  console.log(`Usage: node extract-tools.mjs <inputDir> [options]

Scans decoded modules for tool/command config objects with userFacingName()
and extracts tool metadata. Outputs a rename map and/or tool index.

Arguments:
  inputDir                   Directory containing .js files to scan (required)

Options:
  --out FILE                 Write rename map JSON to FILE
  --index FILE               Write tool index JSON to FILE
  --stats                    Print summary statistics to stderr
  -h, --help                 Show this help message`);
}

/**
 * Try to resolve a variable reference to its string value in the same file.
 * Looks for patterns like: const VARIABLE = "value" or let VARIABLE = "value"
 */
function resolveVariable(content, varName) {
  // const/let/var VARIABLE = "value"
  const constRe = new RegExp(
    `(?:const|let|var)\\s+${escapeRegExp(varName)}\\s*=\\s*"([^"]*)"`,
  );
  const match = content.match(constRe);
  if (match) return match[1];

  // VARIABLE = "value" (assignment, not declaration)
  const assignRe = new RegExp(
    `(?:^|[;,{}])\\s*${escapeRegExp(varName)}\\s*=\\s*"([^"]*)"`,
    "m",
  );
  const assignMatch = content.match(assignRe);
  if (assignMatch) return assignMatch[1];

  return null;
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract the config object block surrounding a userFacingName occurrence.
 * Walks backward to find the opening `{` and forward to find the matching `}`.
 */
function extractConfigBlock(content, ufnIndex) {
  // Walk backward from userFacingName to find the config object start
  // Look for the opening `{` that starts this object, tracking brace depth
  let depth = 0;
  let blockStart = ufnIndex;

  for (let i = ufnIndex; i >= 0; i--) {
    const ch = content[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      if (depth === 0) {
        blockStart = i;
        break;
      }
      depth--;
    }
  }

  // Walk forward from blockStart to find the matching closing `}`
  depth = 0;
  let blockEnd = blockStart;

  for (let i = blockStart; i < content.length; i++) {
    const ch = content[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        blockEnd = i + 1;
        break;
      }
    }
  }

  return content.substring(blockStart, blockEnd);
}

/**
 * Find the variable name this config object is assigned to.
 * Looks for patterns like:
 *   configVar = { ... userFacingName ... }
 *   const configVar = { ... userFacingName ... }
 */
function findConfigVarName(content, blockStart) {
  // Get the text before the block start (the `{`)
  const prefix = content.substring(Math.max(0, blockStart - 200), blockStart);

  // Pattern: varName = {
  const assignMatch = prefix.match(/(\w+)\s*=\s*$/);
  if (assignMatch) return assignMatch[1];

  return null;
}

/**
 * Extract tool/command metadata from a file.
 * Returns array of tool info objects.
 */
function extractToolsFromFile(content, file) {
  const results = [];

  // Find all userFacingName occurrences
  const ufnPatterns = [
    // Pattern 1: userFacingName() { return "X"; }
    /userFacingName\s*\(\)\s*\{[^}]*return\s+"([^"]+)"/g,
    // Pattern 2: userFacingName: () => "X"
    /userFacingName:\s*\(\)\s*=>\s*"([^"]+)"/g,
    // Pattern 3: userFacingName: () => VARIABLE (capture var name)
    /userFacingName:\s*\(\)\s*=>\s*([A-Za-z_$][A-Za-z0-9_$]*)/g,
  ];

  // Track which positions we've already processed
  const processedPositions = new Set();

  for (let patternIdx = 0; patternIdx < ufnPatterns.length; patternIdx++) {
    const re = ufnPatterns[patternIdx];
    let match;

    while ((match = re.exec(content)) !== null) {
      // Avoid double-processing the same location
      const pos = match.index;
      if (processedPositions.has(pos)) continue;
      processedPositions.add(pos);

      let userFacingName;
      if (patternIdx <= 1) {
        // Direct string literal
        userFacingName = match[1];
      } else {
        // Variable reference — try to resolve
        const varRef = match[1];
        // Skip if it looks like a function call pattern (followed by `(`)
        if (content[match.index + match[0].length] === "(") continue;
        // Skip reserved words
        if (["true", "false", "null", "undefined", "this"].includes(varRef)) continue;

        userFacingName = resolveVariable(content, varRef);
        if (!userFacingName) {
          userFacingName = `[${varRef}]`; // unresolved, mark it
        }
      }

      // Skip empty names
      if (!userFacingName || userFacingName === "") continue;

      // Extract the config object block
      const block = extractConfigBlock(content, pos);

      // Extract name property
      const nameMatch = block.match(/(?:^|[,\s])name:\s*"([^"]+)"/);
      const nameVarMatch = !nameMatch
        ? block.match(/(?:^|[,\s])name:\s*([A-Za-z_$][A-Za-z0-9_$]*)/)
        : null;
      let name = nameMatch
        ? nameMatch[1]
        : nameVarMatch
          ? resolveVariable(content, nameVarMatch[1]) || `[${nameVarMatch[1]}]`
          : null;

      // Extract type property
      const typeMatch = block.match(/(?:^|[,\s])type:\s*"([^"]+)"/);
      const type = typeMatch ? typeMatch[1] : null;

      // Extract description (string literal only, skip dynamic)
      const descMatch = block.match(
        /(?:^|[,\s])description:\s*"([^"]{0,200})"/,
      );
      // Also try: description: "X" (with backtick template)
      const descTemplateMatch = !descMatch
        ? block.match(/(?:^|[,\s])description:\s*`([^`]{0,200})`/)
        : null;
      const description = descMatch
        ? descMatch[1]
        : descTemplateMatch
          ? descTemplateMatch[1]
          : null;

      // Extract aliases
      const aliasMatch = block.match(
        /aliases:\s*\[([^\]]*)\]/,
      );
      let aliases = null;
      if (aliasMatch) {
        aliases = aliasMatch[1]
          .match(/"([^"]+)"/g)
          ?.map((s) => s.replace(/"/g, ""));
      }

      // Extract source
      const sourceMatch = block.match(/(?:^|[,\s])source:\s*"([^"]+)"/);
      const source = sourceMatch ? sourceMatch[1] : null;

      // Find config variable name
      const blockStartIdx = content.indexOf(block);
      const configVar = findConfigVarName(content, blockStartIdx);

      results.push({
        file,
        userFacingName,
        name,
        type,
        description,
        aliases,
        source,
        configVar,
      });
    }
  }

  return results;
}

/**
 * Check if a variable name looks minified (short, random-looking).
 */
function isMinified(name) {
  if (!name) return false;
  // 1-3 char names are likely minified
  if (name.length <= 3) return true;
  // camelCase with a single uppercase then lowercase is OK (not minified)
  // Random-looking combos like "qeR", "MBD", "kBD" are minified
  if (name.length <= 4 && /^[a-z][A-Z][A-Z]$/.test(name)) return true;
  return false;
}

/**
 * Convert a userFacingName to a PascalCase variable name suitable for renaming.
 * e.g., "Web Search" → "WebSearchTool", "init" → "InitCommand"
 */
function toConfigVarName(userFacingName, type) {
  const suffix =
    type === "prompt"
      ? "Command"
      : type?.startsWith("local")
        ? "Tool"
        : "Config";
  const pascal = userFacingName
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
  return pascal + suffix;
}

function main() {
  const opts = parseArgs();

  if (!fs.existsSync(opts.inputDir)) {
    console.error(`Error: input directory not found: ${opts.inputDir}`);
    process.exit(1);
  }

  // Collect all .js files (skip vendor/)
  const files = fs
    .readdirSync(opts.inputDir)
    .filter((f) => f.endsWith(".js"))
    .sort();

  if (files.length === 0) {
    console.error(`Error: no .js files found in ${opts.inputDir}`);
    process.exit(1);
  }

  const allTools = [];
  const renameMap = {};
  const stats = {
    filesScanned: files.length,
    toolsFound: 0,
    withName: 0,
    withType: 0,
    withDescription: 0,
    withAliases: 0,
    configVarsMinified: 0,
    renames: 0,
    unresolvedVars: 0,
  };

  for (const file of files) {
    const filePath = path.join(opts.inputDir, file);
    const content = fs.readFileSync(filePath, "utf-8");
    const tools = extractToolsFromFile(content, file);

    for (const tool of tools) {
      stats.toolsFound++;
      if (tool.name) stats.withName++;
      if (tool.type) stats.withType++;
      if (tool.description) stats.withDescription++;
      if (tool.aliases) stats.withAliases++;
      if (tool.userFacingName.startsWith("[")) stats.unresolvedVars++;

      allTools.push(tool);

      // Check if config variable is minified and could be renamed
      if (
        tool.configVar &&
        isMinified(tool.configVar) &&
        !tool.userFacingName.startsWith("[")
      ) {
        stats.configVarsMinified++;
        const newName = toConfigVarName(tool.userFacingName, tool.type);
        renameMap[tool.configVar] = newName;
        stats.renames++;
      }
    }
  }

  // Print stats
  if (opts.stats) {
    console.error("--- Tool Extraction Stats ---");
    console.error(`  Files scanned:          ${stats.filesScanned}`);
    console.error(`  Tools/commands found:   ${stats.toolsFound}`);
    console.error(`  With name:              ${stats.withName}`);
    console.error(`  With type:              ${stats.withType}`);
    console.error(`  With description:       ${stats.withDescription}`);
    console.error(`  With aliases:           ${stats.withAliases}`);
    console.error(`  Unresolved variables:   ${stats.unresolvedVars}`);
    console.error(`  Minified config vars:   ${stats.configVarsMinified}`);
    console.error(`  Renames generated:      ${stats.renames}`);
    console.error("-----------------------------");
  }

  // Print tool summary to stderr
  console.error(`\n--- Tool/Command Index (${allTools.length} entries) ---`);
  for (const tool of allTools) {
    const ufn = tool.userFacingName;
    const name = tool.name || "?";
    const type = tool.type || "?";
    const cv = tool.configVar || "?";
    const desc = tool.description
      ? tool.description.substring(0, 60)
      : "";
    console.error(
      `  ${ufn.padEnd(25)} name=${name.padEnd(20)} type=${type.padEnd(12)} var=${cv.padEnd(25)} ${desc}`,
    );
  }
  console.error("");

  // Write tool index
  if (opts.indexFile) {
    const index = allTools.map((t) => ({
      userFacingName: t.userFacingName,
      name: t.name,
      type: t.type,
      description: t.description,
      aliases: t.aliases,
      source: t.source,
      file: t.file,
      configVar: t.configVar,
    }));
    fs.writeFileSync(opts.indexFile, JSON.stringify(index, null, 2) + "\n");
    console.error(`Wrote tool index (${index.length} entries) to ${opts.indexFile}`);
  }

  // Output rename map
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
