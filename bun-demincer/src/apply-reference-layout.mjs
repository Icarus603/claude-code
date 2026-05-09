#!/usr/bin/env node
/**
 * apply-reference-layout.mjs — Apply a reference version's file layout to a target directory.
 *
 * Takes the file paths and vendor classifications from a reference manifest
 * (e.g., the fully-organized v2.1.63) and applies them to a target directory
 * (e.g., a freshly reproduced decoded-organized). Moves files to match the
 * reference layout and updates the target manifest.
 *
 * This replaces running move-vendors.mjs + move-vendors-utils.mjs +
 * move-uncategorized.mjs separately — all of which have hardcoded paths.
 *
 * Usage:
 *   node apply-reference-layout.mjs <target-dir> [options]
 *
 * Options:
 *   --reference <path>  Reference layout source:
 *                         - layout JSON artifact (preferred)
 *                         - decoded-organized directory (manifest.json fallback)
 *   --out <dir>         Write output to a new directory (copy target first)
 *   --dry-run           Show what would change, don't modify files
 *   --stats             Print detailed statistics
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    target: null,
    reference: null,
    out: null,
    dryRun: false,
    stats: false,
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--reference") opts.reference = args[++i];
    else if (a === "--out") opts.out = args[++i];
    else if (a === "--dry-run") opts.dryRun = true;
    else if (a === "--stats") opts.stats = true;
    else if (a === "-h" || a === "--help") {
      console.error(`Usage: node apply-reference-layout.mjs <target-dir> [options]

Options:
  --reference <path>  Reference layout JSON or decoded-organized dir
  --out <dir>         Write output to a new directory
  --dry-run           Show what would change
  --stats             Print statistics`);
      process.exit(0);
    }
    else if (!opts.target) opts.target = a;
  }

  if (!opts.target) {
    console.error("Error: <target-dir> required");
    process.exit(1);
  }

  return opts;
}

function loadLayoutJson(layoutPath) {
  const raw = fs.readFileSync(layoutPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !parsed.modules || typeof parsed.modules !== "object") {
    throw new Error(`Invalid layout JSON (missing modules object): ${layoutPath}`);
  }
  return parsed.modules;
}

function loadManifestModules(manifestPath) {
  const raw = fs.readFileSync(manifestPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || !parsed.modules || typeof parsed.modules !== "object") {
    throw new Error(`Invalid manifest (missing modules object): ${manifestPath}`);
  }
  return parsed.modules;
}

function findLayoutInDirectory(dirPath) {
  if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) return null;
  const entries = fs.readdirSync(dirPath).filter(n => /^layout-v[\d.]+\.json$/.test(n)).sort().reverse();
  if (entries.length === 0) return null;
  return path.join(dirPath, entries[0]);
}

function resolveReferenceLayout(referenceOpt) {
  const candidates = [];
  if (referenceOpt) {
    candidates.push(path.resolve(referenceOpt));
  } else {
    const cwdPrimary = path.join(process.cwd(), "versions", "2026-02-28_v2.1.63");
    const cwdNestedPrimary = path.join(process.cwd(), "clau-decode", "versions", "2026-02-28_v2.1.63");
    const srcPrimary = path.resolve(__dirname, "..", "versions", "2026-02-28_v2.1.63");
    const siblingPrimary = path.resolve(__dirname, "..", "..", "clau-decode", "versions", "2026-02-28_v2.1.63");
    candidates.push(path.join(cwdPrimary, "artifacts", "layout-v2.1.63.json"));
    candidates.push(path.join(cwdPrimary, "decoded-organized"));
    candidates.push(path.join(cwdNestedPrimary, "artifacts", "layout-v2.1.63.json"));
    candidates.push(path.join(cwdNestedPrimary, "decoded-organized"));
    candidates.push(path.join(srcPrimary, "artifacts", "layout-v2.1.63.json"));
    candidates.push(path.join(srcPrimary, "decoded-organized"));
    candidates.push(path.join(siblingPrimary, "artifacts", "layout-v2.1.63.json"));
    candidates.push(path.join(siblingPrimary, "decoded-organized"));
  }

  for (const candidate of candidates) {
    if (!candidate || !fs.existsSync(candidate)) continue;
    const st = fs.statSync(candidate);
    if (st.isFile()) {
      if (path.extname(candidate) === ".json") {
        const modules = loadLayoutJson(candidate);
        return { modules, sourcePath: candidate, sourceKind: "layout-json" };
      }
      continue;
    }
    if (st.isDirectory()) {
      const layoutJson = findLayoutInDirectory(candidate);
      if (layoutJson) {
        const modules = loadLayoutJson(layoutJson);
        return { modules, sourcePath: layoutJson, sourceKind: "layout-json" };
      }
      const manifestPath = path.join(candidate, "manifest.json");
      if (fs.existsSync(manifestPath)) {
        const modules = loadManifestModules(manifestPath);
        return { modules, sourcePath: manifestPath, sourceKind: "manifest-fallback" };
      }
    }
  }

  throw new Error(
    `Could not resolve reference layout source${
      referenceOpt ? ` from "${referenceOpt}"` : ""
    }. Expected a layout JSON or decoded-organized directory with manifest.json.`,
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const opts = parseArgs();
const sourceTargetDir = path.resolve(opts.target);
let targetDir = sourceTargetDir;
if (opts.out) {
  const outDir = path.resolve(opts.out);
  if (opts.dryRun) {
    console.log(`[dry-run] Would copy target to output dir: ${sourceTargetDir} -> ${outDir}`);
  } else {
    if (fs.existsSync(outDir)) {
      console.error(`Error: output directory already exists: ${outDir}`);
      process.exit(1);
    }
    fs.mkdirSync(path.dirname(outDir), { recursive: true });
    fs.cpSync(sourceTargetDir, outDir, { recursive: true });
    targetDir = outDir;
  }
}

const { modules: refModules, sourcePath: refSourcePath, sourceKind: refSourceKind } = resolveReferenceLayout(opts.reference);
const targetManifest = JSON.parse(fs.readFileSync(path.join(targetDir, "manifest.json"), "utf8"));

console.log(`Reference: ${refSourcePath} (${refSourceKind})`);
console.log(`Target:    ${targetDir}`);
console.log(`Modules:   ${Object.keys(refModules).length} ref, ${Object.keys(targetManifest.modules).length} target`);
console.log();

// Detect concatenated vendor files in the reference (old resplit format:
// multiple modules share vendor/<pkg>.js). For these, we keep individual files
// but move them to vendor/<pkg>/ directory.
const refFileCounts = {};
for (const meta of Object.values(refModules)) {
  refFileCounts[meta.file] = (refFileCounts[meta.file] || 0) + 1;
}
const concatenatedFiles = new Set(
  Object.entries(refFileCounts)
    .filter(([f, c]) => c > 1 && f.startsWith("vendor/"))
    .map(([f]) => f)
);

// Per-package counters for individual vendor file naming
const vendorPkgCounters = new Map();

// Build the move plan: for each module in target, check if ref has a different path
const moves = [];       // { modId, from, to, vendorChange }
const noRef = [];       // modules in target but not in ref
const noTarget = [];    // modules in ref but not in target
let alreadyCorrect = 0;

for (const [modId, targetMeta] of Object.entries(targetManifest.modules)) {
  const refMeta = refModules[modId];
  if (!refMeta) {
    noRef.push(modId);
    continue;
  }

  const targetFile = targetMeta.file;
  let refFile = refMeta.file;

  // Handle concatenated vendor files: ref says "vendor/aws-sdk.js" (old format)
  // but we want to keep individual files. Use "vendor/<pkg>/<NNNN>.js" instead.
  if (concatenatedFiles.has(refFile)) {
    const pkg = refFile.replace("vendor/", "").replace(".js", "");
    if (!vendorPkgCounters.has(pkg)) vendorPkgCounters.set(pkg, 1);
    const idx = vendorPkgCounters.get(pkg);
    vendorPkgCounters.set(pkg, idx + 1);

    // Keep the target's basename if it's already in the right vendor dir
    const targetBasename = path.basename(targetFile);
    if (targetFile.startsWith(`vendor/${pkg}/`)) {
      refFile = targetFile; // already in the right place
    } else {
      refFile = `vendor/${pkg}/${String(idx).padStart(4, "0")}.js`;
    }
  }
  // For non-concatenated vendor files: keep the original numeric basename (NNNN.js)
  // from resplit, only change the directory to match the reference layout.
  // This prevents vendor files from being renamed to descriptive names.
  else if (refMeta.vendor) {
    const targetBasename = path.basename(targetFile);   // e.g. "1198.js"
    const refDirPart = path.dirname(refFile);           // e.g. "vendor/lodash"
    refFile = path.join(refDirPart, targetBasename);    // "vendor/lodash/1198.js"
  }

  if (targetFile === refFile) {
    alreadyCorrect++;
    continue;
  }

  moves.push({
    modId,
    from: targetFile,
    to: refFile,
    vendorChange: refMeta.vendor && !targetMeta.vendor,
    newVendor: !!refMeta.vendor,
    newVendorPackage: refMeta.vendorPackage || null,
  });
}

for (const modId of Object.keys(refModules)) {
  if (!targetManifest.modules[modId]) noTarget.push(modId);
}

console.log(`Already correct: ${alreadyCorrect}`);
console.log(`Need to move:    ${moves.length}`);
console.log(`  Vendor reclassify: ${moves.filter(m => m.vendorChange).length}`);
console.log(`  Dir change only:   ${moves.filter(m => !m.vendorChange).length}`);
console.log(`No ref match:    ${noRef.length} (new modules, left as-is)`);
console.log(`Missing in target: ${noTarget.length} (removed modules)`);
console.log();

if (opts.dryRun) {
  // Show sample moves
  const samples = moves.slice(0, 20);
  console.log("=== Sample moves ===");
  for (const m of samples) {
    const tag = m.vendorChange ? " [→vendor]" : "";
    console.log(`  ${m.from} → ${m.to}${tag}`);
  }
  if (moves.length > 20) console.log(`  ... and ${moves.length - 20} more`);
  console.log();
  console.log("Dry run — no files modified.");
  process.exit(0);
}

// ─── Execute moves ────────────────────────────────────────────────────────────

let moved = 0, skipped = 0;
const createdDirs = new Set();
const fileOrderMap = new Map(); // old path → new path

for (const m of moves) {
  const srcPath = path.join(targetDir, m.from);
  const dstPath = path.join(targetDir, m.to);

  if (!fs.existsSync(srcPath)) {
    skipped++;
    continue;
  }

  // Create destination directory
  const dstDir = path.dirname(dstPath);
  if (!createdDirs.has(dstDir)) {
    fs.mkdirSync(dstDir, { recursive: true });
    createdDirs.add(dstDir);
  }

  // Check for collision
  if (fs.existsSync(dstPath) && srcPath !== dstPath) {
    // Append module ID to avoid collision
    const ext = path.extname(m.to);
    const base = m.to.slice(0, -ext.length);
    const newTo = `${base}-${m.modId}${ext}`;
    const newDstPath = path.join(targetDir, newTo);
    fs.renameSync(srcPath, newDstPath);
    m.to = newTo;
  } else {
    fs.renameSync(srcPath, dstPath);
  }

  // Update manifest — always sync vendor flag with reference
  targetManifest.modules[m.modId].file = m.to;
  targetManifest.modules[m.modId].vendor = m.newVendor;
  if (m.newVendorPackage) {
    targetManifest.modules[m.modId].vendorPackage = m.newVendorPackage;
  } else {
    delete targetManifest.modules[m.modId].vendorPackage;
  }

  fileOrderMap.set(m.from, m.to);
  moved++;
}

// Sync vendor flags for all modules (including those that didn't need moving)
for (const [modId, refMeta] of Object.entries(refModules)) {
  if (!targetManifest.modules[modId]) continue;
  targetManifest.modules[modId].vendor = !!refMeta.vendor;
  if (refMeta.vendorPackage) {
    targetManifest.modules[modId].vendorPackage = refMeta.vendorPackage;
  } else {
    delete targetManifest.modules[modId].vendorPackage;
  }
}

// Update fileOrder
if (targetManifest.fileOrder) {
  targetManifest.fileOrder = targetManifest.fileOrder.map(f => fileOrderMap.get(f) || f);
}

// Update sourceOrder
if (targetManifest.sourceOrder) {
  for (const entry of targetManifest.sourceOrder) {
    if (entry.file && fileOrderMap.has(entry.file)) {
      entry.file = fileOrderMap.get(entry.file);
    }
  }
}

// Add metadata
targetManifest._meta = {
  ...targetManifest._meta,
  layoutAppliedFrom: refSourcePath,
  layoutAppliedSourceKind: refSourceKind,
  layoutAppliedAt: new Date().toISOString(),
};

// Write updated manifest
fs.writeFileSync(
  path.join(targetDir, "manifest.json"),
  JSON.stringify(targetManifest, null, 2)
);

// Clean up empty directories
function removeEmptyDirs(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      removeEmptyDirs(path.join(dir, entry.name));
    }
  }
  try {
    const entries = fs.readdirSync(dir);
    if (entries.length === 0) {
      fs.rmdirSync(dir);
    }
  } catch (e) { /* ignore */ }
}
removeEmptyDirs(targetDir);

console.log(`Moved:   ${moved} files`);
console.log(`Skipped: ${skipped} (source not found)`);
console.log(`Dirs created: ${createdDirs.size}`);
console.log(`Manifest updated.`);

if (opts.stats) {
  console.log();
  console.log("=== Post-layout stats ===");
  let vendorCount = 0, appCount = 0;
  const dirs = new Set();
  for (const [, meta] of Object.entries(targetManifest.modules)) {
    if (meta.vendor) vendorCount++;
    else appCount++;
    const dir = meta.file.split("/").slice(0, -1).join("/") || ".";
    dirs.add(dir);
  }
  console.log(`  App modules:    ${appCount}`);
  console.log(`  Vendor modules: ${vendorCount}`);
  console.log(`  Directories:    ${dirs.size}`);
}
