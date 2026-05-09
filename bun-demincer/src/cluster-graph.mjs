#!/usr/bin/env node

/**
 * cluster-graph.mjs — Graph clustering + visualization for function-level dependency graph
 *
 * Loads deps-graph.json, builds a graphology directed graph of cross-module calls,
 * runs Louvain community detection with resolution sweep, and renders beautiful PNGs
 * using ForceAtlas2 layout + node-canvas.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, basename } from "path";
import Graph from "graphology";
import louvain from "graphology-communities-louvain";
import forceAtlas2 from "graphology-layout-forceatlas2";
import { createCanvas } from "canvas";

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
Usage: node cluster-graph.mjs <deps-graph.json> [options]

Arguments:
  <deps-graph.json>     Path to deps-graph.json from extract-deps.mjs

Options:
  --resolution <n>      Single Louvain resolution (default: sweep 0.5-5.0)
  --sweep               Run full resolution sweep and show comparison table (default)
  --pick <n>            Pick specific resolution and output files
  --out <prefix>        Output file prefix (default: "clusters")
  --png                 Generate PNG visualization(s)
  --png-size <n>        PNG dimensions in pixels (default: 4096)
  --manifest <path>     Path to manifest.json for extra module metadata
  --min-edges <n>       Minimum cross-module edges for a module to be included (default: 1)
  --stats               Show detailed cluster statistics
  -h, --help
  `);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    graphPath: null,
    resolution: null,
    sweep: true,
    pick: null,
    out: "clusters",
    png: false,
    pngSize: 4096,
    manifestPath: null,
    minEdges: 1,
    stats: false,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case "--resolution":
        opts.resolution = parseFloat(args[++i]);
        opts.sweep = false;
        i++;
        break;
      case "--sweep":
        opts.sweep = true;
        i++;
        break;
      case "--pick":
        opts.pick = parseFloat(args[++i]);
        opts.sweep = false;
        i++;
        break;
      case "--out":
        opts.out = args[++i];
        i++;
        break;
      case "--png":
        opts.png = true;
        i++;
        break;
      case "--png-size":
        opts.pngSize = parseInt(args[++i], 10);
        i++;
        break;
      case "--manifest":
        opts.manifestPath = args[++i];
        i++;
        break;
      case "--min-edges":
        opts.minEdges = parseInt(args[++i], 10);
        i++;
        break;
      case "--stats":
        opts.stats = true;
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
        if (!opts.graphPath) {
          opts.graphPath = args[i];
          i++;
        } else {
          console.error(`Unexpected argument: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  if (!opts.graphPath) {
    console.error("Error: <deps-graph.json> is required");
    printUsage();
    process.exit(1);
  }

  return opts;
}

// ---------------------------------------------------------------------------
// Build graphology graph from deps-graph.json
// ---------------------------------------------------------------------------

function buildGraph(depsGraph, minEdges) {
  const graph = new Graph({ type: "directed", allowSelfLoops: false, multi: false });

  // Count cross-module edges per module
  const edgeCounts = {};
  for (const [file, modData] of Object.entries(depsGraph.modules)) {
    let count = 0;
    for (const [, fnData] of Object.entries(modData.functions)) {
      for (const call of fnData.calls) {
        if (call.type === "cross-module" && call.file && call.file !== file) {
          count++;
        }
      }
      for (const caller of fnData.calledBy) {
        if (caller.type === "cross-module" && caller.file !== file) {
          count++;
        }
      }
    }
    edgeCounts[file] = count;
  }

  // Add nodes (modules with enough edges)
  const nodeSet = new Set();
  for (const [file, modData] of Object.entries(depsGraph.modules)) {
    if (edgeCounts[file] >= minEdges) {
      const fnCount = Object.keys(modData.functions).filter(
        (f) => f !== "<module-init>"
      ).length;
      graph.addNode(file, {
        moduleName: modData.moduleName,
        functions: fnCount,
        label: file.replace(".js", ""),
      });
      nodeSet.add(file);
    }
  }

  // Add edges with weights (number of cross-module function calls between modules)
  const edgeWeights = new Map(); // "src→tgt" → weight
  for (const [file, modData] of Object.entries(depsGraph.modules)) {
    if (!nodeSet.has(file)) continue;
    for (const [, fnData] of Object.entries(modData.functions)) {
      for (const call of fnData.calls) {
        if (
          call.type === "cross-module" &&
          call.file &&
          call.file !== file &&
          nodeSet.has(call.file)
        ) {
          const key = `${file}→${call.file}`;
          edgeWeights.set(key, (edgeWeights.get(key) || 0) + 1);
        }
      }
    }
  }

  for (const [key, weight] of edgeWeights) {
    const [src, tgt] = key.split("→");
    if (!graph.hasEdge(src, tgt)) {
      graph.addEdge(src, tgt, { weight });
    }
  }

  return graph;
}

// ---------------------------------------------------------------------------
// Louvain clustering with resolution sweep
// ---------------------------------------------------------------------------

function runLouvainSweep(graph, resolutions) {
  const results = [];

  for (const resolution of resolutions) {
    const communities = louvain.detailed(graph, {
      getEdgeWeight: "weight",
      resolution,
    });

    // Compute cluster sizes
    const clusterSizes = {};
    for (const [, community] of Object.entries(communities.communities)) {
      clusterSizes[community] = (clusterSizes[community] || 0) + 1;
    }
    const sizes = Object.values(clusterSizes).sort((a, b) => b - a);

    results.push({
      resolution,
      count: communities.count,
      modularity: communities.modularity,
      communities: communities.communities,
      sizes,
      largest: sizes[0],
      smallest: sizes[sizes.length - 1],
      median: sizes[Math.floor(sizes.length / 2)],
      singletons: sizes.filter((s) => s === 1).length,
    });
  }

  return results;
}

// ---------------------------------------------------------------------------
// ForceAtlas2 layout
// ---------------------------------------------------------------------------

function computeLayout(graph, iterations = 1200) {
  // Assign random initial positions (seeded for reproducibility)
  let seed = 42;
  function seededRandom() {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  }
  graph.forEachNode((node) => {
    graph.setNodeAttribute(node, "x", seededRandom() * 1000 - 500);
    graph.setNodeAttribute(node, "y", seededRandom() * 1000 - 500);
  });

  // Infer good settings and tune for tight, clustered layout
  const settings = forceAtlas2.inferSettings(graph);
  settings.gravity = 0.1;
  settings.scalingRatio = 8;
  settings.barnesHutOptimize = true;
  settings.barnesHutTheta = 0.5;
  settings.slowDown = 3;
  settings.strongGravityMode = true;

  // Run layout
  forceAtlas2.assign(graph, { iterations, settings });

  return graph;
}

// ---------------------------------------------------------------------------
// PNG rendering
// ---------------------------------------------------------------------------

// Vibrant color palette for clusters (30 distinct colors)
const CLUSTER_COLORS = [
  "#E74C3C", // red
  "#3498DB", // blue
  "#2ECC71", // green
  "#F39C12", // orange
  "#9B59B6", // purple
  "#1ABC9C", // teal
  "#E67E22", // dark orange
  "#E91E63", // pink
  "#00BCD4", // cyan
  "#8BC34A", // lime
  "#FF5722", // deep orange
  "#607D8B", // blue grey
  "#795548", // brown
  "#CDDC39", // yellow-green
  "#FF9800", // amber
  "#673AB7", // deep purple
  "#009688", // dark teal
  "#03A9F4", // light blue
  "#FFC107", // gold
  "#4CAF50", // mid green
  "#F44336", // bright red
  "#2196F3", // vivid blue
  "#FF6F00", // dark amber
  "#7C4DFF", // violet
  "#00E676", // neon green
  "#FF1744", // neon red
  "#651FFF", // electric purple
  "#00B8D4", // bright cyan
  "#DD2C00", // rust
  "#64DD17", // light green
];

function getClusterColor(clusterId) {
  return CLUSTER_COLORS[clusterId % CLUSTER_COLORS.length];
}

function hexToRgba(hex, alpha) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function renderPNG(graph, communities, outputPath, size, title, clusterLabels, depsGraph) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");

  // Dark background with subtle gradient
  const bgGrad = ctx.createLinearGradient(0, 0, 0, size);
  bgGrad.addColorStop(0, "#0D1117");
  bgGrad.addColorStop(1, "#161B22");
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, size, size);

  // Gather positions
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  graph.forEachNode((node) => {
    const x = graph.getNodeAttribute(node, "x");
    const y = graph.getNodeAttribute(node, "y");
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  });

  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const margin = size * 0.06;
  const plotSize = size - 2 * margin;
  const scale = Math.min(plotSize / rangeX, plotSize / rangeY);
  const offsetX = margin + (plotSize - rangeX * scale) / 2;
  const offsetY = margin + (plotSize - rangeY * scale) / 2;

  function toScreen(nodeX, nodeY) {
    return [
      offsetX + (nodeX - minX) * scale,
      offsetY + (nodeY - minY) * scale,
    ];
  }

  // Build node label map: file → best function name
  const nodeLabelMap = {};
  if (depsGraph) {
    for (const [file, modData] of Object.entries(depsGraph.modules)) {
      let bestFn = null;
      let bestCallers = -1;
      for (const [fnName, fnData] of Object.entries(modData.functions)) {
        if (fnName === "<module-init>") continue;
        if (fnData.calledBy.length > bestCallers) {
          bestCallers = fnData.calledBy.length;
          bestFn = fnName;
        }
      }
      if (!bestFn) {
        // Fall back to first non-init function
        for (const fnName of Object.keys(modData.functions)) {
          if (fnName !== "<module-init>") { bestFn = fnName; break; }
        }
      }
      nodeLabelMap[file] = bestFn || file.replace(".js", "");
    }
  }

  const maxDegree = Math.max(1, ...graph.nodes().map((n) => graph.degree(n)));

  // Draw edges — intra-cluster colored, inter-cluster grey
  graph.forEachEdge((edge, attrs, src, tgt) => {
    const srcComm = communities[src];
    const tgtComm = communities[tgt];
    const w = attrs.weight || 1;
    const [x1, y1] = toScreen(
      graph.getNodeAttribute(src, "x"),
      graph.getNodeAttribute(src, "y")
    );
    const [x2, y2] = toScreen(
      graph.getNodeAttribute(tgt, "x"),
      graph.getNodeAttribute(tgt, "y")
    );
    if (srcComm === tgtComm) {
      ctx.strokeStyle = hexToRgba(getClusterColor(srcComm), 0.06 + Math.min(w * 0.01, 0.08));
      ctx.lineWidth = 0.5 + Math.min(w * 0.3, 1.5);
    } else {
      ctx.strokeStyle = hexToRgba("#556677", 0.025);
      ctx.lineWidth = 0.3;
    }
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
  });

  // Draw node glow (all nodes, intensity by degree)
  graph.forEachNode((node) => {
    const deg = graph.degree(node);
    const [x, y] = toScreen(
      graph.getNodeAttribute(node, "x"),
      graph.getNodeAttribute(node, "y")
    );
    const comm = communities[node];
    const t = deg / maxDegree;
    const baseRadius = 3 + t * 20;
    const glowRadius = baseRadius * (2.5 + t * 3);
    const glowAlpha = 0.04 + t * 0.18;
    const gradient = ctx.createRadialGradient(x, y, baseRadius * 0.5, x, y, glowRadius);
    gradient.addColorStop(0, hexToRgba(getClusterColor(comm), glowAlpha));
    gradient.addColorStop(0.4, hexToRgba(getClusterColor(comm), glowAlpha * 0.4));
    gradient.addColorStop(1, hexToRgba(getClusterColor(comm), 0));
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
    ctx.fill();
  });

  // Draw nodes — larger, with bright fill and subtle border
  graph.forEachNode((node) => {
    const deg = graph.degree(node);
    const [x, y] = toScreen(
      graph.getNodeAttribute(node, "x"),
      graph.getNodeAttribute(node, "y")
    );
    const comm = communities[node];
    const t = deg / maxDegree;
    const radius = 2.5 + t * 18;

    // Bright core
    ctx.fillStyle = hexToRgba(getClusterColor(comm), 0.9);
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fill();

    // White highlight on top-left
    if (radius > 4) {
      const hlGrad = ctx.createRadialGradient(
        x - radius * 0.3, y - radius * 0.3, 0,
        x, y, radius
      );
      hlGrad.addColorStop(0, "rgba(255,255,255,0.25)");
      hlGrad.addColorStop(0.5, "rgba(255,255,255,0.05)");
      hlGrad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = hlGrad;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  });

  // Label top nodes with semantic function names
  const nodesByDegree = graph
    .nodes()
    .map((n) => ({ node: n, deg: graph.degree(n) }))
    .sort((a, b) => b.deg - a.deg);

  // Collision avoidance for labels
  const placedLabels = [];
  function labelFits(lx, ly, lw, lh) {
    for (const placed of placedLabels) {
      if (
        lx < placed.x + placed.w + 4 &&
        lx + lw + 4 > placed.x &&
        ly < placed.y + placed.h + 2 &&
        ly + lh + 2 > placed.y
      ) {
        return false;
      }
    }
    return true;
  }

  const topN = Math.min(80, nodesByDegree.length);
  ctx.textBaseline = "middle";

  for (let i = 0; i < topN; i++) {
    const { node, deg } = nodesByDegree[i];
    if (deg < 3) break;
    const [x, y] = toScreen(
      graph.getNodeAttribute(node, "x"),
      graph.getNodeAttribute(node, "y")
    );
    const comm = communities[node];
    const t = deg / maxDegree;
    const radius = 2.5 + t * 18;
    const fontSize = Math.max(10, Math.min(22, 9 + t * 18));

    const label = nodeLabelMap[node] || node.replace(".js", "");

    ctx.font = `bold ${fontSize}px "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
    const metrics = ctx.measureText(label);
    const lw = metrics.width;
    const lh = fontSize;
    const lx = x + radius + 5;
    const ly = y - lh / 2;

    if (!labelFits(lx, ly, lw, lh)) continue;
    placedLabels.push({ x: lx, y: ly, w: lw, h: lh });

    // Shadow
    ctx.textAlign = "left";
    ctx.fillStyle = "rgba(0, 0, 0, 0.8)";
    ctx.fillText(label, lx + 1.5, y + 1.5);
    // Colored text
    ctx.fillStyle = hexToRgba(getClusterColor(comm), 0.95);
    ctx.fillText(label, lx, y);
  }

  // Title bar area
  const titleBarH = margin * 2;
  ctx.fillStyle = "rgba(13, 17, 23, 0.85)";
  ctx.fillRect(0, 0, size, titleBarH);

  // Title
  const titleFontSize = Math.round(size / 55);
  ctx.font = `bold ${titleFontSize}px "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(title, margin, margin * 0.4);

  // Subtitle
  const nodeCount = graph.order;
  const edgeCount = graph.size;
  const clusterCount = new Set(Object.values(communities)).size;
  const subFontSize = Math.round(size / 95);
  ctx.font = `${subFontSize}px "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = "#8B949E";
  ctx.fillText(
    `${nodeCount} modules \u2022 ${edgeCount} cross-module edges \u2022 ${clusterCount} clusters \u2022 Louvain community detection`,
    margin,
    margin * 0.4 + titleFontSize + 8
  );

  // Legend — top clusters as colored pills
  if (clusterLabels) {
    const legendFontSize = Math.round(size / 120);
    const pillH = legendFontSize + 8;
    const pillGap = 6;
    const legendStartX = size - margin;
    const legendStartY = size - margin;
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.font = `bold ${legendFontSize}px "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;

    // Show top 15 clusters
    const topClusters = clusterLabels.slice(0, 15);
    for (let i = topClusters.length - 1; i >= 0; i--) {
      const cl = topClusters[i];
      // Shorter label: just top 2 function names + size
      const shortNames = cl.topFunctions
        .slice(0, 2)
        .map((f) => f.name)
        .join(", ");
      const label = `${shortNames} (${cl.size})`;
      const y = legendStartY - (topClusters.length - 1 - i) * (pillH + pillGap);

      const tw = ctx.measureText(label).width;
      // Pill background
      const px = legendStartX - tw - 24;
      ctx.fillStyle = hexToRgba(getClusterColor(cl.id), 0.15);
      ctx.beginPath();
      const r = pillH / 2;
      ctx.moveTo(px + r, y - pillH / 2);
      ctx.lineTo(legendStartX - r, y - pillH / 2);
      ctx.arcTo(legendStartX, y - pillH / 2, legendStartX, y, r);
      ctx.arcTo(legendStartX, y + pillH / 2, legendStartX - r, y + pillH / 2, r);
      ctx.lineTo(px + r, y + pillH / 2);
      ctx.arcTo(px, y + pillH / 2, px, y, r);
      ctx.arcTo(px, y - pillH / 2, px + r, y - pillH / 2, r);
      ctx.closePath();
      ctx.fill();

      // Color dot
      ctx.fillStyle = getClusterColor(cl.id);
      ctx.beginPath();
      ctx.arc(px + 12, y, 4, 0, Math.PI * 2);
      ctx.fill();

      // Text
      ctx.fillStyle = "#C9D1D9";
      ctx.fillText(label, legendStartX - 8, y);
    }
  }

  // Watermark
  ctx.font = `${Math.round(size / 130)}px "SF Pro Display", "Helvetica Neue", Arial, sans-serif`;
  ctx.fillStyle = "#21262D";
  ctx.textAlign = "left";
  ctx.textBaseline = "bottom";
  ctx.fillText("bun-demincer", margin, size - margin * 0.3);

  // Write PNG
  const buffer = canvas.toBuffer("image/png");
  writeFileSync(outputPath, buffer);
  console.log(
    `  Wrote ${outputPath} (${(buffer.length / 1024 / 1024).toFixed(1)} MB, ${size}x${size})`
  );


}

// For community IDs that may not be sequential
function cycleComm(communityId) {
  return communityId;
}

// ---------------------------------------------------------------------------
// Cluster analysis
// ---------------------------------------------------------------------------

function analyzeCluster(graph, communities, clusterId, depsGraph) {
  const members = Object.entries(communities)
    .filter(([, c]) => c === clusterId)
    .map(([node]) => node);

  // Find top functions in this cluster (by calledBy count)
  const topFunctions = [];
  for (const file of members) {
    const modData = depsGraph.modules[file];
    if (!modData) continue;
    for (const [fnName, fnData] of Object.entries(modData.functions)) {
      if (fnName === "<module-init>") continue;
      topFunctions.push({
        name: fnName,
        file,
        callers: fnData.calledBy.length,
        callees: fnData.calls.length,
      });
    }
  }
  topFunctions.sort((a, b) => b.callers - a.callers);

  return {
    id: clusterId,
    size: members.length,
    members,
    topFunctions: topFunctions.slice(0, 8),
    internalEdges: 0,
    externalEdges: 0,
  };
}

function buildClusterLabels(graph, communities, depsGraph) {
  const clusterIds = [...new Set(Object.values(communities))];
  const analyses = clusterIds.map((id) =>
    analyzeCluster(graph, communities, id, depsGraph)
  );
  analyses.sort((a, b) => b.size - a.size);

  return analyses.map((a) => {
    const topNames = a.topFunctions.slice(0, 3).map((f) => f.name);
    const label = `#${a.id} (${a.size}) ${topNames.join(", ")}`;
    return { id: a.id, label, size: a.size, topFunctions: a.topFunctions };
  });
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();

  // Load deps graph
  if (!existsSync(opts.graphPath)) {
    console.error(`File not found: ${opts.graphPath}`);
    process.exit(1);
  }
  const depsGraph = JSON.parse(readFileSync(opts.graphPath, "utf-8"));
  console.log(`Loaded deps graph: ${depsGraph._meta.modules} modules, ${depsGraph._meta.crossModule} cross-module edges`);

  // Load manifest if provided
  let manifest = null;
  if (opts.manifestPath && existsSync(opts.manifestPath)) {
    manifest = JSON.parse(readFileSync(opts.manifestPath, "utf-8"));
    console.log(`Loaded manifest: ${Object.keys(manifest.modules).length} modules`);
  }

  // Build graphology graph
  const graph = buildGraph(depsGraph, opts.minEdges);
  console.log(`Built graph: ${graph.order} nodes, ${graph.size} edges (min-edges: ${opts.minEdges})`);

  if (graph.order === 0) {
    console.error("No nodes in graph. Try lowering --min-edges.");
    process.exit(1);
  }

  // Sweep or single run
  if (opts.sweep && !opts.pick) {
    const resolutions = [0.3, 0.5, 0.7, 0.8, 1.0, 1.2, 1.5, 2.0, 2.5, 3.0, 4.0, 5.0, 7.0, 10.0];
    console.log(`\nRunning Louvain sweep across ${resolutions.length} resolutions...`);

    const results = runLouvainSweep(graph, resolutions);

    // Print comparison table
    console.log(`\n${"Res".padStart(6)} | ${"Clusters".padStart(8)} | ${"Mod".padStart(7)} | ${"Largest".padStart(7)} | ${"Median".padStart(6)} | ${"Small".padStart(5)} | ${"Singletons".padStart(10)} | Size distribution`);
    console.log("-".repeat(95));

    for (const r of results) {
      const dist = r.sizes
        .slice(0, 8)
        .map((s) => String(s))
        .join(", ");
      console.log(
        `${r.resolution.toFixed(1).padStart(6)} | ${String(r.count).padStart(8)} | ${r.modularity.toFixed(4).padStart(7)} | ${String(r.largest).padStart(7)} | ${String(r.median).padStart(6)} | ${String(r.smallest).padStart(5)} | ${String(r.singletons).padStart(10)} | ${dist}${r.sizes.length > 8 ? "..." : ""}`
      );
    }

    console.log(`\nUse --pick <resolution> to select one and generate output files.`);

    // If PNG requested, render the best resolution by modularity
    if (opts.png) {
      const best = results.reduce((a, b) =>
        a.modularity > b.modularity ? a : b
      );
      console.log(
        `\nRendering PNG for best modularity: resolution=${best.resolution} (${best.count} clusters, modularity=${best.modularity.toFixed(4)})`
      );
      console.log("Computing ForceAtlas2 layout...");
      computeLayout(graph);

      const labels = buildClusterLabels(graph, best.communities, depsGraph);
      renderPNG(
        graph,
        best.communities,
        `${opts.out}-louvain-r${best.resolution}.png`,
        opts.pngSize,
        `Module Dependency Graph (Louvain r=${best.resolution})`,
        labels,
        depsGraph
      );

      // Also render a few other interesting resolutions
      for (const r of results) {
        if (r.resolution === best.resolution) continue;
        if (r.count >= 10 && r.count <= 50 && r.singletons < r.count * 0.3) {
          const labels2 = buildClusterLabels(graph, r.communities, depsGraph);
          renderPNG(
            graph,
            r.communities,
            `${opts.out}-louvain-r${r.resolution}.png`,
            opts.pngSize,
            `Module Dependency Graph (Louvain r=${r.resolution})`,
            labels2,
            depsGraph
          );
        }
      }
    }
  }

  // Pick a specific resolution
  if (opts.pick) {
    console.log(`\nRunning Louvain with resolution=${opts.pick}...`);
    const [result] = runLouvainSweep(graph, [opts.pick]);

    console.log(`Found ${result.count} clusters, modularity=${result.modularity.toFixed(4)}`);
    console.log(
      `Sizes: largest=${result.largest}, median=${result.median}, smallest=${result.smallest}, singletons=${result.singletons}`
    );

    // Detailed cluster analysis
    const labels = buildClusterLabels(graph, result.communities, depsGraph);
    console.log(`\nCluster details:`);
    for (const cl of labels) {
      const topFns = cl.topFunctions
        .slice(0, 5)
        .map((f) => `${f.name}(${f.callers})`)
        .join(", ");
      console.log(`  ${cl.label}`);
      if (topFns) console.log(`    Top functions: ${topFns}`);
    }

    // Write clusters JSON
    const clustersOutput = {
      _meta: {
        generatedAt: new Date().toISOString(),
        algorithm: "louvain",
        resolution: opts.pick,
        clusters: result.count,
        modularity: result.modularity,
        nodes: graph.order,
        edges: graph.size,
      },
      clusters: {},
    };
    for (const cl of labels) {
      const analysis = analyzeCluster(graph, result.communities, cl.id, depsGraph);
      clustersOutput.clusters[cl.id] = {
        size: cl.size,
        members: analysis.members,
        topFunctions: analysis.topFunctions.map((f) => ({
          name: f.name,
          file: f.file,
          callers: f.callers,
        })),
      };
    }
    const jsonPath = `${opts.out}.json`;
    writeFileSync(jsonPath, JSON.stringify(clustersOutput, null, 2));
    console.log(`\nWrote ${jsonPath}`);

    // PNG
    if (opts.png) {
      console.log("Computing ForceAtlas2 layout...");
      computeLayout(graph);
      renderPNG(
        graph,
        result.communities,
        `${opts.out}.png`,
        opts.pngSize,
        `Module Dependency Graph (Louvain r=${opts.pick})`,
        labels,
        depsGraph
      );
    }
  }

  // Single resolution (not sweep, not pick)
  if (opts.resolution && !opts.pick) {
    console.log(`\nRunning Louvain with resolution=${opts.resolution}...`);
    const [result] = runLouvainSweep(graph, [opts.resolution]);
    console.log(`Found ${result.count} clusters, modularity=${result.modularity.toFixed(4)}`);
    console.log(`Size distribution: ${result.sizes.join(", ")}`);
  }

  // Stats mode
  if (opts.stats) {
    printGraphStats(graph);
  }
}

function printGraphStats(graph) {
  console.log(`\n--- Graph Statistics ---`);
  console.log(`Nodes: ${graph.order}`);
  console.log(`Edges: ${graph.size}`);

  // Degree distribution
  const degrees = graph.nodes().map((n) => graph.degree(n));
  degrees.sort((a, b) => b - a);
  console.log(`\nDegree distribution:`);
  console.log(`  Max: ${degrees[0]}`);
  console.log(`  p95: ${degrees[Math.floor(degrees.length * 0.05)]}`);
  console.log(`  Median: ${degrees[Math.floor(degrees.length * 0.5)]}`);
  console.log(`  Min: ${degrees[degrees.length - 1]}`);

  // Top degree nodes
  const topNodes = graph
    .nodes()
    .map((n) => ({ node: n, deg: graph.degree(n) }))
    .sort((a, b) => b.deg - a.deg)
    .slice(0, 20);
  console.log(`\nTop 20 nodes by degree:`);
  for (const { node, deg } of topNodes) {
    console.log(`  ${node}: ${deg}`);
  }
}

main();
