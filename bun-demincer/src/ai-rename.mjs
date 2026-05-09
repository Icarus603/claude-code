#!/usr/bin/env node

// ai-rename.mjs — AI-assisted semantic renaming of minified identifiers
// Sends each module to Gemini 3 Flash and asks for meaningful rename suggestions.
// Output: renames-ai.json compatible with rename.mjs --batch

import fs from "fs";
import path from "path";
import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

// ─── CLI Parsing ─────────────────────────────────────────────────────────────

function printUsage() {
  console.log(`
Usage: node ai-rename.mjs <resplit-dir> [options]

Sends each app module to Gemini 3 Flash to suggest meaningful names
for minified identifiers. Outputs a renames JSON for rename.mjs --batch.

Arguments:
  <resplit-dir>          Directory with resplit output (manifest.json + module files)

Options:
  --out <path>           Output renames JSON (default: renames-ai.json)
  --context <path>       Existing renames JSON(s) for known-name context (repeatable)
  --concurrency <n>      Max concurrent API calls (default: 10)
  --sample <n>           Only process N random modules (for testing)
  --resume               Resume from progress file
  --min-size <n>         Skip modules smaller than N chars (default: 100)
  --model <name>         Gemini model (default: gemini-3-flash-preview)
  --dry-run              Show what would be processed, don't call API
  -h, --help             Show this help
  `);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    resplitDir: null,
    out: "renames-ai.json",
    contextFiles: [],
    concurrency: 10,
    sample: 0,
    resume: false,
    minSize: 100,
    model: "gemini-3-flash-preview",
    dryRun: false,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case "--out":
        opts.out = args[++i];
        i++;
        break;
      case "--context":
        opts.contextFiles.push(args[++i]);
        i++;
        break;
      case "--concurrency":
        opts.concurrency = parseInt(args[++i], 10);
        i++;
        break;
      case "--sample":
        opts.sample = parseInt(args[++i], 10);
        i++;
        break;
      case "--resume":
        opts.resume = true;
        i++;
        break;
      case "--min-size":
        opts.minSize = parseInt(args[++i], 10);
        i++;
        break;
      case "--model":
        opts.model = args[++i];
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
        break;
      default:
        if (args[i].startsWith("--")) {
          console.error(`Unknown option: ${args[i]}`);
          process.exit(1);
        }
        if (!opts.resplitDir) {
          opts.resplitDir = args[i];
          i++;
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

// ─── Bun Parameter Names (skip these) ────────────────────────────────────────

const BUN_PARAMS = new Set([
  "T", "R", "A", "_", "B", "D", "$", "H", "q", "G", "J", "C", "E", "W", "Q",
  "X", "Y", "Z", "K", "L", "M", "N", "O", "P", "S", "U", "V", "F", "I",
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

function isValidJsIdentifier(name) {
  return /^[a-zA-Z_$][a-zA-Z0-9_$]*$/.test(name);
}

function isMinifiedName(name) {
  // 1-3 char names, or names with underscore/number patterns typical of minification
  if (name.length <= 3) return true;
  // Names like "fWT", "WpT", "jVR" — mixed case 3+ chars with no clear meaning
  if (name.length <= 4 && /^[a-zA-Z][a-zA-Z0-9_$]+$/.test(name)) return true;
  return false;
}

function progressPath(outPath) {
  return outPath.replace(/\.json$/, ".progress.json");
}

// ─── Prompt Construction ─────────────────────────────────────────────────────

function buildPrompt(code, moduleInfo, knownRenames, depModules) {
  const parts = [];

  // Known exports for this module
  let exportsCtx = "";
  if (moduleInfo.exports && moduleInfo.exports.length > 0) {
    const exportPairs = moduleInfo.exports
      .filter((e) => knownRenames[e])
      .map((e) => `  ${knownRenames[e]} (minified: ${e})`)
      .join("\n");
    if (exportPairs) {
      exportsCtx = `\nKnown exports from this module:\n${exportPairs}\n`;
    }
  }

  // Known dependency info
  let depsCtx = "";
  if (depModules && depModules.length > 0) {
    const depLines = depModules
      .filter((d) => d.exports && d.exports.length > 0)
      .slice(0, 15) // limit context size
      .map((d) => {
        const namedExports = d.exports
          .filter((e) => knownRenames[e])
          .map((e) => knownRenames[e])
          .slice(0, 10);
        if (namedExports.length === 0) return null;
        const label = d.primaryName || d.name;
        return `  ${label}: exports [${namedExports.join(", ")}]`;
      })
      .filter(Boolean)
      .join("\n");
    if (depLines) {
      depsCtx = `\nDependency modules used by this code:\n${depLines}\n`;
    }
  }

  const prompt = `You are a JavaScript reverse-engineering expert. Given minified/bundled code from a Bun-compiled application, suggest meaningful names for minified identifiers.

Rules:
- Only rename short/minified identifiers (1-3 chars like "e", "t", "n", or Bun-style like "fWT", "WpT"). Leave already-descriptive names as-is.
- Use camelCase for variables/functions, PascalCase for classes/React components.
- Base your suggestions on: string literals, API calls, error messages, React patterns, variable usage context, control flow, and the known exports/dependencies listed below.
- Return ONLY a JSON object mapping minified names to suggested names: {"oldName": "newName", ...}
- If you're not confident about a name, OMIT it. Don't guess poorly.
- Do NOT rename these Bun wrapper parameter names: T, R, A, _, B, D, $, H, q, G, J, C, E, W, Q, X, Y, Z, K, L, M, N, O, P, S, U, V, F, I
- Do NOT rename common short names that are conventional: i, j, k, x, y, e, el, fn, cb, ok, id, db, fs, os, cp, vm, ip
- Do NOT include any renames where the key equals the value.
${exportsCtx}${depsCtx}
Code:
\`\`\`javascript
${code}
\`\`\``;

  return prompt;
}

// ─── API Call ────────────────────────────────────────────────────────────────

async function callGemini(genAI, model, prompt, retries = 2) {
  const geminiModel = genAI.getGenerativeModel({
    model,
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.2,
      thinkingConfig: { thinkingBudget: 8096 },
    },
  });

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(text);
      const usage = result.response.usageMetadata || {};
      return { renames: parsed, usage };
    } catch (err) {
      if (attempt < retries) {
        const delay = 1000 * (attempt + 1) * 2; // 2s, 4s
        if (err.status === 429 || err.message?.includes("429") || err.message?.includes("quota")) {
          console.warn(`  Rate limited, waiting ${delay / 1000}s...`);
        } else {
          console.warn(`  Attempt ${attempt + 1} failed: ${err.message?.slice(0, 80)}, retrying in ${delay / 1000}s...`);
        }
        await new Promise((r) => setTimeout(r, delay));
      } else {
        throw err;
      }
    }
  }
}

// ─── Validation ──────────────────────────────────────────────────────────────

const CONVENTIONAL_SHORT = new Set([
  "i", "j", "k", "x", "y", "e", "el", "fn", "cb", "ok", "id", "db",
  "fs", "os", "cp", "vm", "ip", "re", "op", "rn", "rx", "ms", "ns",
  "hr", "io", "ui", "v", "w", "n", "t", "r", "s", "a", "b", "c", "d",
]);

function validateRenames(renames, existingRenames, allValues) {
  const filtered = {};
  let skipped = { noop: 0, bunParam: 0, existing: 0, invalid: 0, collision: 0, conventional: 0 };

  for (const [key, value] of Object.entries(renames)) {
    // Skip no-op
    if (key === value) { skipped.noop++; continue; }
    // Skip Bun params
    if (BUN_PARAMS.has(key)) { skipped.bunParam++; continue; }
    // Skip conventional short names
    if (CONVENTIONAL_SHORT.has(key)) { skipped.conventional++; continue; }
    // Skip already-known renames
    if (existingRenames[key]) { skipped.existing++; continue; }
    // Skip invalid identifiers
    if (!isValidJsIdentifier(value)) { skipped.invalid++; continue; }
    // Skip if value collides with existing value
    if (allValues.has(value)) { skipped.collision++; continue; }

    filtered[key] = value;
    allValues.add(value);
  }

  return { filtered, skipped };
}

// ─── Concurrency Limiter ─────────────────────────────────────────────────────

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

  // Resolve paths
  const resplitDir = path.resolve(opts.resplitDir);
  const outPath = path.resolve(opts.out);
  const progPath = progressPath(outPath);

  // Validate resplit dir
  const manifestPath = path.join(resplitDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    console.error(`manifest.json not found in ${resplitDir}`);
    process.exit(1);
  }

  // Check API key
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey && !opts.dryRun) {
    console.error("GEMINI_API_KEY not set in environment or .env");
    process.exit(1);
  }

  // Load manifest
  console.log("Loading manifest...");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));

  // Support both resplit format (manifest.modules) and legacy split format (manifest.files)
  let modules = {};
  let isLegacy = false;

  if (manifest.modules) {
    // Resplit format: modules keyed by name, each with { file, vendor, exports, deps, size, ... }
    modules = manifest.modules;
  } else if (manifest.files) {
    // Legacy split format: files keyed by filename, each with { category, modules: [...] }
    // We process per-file since each file contains multiple modules
    isLegacy = true;
    for (const [fileName, fileInfo] of Object.entries(manifest.files)) {
      // Skip vendor files
      const isVendor = fileName.startsWith("vendor/");
      // Each legacy file contains multiple sub-modules — we treat the file as a unit
      const totalSize = (fileInfo.modules || []).reduce((s, m) => s + (m.size || 0), 0);
      const allExports = (fileInfo.modules || []).flatMap((m) => [m.name]);
      modules[fileName] = {
        file: fileName,
        vendor: isVendor,
        size: totalSize,
        exports: allExports,
        deps: [],
        primaryName: fileInfo.category || fileName.replace(/\.js$/, ""),
        type: "legacy",
      };
    }
  } else {
    console.error("Unrecognized manifest format (no 'modules' or 'files' key)");
    process.exit(1);
  }

  // Filter to app modules only
  let appModules = Object.entries(modules)
    .filter(([, mod]) => !mod.vendor)
    .map(([name, mod]) => ({ name, ...mod }));

  console.log(`  Format: ${isLegacy ? "legacy split" : "resplit"}`);
  console.log(`  Total entries: ${Object.keys(modules).length}`);
  console.log(`  App entries: ${appModules.length}`);

  // Filter by size
  appModules = appModules.filter((mod) => mod.size >= opts.minSize);
  console.log(`  After min-size filter (>=${opts.minSize}): ${appModules.length}`);

  // Sort by size descending (larger modules first — more context for LLM)
  appModules.sort((a, b) => b.size - a.size);

  // Load existing renames for context
  const existingRenames = {};
  for (const ctxFile of opts.contextFiles) {
    const ctxPath = path.resolve(ctxFile);
    if (!fs.existsSync(ctxPath)) {
      console.warn(`  Warning: context file not found: ${ctxFile}`);
      continue;
    }
    const ctx = JSON.parse(fs.readFileSync(ctxPath, "utf-8"));
    Object.assign(existingRenames, ctx);
  }
  if (opts.contextFiles.length > 0) {
    console.log(`  Known renames from context: ${Object.keys(existingRenames).length}`);
  }

  // Build reverse map for existing renames (to check collisions)
  const allValues = new Set(Object.values(existingRenames));

  // Resume support
  let progress = {};
  if (opts.resume && fs.existsSync(progPath)) {
    progress = JSON.parse(fs.readFileSync(progPath, "utf-8"));
    console.log(`  Resuming: ${Object.keys(progress).length} modules already processed`);
  }

  // Filter out already-processed modules
  if (Object.keys(progress).length > 0) {
    appModules = appModules.filter((mod) => !progress[mod.name]);
  }

  // Sample mode
  if (opts.sample > 0 && opts.sample < appModules.length) {
    // Shuffle and take first N
    for (let i = appModules.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [appModules[i], appModules[j]] = [appModules[j], appModules[i]];
    }
    appModules = appModules.slice(0, opts.sample);
    console.log(`  Sample mode: processing ${opts.sample} modules`);
  }

  console.log(`  Modules to process: ${appModules.length}`);
  console.log(`  Model: ${opts.model}`);
  console.log(`  Concurrency: ${opts.concurrency}`);

  if (opts.dryRun) {
    console.log("\n--- Dry Run ---");
    console.log(`Would process ${appModules.length} modules`);
    const totalSize = appModules.reduce((s, m) => s + m.size, 0);
    console.log(`Total code size: ${(totalSize / 1024).toFixed(1)} KB`);
    const largestModules = appModules.slice(0, 10);
    console.log("Largest modules:");
    for (const mod of largestModules) {
      console.log(`  ${mod.file} (${(mod.size / 1024).toFixed(1)} KB)`);
    }
    return;
  }

  // Initialize Gemini
  const genAI = new GoogleGenerativeAI(apiKey);
  const allRenames = {};
  let totalSkipped = { noop: 0, bunParam: 0, existing: 0, invalid: 0, collision: 0, conventional: 0 };
  let totalRenames = 0;
  let errors = 0;
  let processed = 0;
  let tokenUsage = { input: 0, output: 0, thinking: 0, total: 0 };

  // Merge any previously completed renames from progress
  for (const [, moduleRenames] of Object.entries(progress)) {
    if (moduleRenames && typeof moduleRenames === "object") {
      Object.assign(allRenames, moduleRenames);
    }
  }

  // Process modules
  console.log(`\nProcessing ${appModules.length} modules...\n`);

  await mapWithConcurrency(
    appModules,
    async (mod, idx) => {
      const filePath = path.join(resplitDir, mod.file);
      if (!fs.existsSync(filePath)) {
        console.warn(`  Skipping ${mod.file}: file not found`);
        errors++;
        return;
      }

      const code = fs.readFileSync(filePath, "utf-8");

      // Build dependency module info for context
      const depModules = (mod.deps || [])
        .map((depName) => modules[depName])
        .filter(Boolean);

      const prompt = buildPrompt(code, mod, existingRenames, depModules);

      try {
        const { renames, usage } = await callGemini(genAI, opts.model, prompt);

        // Accumulate token usage
        if (usage) {
          tokenUsage.input += usage.promptTokenCount || 0;
          tokenUsage.output += usage.candidatesTokenCount || 0;
          tokenUsage.thinking += usage.thoughtsTokenCount || 0;
          tokenUsage.total += usage.totalTokenCount || 0;
        }

        if (renames && typeof renames === "object" && !Array.isArray(renames)) {
          const { filtered, skipped } = validateRenames(renames, existingRenames, allValues);

          const count = Object.keys(filtered).length;
          Object.assign(allRenames, filtered);
          totalRenames += count;

          // Accumulate skip stats
          for (const k of Object.keys(skipped)) {
            totalSkipped[k] += skipped[k];
          }

          // Save to progress
          progress[mod.name] = filtered;

          processed++;
          const label = mod.primaryName || mod.name;
          process.stdout.write(
            `\r  [${processed + errors}/${appModules.length}] ${label.padEnd(40)} +${count} renames`
          );

          // Periodic progress save (every 20 modules)
          if (processed % 20 === 0) {
            fs.writeFileSync(progPath, JSON.stringify(progress, null, 2));
          }
        } else {
          console.warn(`\n  Warning: invalid response for ${mod.file}`);
          errors++;
        }
      } catch (err) {
        console.warn(`\n  Error processing ${mod.file}: ${err.message?.slice(0, 100)}`);
        errors++;
      }
    },
    opts.concurrency
  );

  console.log("\n");

  // Save final progress
  fs.writeFileSync(progPath, JSON.stringify(progress, null, 2));

  // Write output
  const sorted = Object.fromEntries(
    Object.entries(allRenames).sort(([a], [b]) => a.localeCompare(b))
  );
  fs.writeFileSync(outPath, JSON.stringify(sorted, null, 2) + "\n");

  // Stats
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("--- AI Rename Stats ---");
  console.log(`  Modules processed:    ${processed}`);
  console.log(`  Modules errored:      ${errors}`);
  console.log(`  Total renames found:  ${totalRenames}`);
  console.log(`  Skipped (no-op):      ${totalSkipped.noop}`);
  console.log(`  Skipped (Bun param):  ${totalSkipped.bunParam}`);
  console.log(`  Skipped (existing):   ${totalSkipped.existing}`);
  console.log(`  Skipped (invalid):    ${totalSkipped.invalid}`);
  console.log(`  Skipped (collision):  ${totalSkipped.collision}`);
  console.log(`  Skipped (conventional): ${totalSkipped.conventional}`);

  // Token usage & cost
  if (tokenUsage.total > 0) {
    const fmt = (n) => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : (n / 1e3).toFixed(1) + "K";
    console.log(`  --- Token Usage ---`);
    console.log(`  Input tokens:         ${fmt(tokenUsage.input)}`);
    console.log(`  Output tokens:        ${fmt(tokenUsage.output)}`);
    console.log(`  Thinking tokens:      ${fmt(tokenUsage.thinking)}`);
    console.log(`  Total tokens:         ${fmt(tokenUsage.total)}`);

    // Gemini 3 Flash Standard pricing (as of 2026-03, update if changed)
    // https://ai.google.dev/pricing
    // Input: $0.50/1M tokens. Output (including thinking): $3.00/1M tokens.
    const PRICE_INPUT = 0.50;    // $/1M tokens
    const PRICE_OUTPUT = 3.00;   // $/1M tokens (output + thinking billed at same rate)
    const costInput = tokenUsage.input / 1e6 * PRICE_INPUT;
    const costOutput = (tokenUsage.output + tokenUsage.thinking) / 1e6 * PRICE_OUTPUT;
    const costTotal = costInput + costOutput;
    console.log(`  --- Estimated Cost (Gemini 3 Flash) ---`);
    console.log(`  Input  ($${PRICE_INPUT}/1M):          $${costInput.toFixed(3)}`);
    console.log(`  Output+Think ($${PRICE_OUTPUT}/1M):    $${costOutput.toFixed(3)}`);
    console.log(`  Total:                    $${costTotal.toFixed(3)}`);
  }

  console.log(`  Output: ${outPath}`);
  console.log(`  Progress: ${progPath}`);
  console.log(`  Elapsed: ${elapsed}s`);
  console.log("-----------------------");
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
