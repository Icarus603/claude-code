# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

bun-demincer is a decompiler, deminifier, and deobfuscator for Bun-compiled standalone JavaScript binaries. It extracts embedded JavaScript source from Bun's binary format, splits it into individual modules, identifies vendor (npm) packages, recovers original identifiers, and organizes everything into a readable, structured codebase.

## Architecture

### Standalone Script Architecture

- **18 standalone pipeline scripts** in `src/`, each self-contained with no cross-imports
- Scripts communicate via **file-based artifacts** (JSON manifests, graph files, rename maps)
- Each script can be run independently with `node src/<script>.mjs <args>`
- All scripts use ES modules (`"type": "module"` in package.json)

### Pipeline Flow

```
Bun binary → extract.mjs → resplit.mjs → match-vendors.mjs → deobfuscate.mjs → extract-deps.mjs → cluster-graph.mjs → organize.mjs
                ↓              ↓                ↓                    ↓
           extracted/     resplit/      vendor-overrides.json   decoded/
           manifest.json  graph.json                          (deobfuscated)
```

### Key Artifacts

| File | Purpose |
|------|---------|
| `manifest.json` | Module metadata: index, name, sourceSize, bytecodeSize, format, entry point |
| `graph.json` | Dependency graph from resplit: requires, imports, exports per module |
| `vendor-overrides.json` | Module → npm package mapping from fingerprint matching |
| `clusters-core.json` | Cluster membership from Louvain community detection |
| `cluster-labels.json` | Manual labels mapping cluster IDs to directory names |
| `*-renames.json` | Rename maps: `{oldName: newName}` per module or global |

### AST Tools Used

- **@babel/parser** — Parse JS into AST (with `errorRecovery: true`, `allowReturnOutsideFunction: true`)
- **@babel/traverse** — Walk AST nodes
- **recast** — Format-preserving AST transforms (only identifier bytes change, whitespace preserved)
- **@wakaru/unminify** — Structural transforms (`!0`→`true`, `void 0`→`undefined`, comma splitting)
- **lebab** — ES5→ES6+ modernization (arrow functions, const/let, shorthand)
- **prettier** — Final consistent formatting

## Common Commands

### Install Dependencies

```bash
npm install
```

### Full Pipeline (Cold Start)

```bash
# 1. Extract JS from Bun binary
node src/extract.mjs /path/to/bun-binary extracted/

# 2. Split into individual modules
node src/resplit.mjs extracted/bundle.js resplit/

# 3. Classify vendor packages
node src/match-vendors.mjs resplit/ --db data/vendor-fingerprints-1000.json --classify

# 4. Deobfuscate (structural + rename + format)
cp -r resplit/ decoded/
node src/deobfuscate.mjs --dir decoded/

# 5-7. Build dependency graph, cluster, organize
node src/extract-deps.mjs decoded/manifest.json --out deps-graph.json
node src/cluster-graph.mjs deps-graph.json --sweep
node src/cluster-graph.mjs deps-graph.json --pick 1.5
# Create cluster-labels.json manually, then:
node src/organize.mjs decoded/
```

### Deobfuscation Stages (Individual)

```bash
# Full pipeline
node src/deobfuscate.mjs --dir decoded/

# Skip specific stages
node src/deobfuscate.mjs --dir decoded/ --skip wakaru --skip lebab

# Run only one stage
node src/deobfuscate.mjs --dir decoded/ --only prettier

# With batch renames from AI
node src/deobfuscate.mjs --dir decoded/ --batch renames-ai.json
```

### Rename Operations

```bash
# Single rename (dry-run first)
node src/rename.mjs W9 getFeatureFlag --dir decoded/ --dry-run
node src/rename.mjs W9 getFeatureFlag --dir decoded/

# Batch rename from JSON
node src/rename.mjs --batch renames.json --dir decoded/

# Smart two-pass rename (interface + local)
node src/rename.mjs --smart --interface-batch iface.json --local-batch local.json --dir decoded/
```

### Vendor Classification

```bash
# Classify with existing DB
node src/match-vendors.mjs resplit/ --db data/vendor-fingerprints-1000.json --classify

# Rebuild fingerprint DB from local npm packages
node src/match-vendors.mjs --rebuild-db --npm-dir /path/to/node_modules --db data/new-db.json
```

### Cross-Version Transfer

```bash
# Transfer renames/classifications to new version via content matching
node src/transfer-artifacts.mjs new-version/ --reference old-version/

# Apply reference directory layout
node src/apply-reference-layout.mjs new-decoded/ --reference old-decoded-organized/
```

### Dependency Analysis

```bash
# Build function-level dependency graph
node src/extract-deps.mjs decoded/manifest.json --out deps-graph.json

# Query callers of a specific function
node src/extract-deps.mjs decoded/manifest.json --query functionName --callers

# Cluster modules (sweep to find optimal resolution)
node src/cluster-graph.mjs deps-graph.json --sweep
node src/cluster-graph.mjs deps-graph.json --pick 1.5 --png
```

### Round-Trip (Reassemble to Runnable Binary)

The `build.mjs` mentioned in README is project-specific; reassembly pattern is:

```bash
# Reassemble from resplit directory
node src/resplit.mjs --reassemble resplit/ output.js
```

## Code Patterns

### Babel Parser Configuration

```javascript
import { parse } from "@babel/parser";

const ast = parse(source, {
  sourceType: "script",
  allowReturnOutsideFunction: true,
  allowSuperOutsideMethod: true,
  errorRecovery: true,
  plugins: ["jsx"],
});
```

### Recast for Format-Preserving Transforms

```javascript
import * as recast from "recast";
import { parse as babelParse } from "@babel/parser";

const recastParser = {
  parse(source) {
    return babelParse(source, {
      sourceType: "script",
      allowReturnOutsideFunction: true,
      errorRecovery: true,
      plugins: ["jsx"],
      tokens: true, // Required by recast
    });
  },
};

const ast = recast.parse(source, { parser: recastParser });
// ... transform ast ...
const output = recast.print(ast).code;
```

### Wakaru Unminify (CJS require)

```javascript
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const { runTransformationRules } = require("@wakaru/unminify");

// ESM dist has broken prettier import, use CJS
const result = runTransformationRules(source, ["unminify"], "esm");
```

### Reading Manifest/Graph JSON

```javascript
import { readFileSync } from "fs";

const manifest = JSON.parse(readFileSync("${dir}/manifest.json", "utf-8"));
const graph = JSON.parse(readFileSync("${dir}/graph.json", "utf-8"));

// manifest.modules[] has: index, name, sourceSize, bytecodeSize, isEntry, format
// graph[moduleId] has: requires[], imports[], exports[]
```

## Key Runtime Globals (Bun's Module System)

These are defined in `00-runtime.js` and referenced across all modules:

| Name | Purpose |
|------|---------|
| `y` / `__commonJS` | CJS module wrapper |
| `h` / `__esm` | ESM lazy initializer |
| `v` / `__export` | ESM export helper |
| `MR` | Minified export mapping (key source of name recovery) |
| `__require` | Internal require implementation |
| `__toESM` | CJS→ESM interop |
| `__toCommonJS` | ESM→CJS interop |

These identifiers are auto-excluded from renames in `deobfuscate.mjs`.

## File Organization Conventions

- `00-runtime.js` — Bun's module system runtime (always first)
- `99-main.js` — Entry point execution (always last)
- `0001-0999.js` — App modules (numbered by source order)
- `vendor/` — Identified npm packages with subdirectories
- `vendor/_unidentified/` — Vendor modules with no package match

## Dependencies of Note

- `@wakaru/unminify` — ESM dist has broken import, use CJS `require()`
- `canvas` — Native dependency for PNG visualization in cluster-graph
- `graphology-communities-louvain` — Community detection for module clustering
- `@mapequation/infomap` — Alternative clustering algorithm
- `recast` — Preserves formatting during AST transforms (critical for round-trip)

## Environment Requirements

- Node.js v18+
- Bun (optional — only needed to *run* extracted code, not to decompile it)
- For `canvas` dependency: system libraries for Cairo (macOS: `brew install pkg-config cairo pango libpng jpeg giflib librsvg`)
