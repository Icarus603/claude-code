#!/usr/bin/env node
/**
 * organize.mjs — Module organization tool
 *
 * Organizes flat numbered app modules into a meaningful directory tree
 * based on Louvain cluster membership and dependency affinity.
 *
 * 4-layer assignment:
 *   1. Cluster membership (from clusters-core.json)
 *   2. Function-level affinity (cross-module edges in deps-graph.json)
 *   3. Manifest-level affinity (module deps in manifest.json)
 *   4. Remaining → uncategorized/
 *
 * Usage:
 *   node organize.mjs <decoded-resplit-dir> [options]
 *
 * Options:
 *   --out <dir>        Output directory (default: sibling decoded-organized/)
 *   --affinity <0-1>   Affinity threshold (default: 0.4)
 *   --dry-run          Show assignments without copying
 *   --stats            Show category distribution
 *   --no-index         Skip INDEX.md generation
 *   -h, --help         Show help
 */

import fs from "fs";
import path from "path";

// ─── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
let resplitDir = null;
let outDir = null;
let affinityThreshold = 0.4;
let dryRun = false;
let showStats = false;
let noIndex = false;

for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === "-h" || a === "--help") {
    console.log(`Usage: node organize.mjs <decoded-resplit-dir> [options]

Options:
  --out <dir>        Output directory (default: sibling decoded-organized/)
  --affinity <0-1>   Affinity threshold (default: 0.4)
  --dry-run          Show assignments without copying
  --stats            Show category distribution
  --no-index         Skip INDEX.md generation
  -h, --help         Show help`);
    process.exit(0);
  } else if (a === "--out") {
    outDir = args[++i];
  } else if (a === "--affinity") {
    affinityThreshold = parseFloat(args[++i]);
  } else if (a === "--dry-run") {
    dryRun = true;
  } else if (a === "--stats") {
    showStats = true;
  } else if (a === "--no-index") {
    noIndex = true;
  } else if (!resplitDir) {
    resplitDir = a;
  }
}

if (!resplitDir) {
  console.error("Error: <decoded-resplit-dir> is required");
  process.exit(1);
}

resplitDir = path.resolve(resplitDir);
if (!outDir) {
  outDir = path.join(path.dirname(resplitDir), "decoded-organized");
}
outDir = path.resolve(outDir);

// ─── Load inputs ──────────────────────────────────────────────────────────────

function loadJSON(filepath) {
  return JSON.parse(fs.readFileSync(filepath, "utf8"));
}

const projectRoot = path.dirname(import.meta.url.replace("file://", ""));

console.log("Loading inputs...");
const manifest = loadJSON(path.join(resplitDir, "manifest.json"));
const clustersData = loadJSON(path.join(projectRoot, "clusters-core.json"));
const labelsData = loadJSON(path.join(projectRoot, "cluster-labels.json"));
const depsGraph = loadJSON(path.join(projectRoot, "deps-graph.json"));

// ─── Phase 1: Assign every module to a directory ──────────────────────────────

// Build file→cluster map from clusters-core.json
const file2cluster = new Map();
for (const [clusterId, cluster] of Object.entries(clustersData.clusters)) {
  for (const file of cluster.members) {
    file2cluster.set(file, clusterId);
  }
}

// Build cluster→directory map from cluster-labels.json
const cluster2dir = new Map();
for (const [clusterId, info] of Object.entries(labelsData.clusters)) {
  cluster2dir.set(clusterId, info.directory);
}

// Collect app module filenames
const appFiles = [];
for (const [, mod] of Object.entries(manifest.modules)) {
  if (!mod.vendor && mod.file && !mod.file.startsWith("vendor/")) {
    appFiles.push(mod.file);
  }
}
// Deduplicate (multiple module IDs can share a file)
const appFileSet = new Set(appFiles);

// Build file→moduleIds map for manifest dep lookup
const file2moduleIds = new Map();
for (const [id, mod] of Object.entries(manifest.modules)) {
  if (!mod.vendor) {
    const f = mod.file;
    if (!file2moduleIds.has(f)) file2moduleIds.set(f, []);
    file2moduleIds.get(f).push(id);
  }
}

// Build moduleId→file map
const id2file = new Map();
for (const [id, mod] of Object.entries(manifest.modules)) {
  id2file.set(id, mod.file);
}

// Build reverse deps: file→files that depend on it
const fileDeps = new Map(); // file → Set<dep files>
const fileRevDeps = new Map(); // file → Set<files that depend on it>
for (const [id, mod] of Object.entries(manifest.modules)) {
  if (mod.vendor) continue;
  const f = mod.file;
  if (!fileDeps.has(f)) fileDeps.set(f, new Set());
  for (const depId of mod.deps) {
    const depFile = id2file.get(depId);
    if (depFile && !manifest.modules[depId]?.vendor) {
      fileDeps.get(f).add(depFile);
      if (!fileRevDeps.has(depFile)) fileRevDeps.set(depFile, new Set());
      fileRevDeps.get(depFile).add(f);
    }
  }
}

const assignments = new Map(); // file → { dir, layer }
const layerCounts = { cluster: 0, fnAffinity: 0, depAffinity: 0, uncategorized: 0 };

// Layer 1: Direct cluster membership
for (const file of appFileSet) {
  const clusterId = file2cluster.get(file);
  if (clusterId !== undefined) {
    const dir = cluster2dir.get(clusterId);
    if (dir) {
      assignments.set(file, { dir, layer: 1, clusterId });
      layerCounts.cluster++;
    }
  }
}

// Helper: vote for cluster affinity based on neighbor files
function voteForCluster(neighborFiles) {
  const votes = new Map(); // clusterId → count
  let total = 0;
  for (const neighbor of neighborFiles) {
    const a = assignments.get(neighbor);
    if (a && a.clusterId !== undefined) {
      const cid = a.clusterId;
      votes.set(cid, (votes.get(cid) || 0) + 1);
      total++;
    }
  }
  if (total === 0) return null;
  // Find max vote
  let bestCluster = null, bestCount = 0;
  for (const [cid, count] of votes) {
    if (count > bestCount) {
      bestCount = count;
      bestCluster = cid;
    }
  }
  if (bestCount / total >= affinityThreshold) {
    return bestCluster;
  }
  return null;
}

// Layer 2: Function-level affinity (deps-graph cross-module edges)
for (const file of appFileSet) {
  if (assignments.has(file)) continue;
  const modGraph = depsGraph.modules?.[file];
  if (!modGraph) continue;

  // Collect all cross-module neighbor files
  const neighbors = new Set();
  for (const [, fnInfo] of Object.entries(modGraph.functions || {})) {
    for (const call of fnInfo.calls || []) {
      if (call.type === "cross-module" && call.file) neighbors.add(call.file);
    }
    for (const caller of fnInfo.calledBy || []) {
      if (caller.type === "cross-module" && caller.file) neighbors.add(caller.file);
    }
  }

  const bestCluster = voteForCluster(neighbors);
  if (bestCluster !== null) {
    const dir = cluster2dir.get(bestCluster);
    if (dir) {
      assignments.set(file, { dir, layer: 2, clusterId: bestCluster });
      layerCounts.fnAffinity++;
    }
  }
}

// Layer 3: Manifest-level affinity (module deps both directions)
for (const file of appFileSet) {
  if (assignments.has(file)) continue;

  const neighbors = new Set();
  // Forward deps
  const deps = fileDeps.get(file);
  if (deps) for (const d of deps) neighbors.add(d);
  // Reverse deps
  const revDeps = fileRevDeps.get(file);
  if (revDeps) for (const d of revDeps) neighbors.add(d);

  const bestCluster = voteForCluster(neighbors);
  if (bestCluster !== null) {
    const dir = cluster2dir.get(bestCluster);
    if (dir) {
      assignments.set(file, { dir, layer: 3, clusterId: bestCluster });
      layerCounts.depAffinity++;
    }
  }
}

// Layer 4: Remaining → uncategorized
for (const file of appFileSet) {
  if (!assignments.has(file)) {
    assignments.set(file, { dir: "uncategorized", layer: 4 });
    layerCounts.uncategorized++;
  }
}

// ─── Stats ────────────────────────────────────────────────────────────────────

// Directory distribution
const dirStats = new Map(); // dir → { cluster: n, affinity: n }
for (const [, info] of assignments) {
  if (!dirStats.has(info.dir)) dirStats.set(info.dir, { cluster: 0, affinity: 0, total: 0 });
  const s = dirStats.get(info.dir);
  s.total++;
  if (info.layer === 1) s.cluster++;
  else s.affinity++;
}

console.log(`\nAssignment summary:`);
console.log(`  Layer 1 (cluster):      ${layerCounts.cluster} modules`);
console.log(`  Layer 2 (fn affinity):   ${layerCounts.fnAffinity} modules`);
console.log(`  Layer 3 (dep affinity):  ${layerCounts.depAffinity} modules`);
console.log(`  Layer 4 (uncategorized): ${layerCounts.uncategorized} modules`);
console.log(`  Total:                   ${assignments.size} modules`);

if (showStats || dryRun) {
  console.log(`\nDirectory distribution:`);
  const sorted = [...dirStats.entries()].sort((a, b) => b[1].total - a[1].total);
  for (const [dir, s] of sorted) {
    const label = labelsData.clusters
      ? Object.values(labelsData.clusters).find(c => c.directory === dir)?.label || ""
      : "";
    const parts = [];
    if (s.cluster) parts.push(`${s.cluster} cluster`);
    if (s.affinity) parts.push(`${s.affinity} affinity`);
    console.log(`  ${dir.padEnd(24)} ${String(s.total).padStart(4)} modules  (${parts.join(" + ")})${label ? "  — " + label : ""}`);
  }
}

if (dryRun) {
  console.log("\n(dry run — no files copied)");
  process.exit(0);
}

// ─── Phase 2: Copy files into organized tree ─────────────────────────────────

console.log(`\nCopying to ${outDir}...`);

// Clean output dir if exists
if (fs.existsSync(outDir)) {
  fs.rmSync(outDir, { recursive: true });
}
fs.mkdirSync(outDir, { recursive: true });

// Copy organized app modules
const createdDirs = new Set();
for (const [file, info] of assignments) {
  const destDir = path.join(outDir, info.dir);
  if (!createdDirs.has(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
    createdDirs.add(destDir);
  }
  const src = path.join(resplitDir, file);
  const dest = path.join(destDir, file);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
  }
}

// Copy vendor directory as-is
const vendorSrc = path.join(resplitDir, "vendor");
if (fs.existsSync(vendorSrc)) {
  fs.cpSync(vendorSrc, path.join(outDir, "vendor"), { recursive: true });
  console.log("  Copied vendor/");
}

// Copy special files
for (const special of ["00-runtime.js", "graph.json"]) {
  const src = path.join(resplitDir, special);
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, path.join(outDir, special));
  }
}

console.log(`  Copied ${assignments.size} app modules into ${createdDirs.size} directories`);

// ─── Phase 3: Write organized manifest ────────────────────────────────────────

const orgManifest = JSON.parse(JSON.stringify(manifest));
orgManifest._meta.organizedAt = new Date().toISOString();
orgManifest._meta.organizeTool = "organize.mjs";

// Build file→new path map
const filePathMap = new Map();
for (const [file, info] of assignments) {
  filePathMap.set(file, `${info.dir}/${file}`);
}

// Update module file paths
for (const [, mod] of Object.entries(orgManifest.modules)) {
  if (!mod.vendor && filePathMap.has(mod.file)) {
    mod.file = filePathMap.get(mod.file);
  }
}

// Update fileOrder
orgManifest.fileOrder = orgManifest.fileOrder.map(f => filePathMap.get(f) || f);

fs.writeFileSync(
  path.join(outDir, "manifest.json"),
  JSON.stringify(orgManifest, null, 2)
);
console.log("  Wrote manifest.json");

// ─── Phase 4: Generate INDEX.md ──────────────────────────────────────────────

if (!noIndex) {
  // Build calledBy counts per function per file
  const fnPopularity = new Map(); // "file:fnName" → calledBy count

  for (const [file, modInfo] of Object.entries(depsGraph.modules || {})) {
    for (const [fnName, fnInfo] of Object.entries(modInfo.functions || {})) {
      const calledBy = (fnInfo.calledBy || []).length;
      if (calledBy > 0 && fnName !== "<module-init>") {
        fnPopularity.set(`${file}:${fnName}`, calledBy);
      }
    }
  }

  // Group by directory
  const dirFiles = new Map(); // dir → [files]
  for (const [file, info] of assignments) {
    if (!dirFiles.has(info.dir)) dirFiles.set(info.dir, []);
    dirFiles.get(info.dir).push(file);
  }

  let index = `# Organized Module Index\n\n`;
  index += `Generated: ${new Date().toISOString()}\n`;
  index += `Source: ${resplitDir}\n`;
  index += `Total: ${appFileSet.size} app modules in ${createdDirs.size} directories\n\n`;
  index += `## Summary\n\n`;
  index += `| Layer | Count |\n|-------|-------|\n`;
  index += `| Cluster membership | ${layerCounts.cluster} |\n`;
  index += `| Function affinity | ${layerCounts.fnAffinity} |\n`;
  index += `| Dep affinity | ${layerCounts.depAffinity} |\n`;
  index += `| Uncategorized | ${layerCounts.uncategorized} |\n\n`;
  index += `---\n\n`;

  const sortedDirs = [...dirFiles.entries()].sort((a, b) => b[1].length - a[1].length);

  for (const [dir, files] of sortedDirs) {
    // Find label
    const labelInfo = Object.values(labelsData.clusters).find(c => c.directory === dir);
    const label = labelInfo?.label || "";

    index += `## ${dir}/ (${files.length} modules)`;
    if (label) index += ` — ${label}`;
    index += `\n\n`;

    // Find top functions in this directory
    const topFns = [];
    for (const file of files) {
      for (const [key, count] of fnPopularity) {
        if (key.startsWith(`${file}:`)) {
          topFns.push({ file, name: key.split(":")[1], count });
        }
      }
    }
    topFns.sort((a, b) => b.count - a.count);

    if (topFns.length > 0) {
      const top = topFns.slice(0, 8);
      index += `Key functions: `;
      index += top.map(f => `\`${f.name}\` (${f.file}, ${f.count} callers)`).join(", ");
      index += `\n\n`;
    }

    if (labelInfo?.keyModules?.length) {
      index += `Key modules: ${labelInfo.keyModules.join(", ")}\n\n`;
    }
  }

  fs.writeFileSync(path.join(outDir, "INDEX.md"), index);
  console.log("  Wrote INDEX.md");
}

console.log("\nDone!");
