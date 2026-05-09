#!/usr/bin/env node

// ai-rename-scoped.mjs — Scope-ordered per-identifier AI renaming (humanify-style)
//
// Unlike ai-rename.mjs (batch: sends whole module, gets all renames at once),
// this script renames ONE identifier at a time, sorted by scope size (largest first).
// After each rename, the AST is updated in-place so subsequent identifiers benefit
// from better surrounding context. This produces higher-quality names at the cost
// of more API calls.

import fs from "fs";
import path from "path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";
import _generate from "@babel/generator";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const traverse = _traverse.default || _traverse;
const generate = _generate.default || _generate;

// ─── Constants ───────────────────────────────────────────────────────────────

const BUN_PARAMS = new Set([
  "T", "R", "A", "_", "B", "D", "$", "H", "q", "G", "J", "C", "E", "W", "Q",
  "X", "Y", "Z", "K", "L", "M", "N", "O", "P", "S", "U", "V", "F", "I",
]);

const CONVENTIONAL_SHORT = new Set([
  "i", "j", "k", "x", "y", "e", "el", "fn", "cb", "ok", "id", "db",
  "fs", "os", "cp", "vm", "ip", "re", "op", "rn", "rx", "ms", "ns",
  "hr", "io", "ui", "v", "w", "n", "t", "r", "s", "a", "b", "c", "d",
]);

// ─── CLI ─────────────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage: node ai-rename-scoped.mjs <resplit-dir> [options]

Scope-ordered per-identifier AI renaming (humanify-style).
Renames one identifier at a time, largest scope first, so inner
variables benefit from already-renamed outer context.

Arguments:
  <resplit-dir>          Directory with resplit output (manifest.json + module files)

Options:
  --out <path>           Output renames JSON (default: renames-scoped-ai.json)
  --context <path>       Existing renames JSON for filtering (repeatable)
  --concurrency <n>      Module-level parallelism (default: 5)
  --context-window <n>   Chars of surrounding code per identifier (default: 6000)
  --resume               Resume from progress file
  --min-size <n>         Skip modules smaller than N chars (default: 100)
  --sample <n>           Process only N modules (for testing)
  --model <name>         Gemini model (default: gemini-3-flash-preview)
  --dry-run              Show binding counts per module, don't call API
  --apply                Also write renamed code back to module files
  -h, --help
  `);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    resplitDir: null,
    out: "renames-scoped-ai.json",
    contextFiles: [],
    concurrency: 5,
    contextWindow: 6000,
    resume: false,
    minSize: 100,
    sample: 0,
    model: "gemini-3-flash-preview",
    dryRun: false,
    apply: false,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case "--out":
        opts.out = args[++i]; i++; break;
      case "--context":
        opts.contextFiles.push(args[++i]); i++; break;
      case "--concurrency":
        opts.concurrency = parseInt(args[++i], 10); i++; break;
      case "--context-window":
        opts.contextWindow = parseInt(args[++i], 10); i++; break;
      case "--resume":
        opts.resume = true; i++; break;
      case "--min-size":
        opts.minSize = parseInt(args[++i], 10); i++; break;
      case "--sample":
        opts.sample = parseInt(args[++i], 10); i++; break;
      case "--model":
        opts.model = args[++i]; i++; break;
      case "--dry-run":
        opts.dryRun = true; i++; break;
      case "--apply":
        opts.apply = true; i++; break;
      case "-h": case "--help":
        printUsage(); process.exit(0); break;
      default:
        if (args[i].startsWith("--")) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
        if (!opts.resplitDir) {
          opts.resplitDir = args[i]; i++;
        } else {
          console.error(`Unexpected argument: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  if (!opts.resplitDir) {
    console.error("Error: <resplit-dir> is required");
    printUsage();
    process.exit(1);
  }

  return opts;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidJsIdentifier(name) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

function isMinifiedName(name) {
  // Already-descriptive: length > 4 and contains lowercase letters
  if (name.length > 4 && /[a-z]/.test(name)) return false;
  // 1-4 char names are likely minified
  if (name.length <= 4) return true;
  // Longer names without lowercase (e.g. all caps constants) — skip
  return false;
}

function shouldSkipBinding(name, knownRenames) {
  if (BUN_PARAMS.has(name)) return true;
  if (CONVENTIONAL_SHORT.has(name)) return true;
  if (knownRenames.has(name)) return true;
  if (!isMinifiedName(name)) return true;
  return false;
}

function progressPath(outPath) {
  return outPath.replace(/\.json$/, ".progress.json");
}

function fmt(n) {
  return n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : (n / 1e3).toFixed(1) + "K";
}

// ─── AST: Binding Collection & Scope Sorting ─────────────────────────────────

function findBindings(ast) {
  const bindings = [];

  traverse(ast, {
    // Visit all binding identifier sites
    "FunctionDeclaration|FunctionExpression|ArrowFunctionExpression"(nodePath) {
      // Function name (if any)
      if (nodePath.node.id) {
        const binding = nodePath.scope.getBinding(nodePath.node.id.name);
        if (binding) {
          addBinding(bindings, binding, nodePath);
        }
      }
      // Function params
      for (const param of nodePath.node.params) {
        collectParamBindings(param, nodePath.scope, bindings, nodePath);
      }
    },
    VariableDeclarator(nodePath) {
      if (nodePath.node.id.type === "Identifier") {
        const binding = nodePath.scope.getBinding(nodePath.node.id.name);
        if (binding) {
          addBinding(bindings, binding, nodePath);
        }
      } else if (nodePath.node.id.type === "ObjectPattern") {
        collectPatternBindings(nodePath.node.id, nodePath.scope, bindings, nodePath);
      } else if (nodePath.node.id.type === "ArrayPattern") {
        collectPatternBindings(nodePath.node.id, nodePath.scope, bindings, nodePath);
      }
    },
    ClassDeclaration(nodePath) {
      if (nodePath.node.id) {
        const binding = nodePath.scope.getBinding(nodePath.node.id.name);
        if (binding) {
          addBinding(bindings, binding, nodePath);
        }
      }
    },
    CatchClause(nodePath) {
      if (nodePath.node.param?.type === "Identifier") {
        const binding = nodePath.scope.getBinding(nodePath.node.param.name);
        if (binding) {
          addBinding(bindings, binding, nodePath);
        }
      }
    },
  });

  // Deduplicate by binding identifier name+scope (same binding can be visited multiple times)
  const seen = new Set();
  const unique = [];
  for (const b of bindings) {
    const key = b.name + ":" + b.scopeStart;
    if (!seen.has(key)) {
      seen.add(key);
      unique.push(b);
    }
  }

  // Sort by scope size descending (largest/outermost first)
  unique.sort((a, b) => b.scopeSize - a.scopeSize);

  return unique;
}

function addBinding(bindings, binding, contextPath) {
  // Find the containing scope block to measure scope size
  const scope = binding.scope;
  const block = scope.block;
  const scopeSize = (block.end || 0) - (block.start || 0);

  bindings.push({
    name: binding.identifier.name,
    binding,
    scopeSize,
    scopeStart: block.start || 0,
  });
}

function collectParamBindings(node, scope, bindings, contextPath) {
  if (node.type === "Identifier") {
    const binding = scope.getBinding(node.name);
    if (binding) addBinding(bindings, binding, contextPath);
  } else if (node.type === "AssignmentPattern") {
    collectParamBindings(node.left, scope, bindings, contextPath);
  } else if (node.type === "ObjectPattern") {
    collectPatternBindings(node, scope, bindings, contextPath);
  } else if (node.type === "ArrayPattern") {
    collectPatternBindings(node, scope, bindings, contextPath);
  } else if (node.type === "RestElement") {
    collectParamBindings(node.argument, scope, bindings, contextPath);
  }
}

function collectPatternBindings(node, scope, bindings, contextPath) {
  if (node.type === "ObjectPattern") {
    for (const prop of node.properties) {
      if (prop.type === "RestElement") {
        collectParamBindings(prop.argument, scope, bindings, contextPath);
      } else {
        collectParamBindings(prop.value, scope, bindings, contextPath);
      }
    }
  } else if (node.type === "ArrayPattern") {
    for (const elem of node.elements) {
      if (elem) collectParamBindings(elem, scope, bindings, contextPath);
    }
  }
}

// ─── Context Extraction ──────────────────────────────────────────────────────

function getContext(binding, code, maxChars) {
  // Get the scope block that contains this binding
  const block = binding.scope.block;
  const start = block.start || 0;
  const end = block.end || code.length;
  const scopeCode = code.slice(start, end);

  if (scopeCode.length <= maxChars) {
    return scopeCode;
  }

  // If scope is too large, window around the binding declaration
  const declStart = binding.identifier.start || 0;
  const half = Math.floor(maxChars / 2);
  const winStart = Math.max(start, declStart - half);
  const winEnd = Math.min(end, winStart + maxChars);
  return code.slice(winStart, winEnd);
}

// ─── LLM Call ────────────────────────────────────────────────────────────────

async function callGemini(geminiModel, name, context, retries = 2) {
  const prompt = `You are a JavaScript reverse-engineering expert. This is minified code from a Bun-compiled application.

Rename the identifier \`${name}\` to a descriptive name based on its usage in the surrounding code.

Rules:
- Use camelCase for variables/functions, PascalCase for classes/React components.
- Base your suggestion on: how the variable is used, assigned, passed, string literals, API calls, error messages, control flow.
- If you cannot determine a meaningful name, return the original name unchanged.
- Return ONLY a JSON object: {"newName": "descriptiveName"}

Code context:
\`\`\`javascript
${context}
\`\`\`

Rename \`${name}\` →`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);
      const usage = result.response.usageMetadata || {};
      return { newName: parsed.newName || null, usage };
    } catch (err) {
      if (attempt < retries) {
        const isRateLimit = err.status === 429 || err.message?.includes("429") || err.message?.includes("quota");
        const delay = isRateLimit ? 5000 * (attempt + 1) : 2000 * (attempt + 1);
        if (isRateLimit) {
          console.warn(`    Rate limited, waiting ${delay / 1000}s...`);
        } else {
          console.warn(`    Attempt ${attempt + 1} failed: ${err.message?.slice(0, 80)}, retrying...`);
        }
        await new Promise((r) => setTimeout(r, delay));
      } else {
        return { newName: null, usage: {}, error: err.message?.slice(0, 100) };
      }
    }
  }
}

// ─── Module Processing ───────────────────────────────────────────────────────

function parseModule(code) {
  return parse(code, {
    sourceType: "script",
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    errorRecovery: true,
    plugins: ["jsx"],
  });
}

async function processModule(code, moduleInfo, geminiModel, opts, knownRenames) {
  const renames = {};
  const stats = { total: 0, renamed: 0, skipped: 0, errors: 0 };
  const tokenUsage = { input: 0, output: 0, thinking: 0, total: 0 };

  // Parse AST
  let ast;
  try {
    ast = parseModule(code);
  } catch (err) {
    return { code, renames, stats: { ...stats, errors: 1 }, tokenUsage, error: `Parse error: ${err.message}` };
  }

  // Collect and sort bindings
  let bindings;
  try {
    bindings = findBindings(ast);
  } catch (err) {
    return { code, renames, stats: { ...stats, errors: 1 }, tokenUsage, error: `Traverse error: ${err.message}` };
  }

  // Filter to minified-only bindings
  const candidates = bindings.filter((b) => !shouldSkipBinding(b.name, knownRenames));
  stats.total = candidates.length;

  if (candidates.length === 0) {
    // Regenerate code anyway (AST may have been modified by traverse crawling)
    return { code, renames, stats, tokenUsage };
  }

  // Process each binding sequentially (order matters — each rename updates context)
  // We need to track the current code string since scope.rename modifies the AST
  for (const candidate of candidates) {
    const currentName = candidate.binding.identifier.name;

    // Re-check: binding may have already been renamed by a previous scope.rename
    // (e.g., if it was a reference to a binding we already renamed)
    if (!isMinifiedName(currentName)) {
      stats.skipped++;
      continue;
    }

    // Generate current code from AST for context extraction
    let currentCode;
    try {
      currentCode = generate(ast, { retainLines: false, compact: false, comments: true }).code;
    } catch {
      currentCode = code; // fallback to original
    }

    // Extract context around this binding
    const context = getContext(candidate.binding, currentCode, opts.contextWindow);

    // Call LLM
    const result = await callGemini(geminiModel, currentName, context);

    // Accumulate tokens
    if (result.usage) {
      tokenUsage.input += result.usage.promptTokenCount || 0;
      tokenUsage.output += result.usage.candidatesTokenCount || 0;
      tokenUsage.thinking += result.usage.thoughtsTokenCount || 0;
      tokenUsage.total += result.usage.totalTokenCount || 0;
    }

    if (result.error) {
      stats.errors++;
      continue;
    }

    const newName = result.newName;

    // Validate
    if (!newName || newName === currentName || !isValidJsIdentifier(newName)) {
      stats.skipped++;
      continue;
    }

    // Check for collisions with other bindings in the same scope
    if (candidate.binding.scope.hasBinding(newName)) {
      stats.skipped++;
      continue;
    }

    // Apply rename in the AST — this updates ALL references to this binding
    try {
      candidate.binding.scope.rename(currentName, newName);
      renames[currentName] = newName;
      stats.renamed++;
    } catch (err) {
      stats.errors++;
    }
  }

  // Generate final code from the renamed AST
  let finalCode = code;
  try {
    finalCode = generate(ast, {
      retainLines: false,
      compact: false,
      comments: true,
      jsescOption: { minimal: true },
    }).code;
  } catch {
    // If generation fails, we still have the renames map
  }

  return { code: finalCode, renames, stats, tokenUsage };
}

// ─── Concurrency ─────────────────────────────────────────────────────────────

async function mapWithConcurrency(items, fn, concurrency) {
  const results = [];
  let index = 0;

  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => worker());
  await Promise.all(workers);
  return results;
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const startTime = Date.now();

  const resplitDir = path.resolve(opts.resplitDir);
  const outPath = path.resolve(opts.out);
  const progPath = progressPath(outPath);

  // Validate
  const manifestPath = path.join(resplitDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest.json not found in ${resplitDir}`);
    process.exit(1);
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !opts.dryRun) {
    console.error("GEMINI_API_KEY not set in environment or .env");
    process.exit(1);
  }

  // Load manifest
  console.log("Loading manifest...");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  if (!manifest.modules) {
    console.error("Only resplit manifest format is supported (requires 'modules' key)");
    process.exit(1);
  }

  const modules = manifest.modules;

  // Filter to app modules
  let appModules = Object.entries(modules)
    .filter(([, mod]) => !mod.vendor)
    .map(([name, mod]) => ({ name, ...mod }));

  console.log(`  Total modules: ${Object.keys(modules).length}`);
  console.log(`  App modules: ${appModules.length}`);

  // Filter by size
  appModules = appModules.filter((mod) => mod.size >= opts.minSize);
  console.log(`  After min-size filter (>=${opts.minSize}): ${appModules.length}`);

  // Sort by size descending (larger modules first)
  appModules.sort((a, b) => b.size - a.size);

  // Load existing renames for filtering (as a Set of known-renamed identifiers)
  const knownRenames = new Set();
  for (const ctxFile of opts.contextFiles) {
    const ctxPath = path.resolve(ctxFile);
    if (!fs.existsSync(ctxPath)) {
      console.warn(`  Warning: context file not found: ${ctxFile}`);
      continue;
    }
    const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf-8"));
    // Both keys (old names) and values (new names that now exist in code) are known
    for (const [key, val] of Object.entries(ctx)) {
      knownRenames.add(key);
      knownRenames.add(val);
    }
  }
  if (opts.contextFiles.length > 0) {
    console.log(`  Known identifiers from context: ${knownRenames.size}`);
  }

  // Resume support
  let progress = {};
  if (opts.resume && fs.existsSync(progPath)) {
    progress = JSON.parse(fs.readFileSync(progPath, "utf-8"));
    console.log(`  Resuming: ${Object.keys(progress).length} modules already processed`);
  }

  // Filter out completed modules
  if (Object.keys(progress).length > 0) {
    appModules = appModules.filter((mod) => !progress[mod.name]);
  }

  // Sample mode
  if (opts.sample > 0 && opts.sample < appModules.length) {
    appModules = appModules.slice(0, opts.sample);
    console.log(`  Sample mode: processing ${opts.sample} modules`);
  }

  console.log(`  Modules to process: ${appModules.length}`);
  console.log(`  Model: ${opts.model}`);
  console.log(`  Concurrency: ${opts.concurrency}`);
  console.log(`  Context window: ${opts.contextWindow} chars`);

  // ── Dry run ──
  if (opts.dryRun) {
    console.log("\n--- Dry Run: Binding Counts ---\n");
    let totalBindings = 0;
    let totalCandidates = 0;

    for (const mod of appModules) {
      const filePath = path.join(resplitDir, mod.file);
      if (!fs.existsSync(filePath)) continue;

      const code = fs.readFileSync(filePath, "utf-8");
      let ast;
      try { ast = parseModule(code); } catch { continue; }

      let bindings;
      try { bindings = findBindings(ast); } catch { continue; }

      const candidates = bindings.filter((b) => !shouldSkipBinding(b.name, knownRenames));
      totalBindings += bindings.length;
      totalCandidates += candidates.length;

      if (candidates.length > 0) {
        const names = candidates.slice(0, 8).map((b) => b.name).join(", ");
        const more = candidates.length > 8 ? ` +${candidates.length - 8} more` : "";
        console.log(`  ${mod.file.padEnd(50)} ${String(bindings.length).padStart(4)} bindings, ${String(candidates.length).padStart(4)} to rename: ${names}${more}`);
      }
    }

    console.log(`\n  Total bindings: ${totalBindings}`);
    console.log(`  Candidates for renaming: ${totalCandidates}`);
    console.log(`  Estimated API calls: ${totalCandidates}`);

    const estInputTokens = totalCandidates * 2000; // ~2K tokens per call avg
    // Gemini 3 Flash Standard: $0.50/1M input, $3.00/1M output (including thinking)
    const estCost = (estInputTokens / 1e6 * 0.50) + ((totalCandidates * 20 + totalCandidates * 200) / 1e6 * 3.00);
    console.log(`  Estimated cost: $${estCost.toFixed(2)}`);
    return;
  }

  // ── Initialize Gemini ──
  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({
    model: opts.model,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 1024 },
    },
  });

  // Aggregate stats
  const allRenames = {};
  let totalStats = { total: 0, renamed: 0, skipped: 0, errors: 0 };
  let totalTokens = { input: 0, output: 0, thinking: 0, total: 0 };
  let modulesProcessed = 0;
  let modulesErrored = 0;
  const periodicInterval = 50;

  // Merge renames from resumed progress
  for (const [, moduleData] of Object.entries(progress)) {
    if (moduleData?.renames) {
      Object.assign(allRenames, moduleData.renames);
    }
  }

  // Save on interrupt
  let interrupted = false;
  process.on("SIGINT", () => {
    if (interrupted) process.exit(1); // second Ctrl+C exits immediately
    interrupted = true;
    console.log("\n\nInterrupted — saving progress...");
    fs.writeFileSync(progPath, JSON.stringify(progress, null, 2));
    const sorted = Object.fromEntries(
      Object.entries(allRenames).sort(([a], [b]) => a.localeCompare(b)),
    );
    fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n");
    console.log(`  Progress: ${progPath}`);
    console.log(`  Renames so far: ${Object.keys(allRenames).length} → ${outPath}`);
    process.exit(0);
  });

  console.log(`\nProcessing ${appModules.length} modules...\n`);

  await mapWithConcurrency(
    appModules,
    async (mod, idx) => {
      const filePath = path.join(resplitDir, mod.file);
      if (!fs.existsSync(filePath)) {
        console.warn(`  Skipping ${mod.file}: file not found`);
        modulesErrored++;
        return;
      }

      const code = fs.readFileSync(filePath, "utf-8");
      const moduleStart = Date.now();

      const result = await processModule(code, mod, geminiModel, opts, knownRenames);

      if (result.error) {
        console.warn(`\n  Error in ${mod.file}: ${result.error}`);
        modulesErrored++;
        return;
      }

      // Accumulate
      Object.assign(allRenames, result.renames);
      totalStats.total += result.stats.total;
      totalStats.renamed += result.stats.renamed;
      totalStats.skipped += result.stats.skipped;
      totalStats.errors += result.stats.errors;
      totalTokens.input += result.tokenUsage.input;
      totalTokens.output += result.tokenUsage.output;
      totalTokens.thinking += result.tokenUsage.thinking;
      totalTokens.total += result.tokenUsage.total;

      // Write renamed code back if --apply
      if (opts.apply && Object.keys(result.renames).length > 0) {
        fs.writeFileSync(filePath, result.code, "utf-8");
      }

      // Save progress
      progress[mod.name] = {
        renames: result.renames,
        stats: result.stats,
        completed: true,
      };

      modulesProcessed++;
      const elapsed = ((Date.now() - moduleStart) / 1000).toFixed(1);
      const label = mod.primaryName || mod.name;
      const renameCount = Object.keys(result.renames).length;
      process.stdout.write(
        `\r  [${modulesProcessed + modulesErrored}/${appModules.length}] ${mod.file.padEnd(45)} ${result.stats.total} bindings, ${renameCount} renamed, ${result.stats.skipped} skipped (${elapsed}s)`
      );

      // Save progress after every module (each module can take minutes)
      fs.writeFileSync(progPath, JSON.stringify(progress, null, 2));

      // Periodic summary
      if (modulesProcessed % periodicInterval === 0) {
        const totalElapsed = (Date.now() - startTime) / 1000;
        const rate = modulesProcessed / totalElapsed;
        const remaining = appModules.length - modulesProcessed - modulesErrored;
        const eta = remaining / rate;
        console.log(`\n\n  --- Progress (${modulesProcessed}/${appModules.length}) ---`);
        console.log(`  Renames so far: ${totalStats.renamed}`);
        console.log(`  Tokens: ${fmt(totalTokens.input)} in / ${fmt(totalTokens.output)} out / ${fmt(totalTokens.thinking)} think`);
        const cost = totalTokens.input / 1e6 * 0.50 + (totalTokens.output + totalTokens.thinking) / 1e6 * 3.00;
        console.log(`  Cost: $${cost.toFixed(3)}`);
        console.log(`  ETA: ${(eta / 60).toFixed(1)} min\n`);
      }
    },
    opts.concurrency,
  );

  console.log("\n");

  // Save final progress
  fs.writeFileSync(progPath, JSON.stringify(progress, null, 2));

  // Write output renames JSON (sorted)
  const sorted = Object.fromEntries(
    Object.entries(allRenames).sort(([a], [b]) => a.localeCompare(b)),
  );
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n");

  // ── Final stats ──
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("--- Scoped AI Rename Stats ---");
  console.log(`  Modules processed:    ${modulesProcessed}`);
  console.log(`  Modules errored:      ${modulesErrored}`);
  console.log(`  Total bindings found: ${totalStats.total}`);
  console.log(`  Identifiers renamed:  ${totalStats.renamed}`);
  console.log(`  Identifiers skipped:  ${totalStats.skipped}`);
  console.log(`  API errors:           ${totalStats.errors}`);

  if (totalTokens.total > 0) {
    console.log(`  --- Token Usage ---`);
    console.log(`  Input tokens:         ${fmt(totalTokens.input)}`);
    console.log(`  Output tokens:        ${fmt(totalTokens.output)}`);
    console.log(`  Thinking tokens:      ${fmt(totalTokens.thinking)}`);
    console.log(`  Total tokens:         ${fmt(totalTokens.total)}`);

    // Gemini 3 Flash Standard: $0.50/1M input, $3.00/1M output (including thinking)
    const PRICE_INPUT = 0.50;
    const PRICE_OUTPUT = 3.00;   // output + thinking billed at same rate
    const costInput = totalTokens.input / 1e6 * PRICE_INPUT;
    const costOutput = (totalTokens.output + totalTokens.thinking) / 1e6 * PRICE_OUTPUT;
    const costTotal = costInput + costOutput;
    console.log(`  --- Estimated Cost (Gemini 3 Flash) ---`);
    console.log(`  Input  ($${PRICE_INPUT}/1M):          $${costInput.toFixed(3)}`);
    console.log(`  Output+Think ($${PRICE_OUTPUT}/1M):    $${costOutput.toFixed(3)}`);
    console.log(`  Total:                    $${costTotal.toFixed(3)}`);
  }

  console.log(`  Output: ${outPath}`);
  console.log(`  Progress: ${progPath}`);
  if (opts.apply) {
    console.log(`  Applied: code written back to module files`);
  }
  console.log(`  Elapsed: ${elapsed}s`);
  console.log("------------------------------");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
