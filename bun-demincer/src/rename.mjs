#!/usr/bin/env node
/**
 * AST-Aware Rename Tool for Bun Bundle Chunks
 *
 * Renames minified identifiers across split JS files using Babel AST traversal.
 * Correctly handles: variable declarations, references, function calls, assignments.
 * Correctly skips: string literals, comments, property keys, member expressions.
 *
 * Usage:
 *   node rename.mjs W9 getFeatureFlag --dir ./decoded/
 *   node rename.mjs --batch renames.json --dir ./decoded/
 *   node rename.mjs W9 getFeatureFlag --dir ./decoded/ --dry-run
 */

import fs from "fs";
import path from "path";
import * as recast from "recast";
import { parse as babelParse } from "@babel/parser";
import _traverse from "@babel/traverse";

// Handle ESM default export quirk
const traverse = _traverse.default || _traverse;

// Custom parser adapter for recast that uses Babel with our options
const recastParser = {
  parse(source) {
    return babelParse(source, {
      sourceType: "script",
      allowReturnOutsideFunction: true,
      allowSuperOutsideMethod: true,
      errorRecovery: true,
      plugins: ["jsx"],
      tokens: true, // recast needs tokens for format preservation
    });
  },
};

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    batch: null,
    interfaceBatch: null,
    localBatch: null,
    dir: ".",
    manifest: null, // path to manifest.json for collision resolution
    scope: null, // all | app (default depends on mode)
    smart: false, // two-pass smart mode: interface(all) + local(app)
    dryRun: false,
    inlineRenames: {},
  };

  let i = 0;
  while (i < args.length) {
    if (args[i] === "--batch") {
      opts.batch = args[++i];
      if (!opts.batch) {
        console.error("Error: --batch requires a path");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--interface-batch") {
      opts.interfaceBatch = args[++i];
      if (!opts.interfaceBatch) {
        console.error("Error: --interface-batch requires a path");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--local-batch") {
      opts.localBatch = args[++i];
      if (!opts.localBatch) {
        console.error("Error: --local-batch requires a path");
        process.exit(1);
      }
      i++;
    } else if (args[i] === "--dir") {
      opts.dir = args[++i];
      i++;
    } else if (args[i] === "--manifest") {
      opts.manifest = args[++i];
      i++;
    } else if (args[i] === "--scope") {
      const scope = args[++i];
      if (scope !== "all" && scope !== "app") {
        console.error(`Error: --scope must be "all" or "app" (got "${scope}")`);
        process.exit(1);
      }
      opts.scope = scope;
      i++;
    } else if (args[i] === "--smart") {
      opts.smart = true;
      i++;
    } else if (args[i] === "--dry-run") {
      opts.dryRun = true;
      i++;
    } else if (args[i] === "--help" || args[i] === "-h") {
      printUsage();
      process.exit(0);
    } else if (!args[i].startsWith("--")) {
      // positional: oldName newName
      const oldName = args[i];
      const newName = args[i + 1];
      if (!newName) {
        console.error(`Error: missing new name for "${oldName}"`);
        process.exit(1);
      }
      opts.inlineRenames[oldName] = newName;
      i += 2;
    } else {
      console.error(`Unknown option: ${args[i]}`);
      process.exit(1);
    }
  }

  // Auto-detect manifest.json in --dir if not explicitly provided
  if (!opts.manifest) {
    const autoManifest = path.join(path.resolve(opts.dir), "manifest.json");
    if (fs.existsSync(autoManifest)) {
      opts.manifest = autoManifest;
    }
  }

  const hasAnyInput =
    Boolean(opts.batch) ||
    Boolean(opts.interfaceBatch) ||
    Boolean(opts.localBatch) ||
    Object.keys(opts.inlineRenames).length > 0;

  if (!hasAnyInput) {
    printUsage();
    process.exit(1);
  }

  return opts;
}

function printUsage() {
  console.error(
    "Usage:\n" +
      "  node rename.mjs OldName NewName --dir ./decoded/\n" +
      "  node rename.mjs --batch renames.json --dir ./decoded/\n" +
      "  node rename.mjs --interface-batch interface.json --local-batch local.json --dir ./decoded/\n" +
      "  node rename.mjs --batch renames.json --dir ./decoded/ --manifest ./decoded/manifest.json --smart\n" +
      "\nOptions:\n" +
      "  --batch <path>            Flat map or {interface,local} batch JSON\n" +
      "  --interface-batch <path>  Explicit interface (cross-file) rename map\n" +
      "  --local-batch <path>      Explicit local (module-local) rename map\n" +
      "  --scope all|app           Non-smart scope (default: all). In smart mode, local pass defaults to app\n" +
      "  --smart                   Smart 2-pass mode: interface(all) then local(app)\n" +
      "  --manifest <path>         manifest.json for collision + interface classification/linking\n" +
      "  --dry-run                 Analyze and report without writing files\n" +
      "  -h, --help                Show this help"
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function loadJsonObject(filePath, flagName) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch (err) {
    console.error(`Error: failed to read ${flagName} ${filePath}: ${err.message}`);
    process.exit(1);
  }
  if (!isPlainObject(parsed)) {
    console.error(`Error: ${flagName} must contain a JSON object`);
    process.exit(1);
  }
  return parsed;
}

function normalizeRenameMap(raw, label) {
  if (!isPlainObject(raw)) return {};
  const normalized = {};
  for (const [oldName, newName] of Object.entries(raw)) {
    if (typeof oldName !== "string" || typeof newName !== "string") {
      console.warn(`  Warning: skipping invalid rename entry in ${label}: ${oldName} → ${newName}`);
      continue;
    }
    if (!oldName || !newName) continue;
    normalized[oldName] = newName;
  }
  return normalized;
}

function loadRenameInputs(opts) {
  const flatRenames = { ...opts.inlineRenames };
  const interfaceRenames = {};
  const localRenames = {};

  if (opts.batch) {
    const batchPath = path.resolve(opts.batch);
    const batchData = loadJsonObject(batchPath, "--batch");
    const hasSplitMaps = isPlainObject(batchData.interface) || isPlainObject(batchData.local);

    if (hasSplitMaps) {
      Object.assign(interfaceRenames, normalizeRenameMap(batchData.interface, "--batch interface"));
      Object.assign(localRenames, normalizeRenameMap(batchData.local, "--batch local"));
      Object.assign(flatRenames, normalizeRenameMap(batchData.renames, "--batch renames"));

      const rootFlat = {};
      for (const [oldName, newName] of Object.entries(batchData)) {
        if (oldName === "interface" || oldName === "local" || oldName === "renames" || oldName === "_meta" || oldName === "meta") {
          continue;
        }
        if (typeof newName === "string") rootFlat[oldName] = newName;
      }
      Object.assign(flatRenames, rootFlat);
    } else {
      Object.assign(flatRenames, normalizeRenameMap(batchData, "--batch"));
    }
  }

  if (opts.interfaceBatch) {
    const interfacePath = path.resolve(opts.interfaceBatch);
    const interfaceData = loadJsonObject(interfacePath, "--interface-batch");
    Object.assign(interfaceRenames, normalizeRenameMap(interfaceData, "--interface-batch"));
  }

  if (opts.localBatch) {
    const localPath = path.resolve(opts.localBatch);
    const localData = loadJsonObject(localPath, "--local-batch");
    Object.assign(localRenames, normalizeRenameMap(localData, "--local-batch"));
  }

  return { flatRenames, interfaceRenames, localRenames };
}

function loadManifest(manifestPath) {
  if (!manifestPath) return null;
  const resolved = path.resolve(manifestPath);
  if (!fs.existsSync(resolved)) {
    console.warn(`Warning: manifest not found: ${resolved}`);
    return null;
  }
  try {
    return JSON.parse(fs.readFileSync(resolved, "utf-8"));
  } catch (err) {
    console.warn(`Warning: failed to parse manifest ${resolved}: ${err.message}`);
    return null;
  }
}

function buildManifestIndices(manifest, files, dir = null) {
  const moduleNames = new Set();
  const ownerByModule = new Map();
  const reverseDeps = new Map();
  const filesSet = new Set(files);
  const vendorFiles = buildVendorFileSet(manifest);

  if (manifest?.sourceOrder && Array.isArray(manifest.sourceOrder)) {
    for (const entry of manifest.sourceOrder) {
      if (!entry || entry.type !== "module" || typeof entry.name !== "string") continue;
      moduleNames.add(entry.name);
      if (typeof entry.file === "string") {
        ownerByModule.set(entry.name, entry.file);
      }
    }
  }

  if (isPlainObject(manifest?.modules)) {
    for (const [moduleName, meta] of Object.entries(manifest.modules)) {
      moduleNames.add(moduleName);
      if (meta?.file && typeof meta.file === "string") {
        ownerByModule.set(moduleName, meta.file);
      }
      if (meta?.deps && Array.isArray(meta.deps)) {
        const ownerFile = meta.file;
        for (const dep of meta.deps) {
          if (typeof dep !== "string" || !ownerFile) continue;
          if (!reverseDeps.has(dep)) reverseDeps.set(dep, new Set());
          reverseDeps.get(dep).add(ownerFile);
        }
      }
    }
  }

  // Manifest dependency extraction can miss nested module calls like v(VM(), 1).
  // Backfill dependency links by scanning each file for called identifiers that
  // match known module variable names and are not declared in that same file.
  if (dir && moduleNames.size > 0 && files.length > 0) {
    const varRe = /(?:^|[;{}])\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)/gm;
    const funcRe = /(?:^|[;{}])\s*function\s+([A-Za-z_$][\w$]*)/gm;
    const classRe = /(?:^|[;{}])\s*class\s+([A-Za-z_$][\w$]*)/gm;
    const callRe = /([A-Za-z_$][\w$]*)\s*\(/gm;

    for (const file of files) {
      const abs = path.join(dir, file);
      let code;
      try {
        code = fs.readFileSync(abs, "utf-8");
      } catch {
        continue;
      }

      const declared = new Set();
      let m;
      varRe.lastIndex = 0;
      while ((m = varRe.exec(code)) !== null) declared.add(m[1]);
      funcRe.lastIndex = 0;
      while ((m = funcRe.exec(code)) !== null) declared.add(m[1]);
      classRe.lastIndex = 0;
      while ((m = classRe.exec(code)) !== null) declared.add(m[1]);

      callRe.lastIndex = 0;
      while ((m = callRe.exec(code)) !== null) {
        const callee = m[1];
        if (!moduleNames.has(callee)) continue;
        if (declared.has(callee)) continue;
        if (!reverseDeps.has(callee)) reverseDeps.set(callee, new Set());
        reverseDeps.get(callee).add(file);
      }
    }
  }

  const runtimeFiles = [];
  if (filesSet.has("00-runtime.js")) runtimeFiles.push("00-runtime.js");
  if (filesSet.has("99-main.js")) runtimeFiles.push("99-main.js");

  const interfaceLinkMap = new Map();
  for (const moduleName of moduleNames) {
    const linked = new Set(runtimeFiles);
    const ownerFile = ownerByModule.get(moduleName);
    if (ownerFile && filesSet.has(ownerFile)) linked.add(ownerFile);
    const dependents = reverseDeps.get(moduleName);
    if (dependents) {
      for (const file of dependents) {
        if (filesSet.has(file)) linked.add(file);
      }
    }
    interfaceLinkMap.set(moduleName, linked);
  }

  return { moduleNames, interfaceLinkMap, vendorFiles };
}

function splitSmartRenames(flatRenames, moduleNames) {
  const interfaceRenames = {};
  const localRenames = {};
  for (const [oldName, newName] of Object.entries(flatRenames)) {
    if (moduleNames.has(oldName)) {
      interfaceRenames[oldName] = newName;
    } else {
      localRenames[oldName] = newName;
    }
  }
  return { interfaceRenames, localRenames };
}

function filterReservedAndBuiltins(renames) {
  const skipped = [];
  const filtered = {};
  for (const [oldName, newName] of Object.entries(renames)) {
    const blocked =
      RESERVED_WORDS.has(newName) ||
      GLOBAL_BUILTINS.has(newName) ||
      RESERVED_WORDS.has(oldName) ||
      GLOBAL_BUILTINS.has(oldName);
    if (blocked) {
      skipped.push(`${oldName} → ${newName}`);
      continue;
    }
    filtered[oldName] = newName;
  }
  return { filtered, skipped };
}

function dropDuplicateTargetRenames(renames, label, blockedTargets = new Set()) {
  const seenTargets = new Map(); // target -> first oldName kept
  const dropped = [];

  for (const [oldName, newName] of Object.entries(renames)) {
    if (blockedTargets.has(newName)) {
      dropped.push(`${oldName} → ${newName} (target reserved by higher-priority pass)`);
      delete renames[oldName];
      continue;
    }

    const existing = seenTargets.get(newName);
    if (existing) {
      dropped.push(`${oldName} → ${newName} (kept ${existing} → ${newName})`);
      delete renames[oldName];
      continue;
    }

    seenTargets.set(newName, oldName);
  }

  if (dropped.length > 0) {
    console.warn(`Safety: skipped ${dropped.length} ${label} rename(s) with duplicate/conflicting targets`);
    if (process.env.RENAME_DEBUG) {
      console.warn(`  [DEBUG] ${label} duplicate target skips: ${dropped.join(", ")}`);
    }
  }

  return dropped.length;
}

function buildVendorFileSet(manifest) {
  const vendorFiles = new Set();
  if (!isPlainObject(manifest?.modules)) return vendorFiles;
  for (const meta of Object.values(manifest.modules)) {
    if (!meta || typeof meta.file !== "string") continue;
    if (meta.vendor) vendorFiles.add(meta.file);
  }
  return vendorFiles;
}

function isVendorFile(file, vendorFiles = null) {
  if (vendorFiles && vendorFiles.has(file)) return true;
  return file.startsWith("vendor/");
}

function filterFilesByScope(files, scope, vendorFiles = null) {
  if (scope === "app") return files.filter((file) => !isVendorFile(file, vendorFiles));
  return files;
}

function buildFileRenamePlan(renames, files, linkMap) {
  const filesSet = new Set(files);
  const perFile = new Map();
  const globalRenames = {};

  for (const [oldName, newName] of Object.entries(renames)) {
    if (!linkMap || !linkMap.has(oldName)) {
      globalRenames[oldName] = newName;
      continue;
    }

    const linkedFiles = linkMap.get(oldName);
    let assigned = false;
    for (const file of linkedFiles) {
      if (!filesSet.has(file)) continue;
      let map = perFile.get(file);
      if (!map) {
        map = {};
        perFile.set(file, map);
      }
      map[oldName] = newName;
      assigned = true;
    }

    if (!assigned) {
      globalRenames[oldName] = newName;
    }
  }

  return { perFile, globalRenames };
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function makeIdentifierRegex(identifier) {
  // Use JS identifier boundaries instead of \b so names like "$fT" are matched.
  const escaped = escapeRegExp(identifier);
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}(?![A-Za-z0-9_$])`);
}

function findCrossBoundaryLocalNames(localRenames, files, dir, vendorFiles = null) {
  const renameNames = Object.keys(localRenames);
  if (renameNames.length === 0) return [];

  const targets = new Set(renameNames);
  const appFileLevelDecls = new Set();
  const appTokens = new Set();
  const vendorTokens = new Set();
  const vendorFileLevelDecls = new Set();

  const varRe = /(?:^|[;{}])\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)/gm;
  const funcRe = /(?:^|[;{}])\s*function\s+([A-Za-z_$][\w$]*)/gm;
  const classRe = /(?:^|[;{}])\s*class\s+([A-Za-z_$][\w$]*)/gm;
  const identRe = /[A-Za-z_$][\w$]*/gm;

  for (const file of files) {
    const filePath = path.join(dir, file);
    let code;
    try {
      code = fs.readFileSync(filePath, "utf-8");
    } catch {
      continue;
    }

    if (isVendorFile(file, vendorFiles)) {
      let m;
      identRe.lastIndex = 0;
      while ((m = identRe.exec(code)) !== null) {
        const token = m[0];
        if (targets.has(token)) vendorTokens.add(token);
      }
      varRe.lastIndex = 0;
      while ((m = varRe.exec(code)) !== null) {
        if (targets.has(m[1])) vendorFileLevelDecls.add(m[1]);
      }
      funcRe.lastIndex = 0;
      while ((m = funcRe.exec(code)) !== null) {
        if (targets.has(m[1])) vendorFileLevelDecls.add(m[1]);
      }
      classRe.lastIndex = 0;
      while ((m = classRe.exec(code)) !== null) {
        if (targets.has(m[1])) vendorFileLevelDecls.add(m[1]);
      }
      continue;
    }

    let m;
    identRe.lastIndex = 0;
    while ((m = identRe.exec(code)) !== null) {
      const token = m[0];
      if (targets.has(token)) appTokens.add(token);
    }
    varRe.lastIndex = 0;
    while ((m = varRe.exec(code)) !== null) {
      if (targets.has(m[1])) appFileLevelDecls.add(m[1]);
    }
    funcRe.lastIndex = 0;
    while ((m = funcRe.exec(code)) !== null) {
      if (targets.has(m[1])) appFileLevelDecls.add(m[1]);
    }
    classRe.lastIndex = 0;
    while ((m = classRe.exec(code)) !== null) {
      if (targets.has(m[1])) appFileLevelDecls.add(m[1]);
    }
  }

  const crossBoundary = [];
  for (const name of renameNames) {
    const sharedTokenAcrossAppVendor = appTokens.has(name) && vendorTokens.has(name);
    const appDeclUsedByVendor = appFileLevelDecls.has(name) && vendorTokens.has(name);
    const vendorDeclUsedByApp = vendorFileLevelDecls.has(name) && appTokens.has(name);
    if (sharedTokenAcrossAppVendor || appDeclUsedByVendor || vendorDeclUsedByApp) {
      crossBoundary.push(name);
    }
  }
  return crossBoundary;
}

function runRenamePass({
  className,
  scope,
  renames,
  files,
  dir,
  dryRun,
  linkMap = null,
  vendorFiles = null,
}) {
  const loaded = Object.keys(renames).length;
  if (loaded === 0) {
    return {
      class: className,
      scope,
      loaded: 0,
      applied: 0,
      not_found: 0,
      files_modified: 0,
      replacements: 0,
      app: { files_modified: 0, replacements: 0 },
      vendor: { files_modified: 0, replacements: 0 },
    };
  }

  const { perFile, globalRenames } = buildFileRenamePlan(renames, files, linkMap);
  const globalCount = Object.keys(globalRenames).length;
  const totalCounts = {};
  for (const oldName of Object.keys(renames)) totalCounts[oldName] = 0;

  let filesModified = 0;
  let totalReplacements = 0;
  const scopedCounts = {
    app: { files_modified: 0, replacements: 0 },
    vendor: { files_modified: 0, replacements: 0 },
  };

  console.log(
    `\n${dryRun ? "[DRY RUN] " : ""}Pass ${className} (${scope}): ` +
    `${loaded} rename(s), ${files.length} file(s)`
  );

  for (const file of files) {
    const fileSpecific = perFile.get(file);
    let renamesForFile = fileSpecific;
    if (globalCount > 0) {
      if (!fileSpecific) renamesForFile = globalRenames;
      else renamesForFile = { ...globalRenames, ...fileSpecific };
    }

    if (!renamesForFile || Object.keys(renamesForFile).length === 0) continue;

    const filePath = path.join(dir, file);
    const { changed, counts } = processFile(filePath, renamesForFile, dryRun);
    if (!changed) continue;

    filesModified++;
    const replacementCount = Object.values(counts).reduce((sum, n) => sum + n, 0);
    totalReplacements += replacementCount;

    const bucket = isVendorFile(file, vendorFiles) ? "vendor" : "app";
    scopedCounts[bucket].files_modified++;
    scopedCounts[bucket].replacements += replacementCount;

    const summary = Object.entries(counts)
      .filter(([, n]) => n > 0)
      .map(([oldName, n]) => `${oldName}→${renamesForFile[oldName]}(${n})`)
      .join(", ");
    console.log(`  ${file}: ${summary}`);

    for (const [oldName, n] of Object.entries(counts)) {
      if (!(oldName in totalCounts)) continue;
      totalCounts[oldName] += n;
    }
  }

  const applied = Object.values(totalCounts).filter((n) => n > 0).length;
  const notFound = loaded - applied;

  console.log(`  Files modified: ${filesModified}/${files.length}`);
  console.log(`  Applied: ${applied}/${loaded}  Not found: ${notFound}`);

  return {
    class: className,
    scope,
    loaded,
    applied,
    not_found: notFound,
    files_modified: filesModified,
    replacements: totalReplacements,
    app: scopedCounts.app,
    vendor: scopedCounts.vendor,
  };
}

function shouldRenameIdentifier(nodePath) {
  const parent = nodePath.parent;
  const key = nodePath.key;

  // SKIP: non-computed property keys in object expressions: { W9: val }
  if (parent.type === "ObjectProperty" && key === "key" && !parent.computed) {
    return false;
  }

  // SKIP: non-computed member expression property: obj.W9
  if (
    parent.type === "MemberExpression" &&
    key === "property" &&
    !parent.computed
  ) {
    return false;
  }

  // SKIP: non-computed method definition key: class { W9() {} }
  if (
    (parent.type === "ClassMethod" || parent.type === "ObjectMethod") &&
    key === "key" &&
    !parent.computed
  ) {
    return false;
  }

  // SKIP: non-computed class property key
  if (parent.type === "ClassProperty" && key === "key" && !parent.computed) {
    return false;
  }

  // SKIP: import/export specifiers (not relevant for bundle chunks, but safe)
  if (
    parent.type === "ImportSpecifier" ||
    parent.type === "ExportSpecifier"
  ) {
    return false;
  }

  // SKIP: label identifiers (for break/continue labels)
  if (parent.type === "LabeledStatement" && key === "label") {
    return false;
  }
  if (
    (parent.type === "BreakStatement" || parent.type === "ContinueStatement") &&
    key === "label"
  ) {
    return false;
  }

  // RENAME everything else: declarations, references, calls, assignments, etc.
  return true;
}

function processFile(filePath, renames, dryRun) {
  const code = fs.readFileSync(filePath, "utf-8");
  const renameEntries = Object.entries(renames);

  // Quick regex pre-filter: skip files that don't contain any of the old names
  const hasAny = renameEntries.some(([oldName]) => {
    const re = makeIdentifierRegex(oldName);
    return re.test(code);
  });
  if (!hasAny) return { changed: false, counts: {} };

  // Parse with recast (preserves original source positions for format-preserving print)
  let ast;
  try {
    ast = recast.parse(code, { parser: recastParser });
  } catch (err) {
    console.error(`  Parse error in ${filePath}: ${err.message}`);
    return { changed: false, counts: {} };
  }

  // Check for collisions: collect variable/function/class DECLARATIONS only
  // (not property access or other identifier references, which are safe to overlap)
  let declaredNames;
  let usedIdentifierNames;
  const addPatternNames = (pattern, out) => {
    if (!pattern) return;
    switch (pattern.type) {
      case "Identifier":
        out.add(pattern.name);
        return;
      case "AssignmentPattern":
        addPatternNames(pattern.left, out);
        return;
      case "RestElement":
        addPatternNames(pattern.argument, out);
        return;
      case "ArrayPattern":
        for (const el of pattern.elements || []) addPatternNames(el, out);
        return;
      case "ObjectPattern":
        for (const prop of pattern.properties || []) {
          if (!prop) continue;
          if (prop.type === "RestElement") addPatternNames(prop.argument, out);
          else addPatternNames(prop.value ?? prop.key, out);
        }
        return;
      default:
        return;
    }
  };
  try {
    declaredNames = new Set();
    usedIdentifierNames = new Set();
    traverse(ast, {
      VariableDeclarator(p) { if (p.node.id?.name) declaredNames.add(p.node.id.name); },
      FunctionDeclaration(p) { if (p.node.id?.name) declaredNames.add(p.node.id.name); },
      ClassDeclaration(p) { if (p.node.id?.name) declaredNames.add(p.node.id.name); },
      Function(p) {
        for (const param of p.node.params || []) addPatternNames(param, declaredNames);
      },
      CatchClause(p) {
        addPatternNames(p.node.param, declaredNames);
      },
      Identifier(p) {
        if (shouldRenameIdentifier(p)) {
          usedIdentifierNames.add(p.node.name);
        }
      },
    });
  } catch (err) {
    console.error(`  Traverse error in ${path.basename(filePath)}: ${err.message} (skipping)`);
    return { changed: false, counts: {} };
  }

  // Filter out collisions: skip renames where newName is already DECLARED in this file
  // (property access like obj.ToolError is NOT a collision — only var/func/class declarations)
  const safeEntries = [];
  for (const [oldName, newName] of renameEntries) {
    // If a declared local binding is renamed to a name already used in this file,
    // skip to avoid creating accidental shadowing (e.g. cjs wrapper params).
    if (oldName !== newName && declaredNames.has(oldName)) {
      const inUse = usedIdentifierNames.has(newName);
      if (inUse) {
        console.warn(
          `  Skipping shadow-risk rename in ${path.basename(filePath)}: ${oldName} → ${newName} (target already used)`
        );
        continue;
      }
    }

    if (declaredNames.has(newName) && declaredNames.has(oldName) && newName !== oldName) {
      console.warn(
        `  Skipping collision: "${newName}" already declared in ${path.basename(filePath)} (rename ${oldName} → ${newName})`
      );
    } else {
      safeEntries.push([oldName, newName]);
    }
  }
  if (safeEntries.length === 0) return { changed: false, counts: {} };

  // Within-file target collision: if two DIFFERENT old names in this file both map
  // to the SAME new name, keep the external reference (not declared here) and drop
  // the local declaration (declared here). This prevents `X = X()` shadowing.
  const presentEntries = safeEntries.filter(([oldName]) => {
    const re = makeIdentifierRegex(oldName);
    return re.test(code);
  });
  const targetCounts = new Map();
  for (const [, newName] of presentEntries) {
    targetCounts.set(newName, (targetCounts.get(newName) || 0) + 1);
  }
  const dupTargets = new Set([...targetCounts].filter(([, c]) => c > 1).map(([t]) => t));
  if (dupTargets.size > 0) {
    // Drop locally-declared identifiers that collide; keep external references
    const toDrop = new Set();
    for (const [oldName, newName] of presentEntries) {
      if (dupTargets.has(newName) && declaredNames.has(oldName)) {
        toDrop.add(oldName);
      }
    }
    if (toDrop.size > 0) {
      for (let i = safeEntries.length - 1; i >= 0; i--) {
        if (toDrop.has(safeEntries[i][0])) {
          safeEntries.splice(i, 1);
        }
      }
    }
  }

  // Build lookup set for fast checking
  const oldNameSet = new Set(safeEntries.map(([o]) => o));
  const renameMap = new Map(safeEntries);
  const counts = {};
  for (const [o] of renameEntries) counts[o] = 0;

  // Traverse and rename (recast tracks mutations for format-preserving print)
  let modified = false;

  try {
    traverse(ast, {
      Identifier(p) {
        const name = p.node.name;
        if (!oldNameSet.has(name)) return;
        if (!shouldRenameIdentifier(p)) return;

        const newName = renameMap.get(name);

        // Handle shorthand property: { W9 } → { W9: getFeatureFlag }
        if (
          p.parent.type === "ObjectProperty" &&
          p.parent.shorthand &&
          p.key === "value"
        ) {
          p.parent.shorthand = false;
          // The key stays as old name, value gets renamed
        }

        p.node.name = newName;
        counts[name]++;
        modified = true;
      },
    });
  } catch (err) {
    console.error(`  Rename traverse error in ${path.basename(filePath)}: ${err.message} (skipping)`);
    return { changed: false, counts: {} };
  }

  if (!modified) return { changed: false, counts };

  // Print with recast — only modified nodes are regenerated, everything else
  // is emitted as original source text (format-preserving)
  const output = recast.print(ast);

  if (!dryRun) {
    fs.writeFileSync(filePath, output.code, "utf-8");
  }

  return { changed: true, counts };
}

// JS reserved words that cannot be used as identifiers
const RESERVED_WORDS = new Set([
  "break","case","catch","continue","debugger","default","delete","do","else",
  "enum","export","extends","false","finally","for","function","if","import",
  "in","instanceof","new","null","return","super","switch","this","throw",
  "true","try","typeof","var","void","while","with","yield","await","class",
  "const","let","static","implements","interface","package","private",
  "protected","public","undefined","NaN","Infinity","arguments",
]);

// Global built-in names that are not reserved words but must not be shadowed
// (e.g., `var Promise;` would shadow the global and crash at runtime)
const GLOBAL_BUILTINS = new Set([
  "Promise","Map","Set","WeakMap","WeakSet","WeakRef","Symbol","Proxy","Reflect",
  "DataView","Buffer","ArrayBuffer","SharedArrayBuffer",
  "Uint8Array","Int8Array","Uint16Array","Int16Array","Uint32Array","Int32Array",
  "Float32Array","Float64Array","BigInt64Array","BigUint64Array",
  "Error","TypeError","RangeError","ReferenceError","SyntaxError","URIError","EvalError",
  "RegExp","Date","JSON","Math","Number","String","Boolean","Array","Object","Function",
  "console","globalThis","process","require","module","exports","__dirname","__filename",
  "setTimeout","setInterval","clearTimeout","clearInterval","setImmediate","clearImmediate",
  "queueMicrotask","structuredClone","fetch","Request","Response","Headers",
  "URL","URLSearchParams","TextEncoder","TextDecoder",
  "ReadableStream","WritableStream","TransformStream",
  "AbortController","AbortSignal","Event","EventTarget","Intl",
  "global","self","window","document","navigator","location","history",
  "performance","crypto","atob","btoa","alert","confirm","prompt",
  "Blob","File","FileReader","FormData","XMLHttpRequest","WebSocket",
  "Worker","MessageChannel","MessagePort","BroadcastChannel",
]);

/**
 * Recursively find all .js files in dir (including vendor/ subdirs).
 * Returns paths relative to dir.
 */
function findAllJsFiles(dir) {
  const results = [];
  function walk(currentDir, prefix) {
    for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        walk(path.join(currentDir, entry.name), prefix ? `${prefix}/${entry.name}` : entry.name);
      } else if (entry.isFile() && entry.name.endsWith(".js")) {
        results.push(prefix ? `${prefix}/${entry.name}` : entry.name);
      }
    }
  }
  walk(dir, "");
  return results.sort();
}

/**
 * Extract the file number from a filename like "0149.js" or "0149_someFunc.js"
 * or "vendor/react/0001.js". Returns the number string (zero-padded preserved).
 */
function extractFileNumber(filePath) {
  const base = path.basename(filePath, ".js");
  const match = base.match(/^(\d+)/);
  return match ? match[1] : null;
}

/**
 * Resolve rename collisions using manifest data.
 *
 * Scans each file for file-level declarations (var, let, const, function, class)
 * and maps old→new names. When multiple files would declare the same name at
 * file level after renames, suffixes them with the file number.
 *
 * This is critical because when modules are reassembled into a single bundle,
 * all file-level declarations share the same scope. Duplicate `var` is fine,
 * but duplicate function/class/let/const causes SyntaxError.
 */
function resolveCollisions(renames, manifestPath, dir) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
  const manifestVendorFiles = buildVendorFileSet(manifest);

  // Build var → file map from manifest and collect all module variable names.
  // Module variables that are NOT being renamed must not be used as rename targets,
  // as this would shadow them at bundle scope.
  const varToFile = new Map();
  const allModuleVarNames = new Set();
  for (const entry of manifest.sourceOrder) {
    if (entry.type === "module") {
      varToFile.set(entry.name, entry.file);
      allModuleVarNames.add(entry.name);
    }
  }

  // Scan ALL files (app + vendor) for bundle-scope bindings:
  // - file-level declarations (var/let/const/function/class)
  // - implicit globals from bare assignments to undeclared identifiers
  // This catches collisions where renames target names already used by vendor code
  // (e.g., multiple AWS SDK modules each declaring `class Client`).
  const fileLevelDecls = new Map(); // name → [{file, kind}]
  const allFiles = findAllJsFiles(dir);

  const varRe = /(?:^|[;{}])\s*(?:var|let|const)\s+([A-Za-z_$][\w$]*)/gm;
  const funcRe = /(?:^|[;{}])\s*function\s+([A-Za-z_$][\w$]*)/gm;
  const classRe = /(?:^|[;{}])\s*class\s+([A-Za-z_$][\w$]*)/gm;
  const assignRe = /(?:^|[;,(\[])\s*([A-Za-z_$][\w$]*)\s*=(?!=|>)/gm;

  for (const f of allFiles) {
    const code = fs.readFileSync(path.join(dir, f), "utf-8");
    const vendor = isVendorFile(f, manifestVendorFiles);
    const declaredInFile = new Set();
    let m;
    varRe.lastIndex = 0;
    funcRe.lastIndex = 0;
    classRe.lastIndex = 0;
    assignRe.lastIndex = 0;
    while ((m = varRe.exec(code)) !== null) {
      declaredInFile.add(m[1]);
      if (!fileLevelDecls.has(m[1])) fileLevelDecls.set(m[1], []);
      fileLevelDecls.get(m[1]).push({ file: f, kind: "var", vendor });
    }
    while ((m = funcRe.exec(code)) !== null) {
      declaredInFile.add(m[1]);
      if (!fileLevelDecls.has(m[1])) fileLevelDecls.set(m[1], []);
      fileLevelDecls.get(m[1]).push({ file: f, kind: "function", vendor });
    }
    while ((m = classRe.exec(code)) !== null) {
      declaredInFile.add(m[1]);
      if (!fileLevelDecls.has(m[1])) fileLevelDecls.set(m[1], []);
      fileLevelDecls.get(m[1]).push({ file: f, kind: "class", vendor });
    }
    while ((m = assignRe.exec(code)) !== null) {
      const name = m[1];
      // Assignment to a declared local is not a bundle-scope binding.
      if (declaredInFile.has(name)) continue;
      if (!fileLevelDecls.has(name)) fileLevelDecls.set(name, []);
      fileLevelDecls.get(name).push({ file: f, kind: "assign", vendor });
    }
  }

  // Build reverse map: for each oldName being renamed, which file(s) declare it
  const oldNameToFiles = new Map(); // oldName → [file]
  for (const [name, entries] of fileLevelDecls) {
    if (name in renames) {
      oldNameToFiles.set(name, entries.map(e => e.file));
    }
  }

  // Group all renames by target name, tracking which files they come from
  const targetGroups = new Map(); // targetName → [{oldName, files: [file]}]
  for (const [oldName, newName] of Object.entries(renames)) {
    const files = oldNameToFiles.get(oldName) || (varToFile.has(oldName) ? [varToFile.get(oldName)] : []);
    if (files.length === 0) continue; // not a file-level decl
    if (!targetGroups.has(newName)) targetGroups.set(newName, []);
    targetGroups.get(newName).push({ oldName, files });
  }

  // Collect unrenamed names that must not be used as rename targets.
  // This includes: file-level declarations AND module variable names from manifest.
  // A rename targeting an existing name would shadow it at bundle scope.
  const unrenamedNames = new Set();      // skip rename if target matches
  const unrenamedVendorClassNames = new Set(); // suffix rename if target matches

  // 1. From file-level declaration scan
  for (const [name, entries] of fileLevelDecls) {
    if (name in renames) continue;
    const hasAppDecl = entries.some((e) => !e.vendor);
    const hasVendorDecl = entries.some((e) => e.vendor);
    if (hasAppDecl || hasVendorDecl) unrenamedNames.add(name);
    const hasVendorClassFunc = entries.some(
      (e) => e.vendor && (e.kind === "class" || e.kind === "function")
    );
    if (hasVendorClassFunc && !hasAppDecl) unrenamedVendorClassNames.add(name);
  }

  // 2. From manifest module variables — any module var not being renamed
  // must be protected from being used as a rename target.
  for (const modName of allModuleVarNames) {
    if (!(modName in renames)) {
      unrenamedNames.add(modName);
    }
  }

  let collisionsSuffixed = 0;
  let collisionsSkipped = 0;

  for (const [targetName, members] of targetGroups) {
    // Check if target collides with an unrenamed APP file-level name → skip entirely
    if (unrenamedNames.has(targetName)) {
      for (const { oldName } of members) {
        if (process.env.RENAME_DEBUG) {
          console.log(`  [DEBUG] Skipping ${oldName} → ${targetName}: collides with unrenamed app name`);
        }
        delete renames[oldName];
        collisionsSkipped++;
      }
      continue;
    }

    // Check if target collides with unrenamed VENDOR class/function → suffix (not skip)
    const vendorCollision = unrenamedVendorClassNames.has(targetName);

    // Count total unique files across all members
    const memberFiles = new Set();
    for (const { files } of members) {
      for (const f of files) memberFiles.add(f);
    }
    // Collision if: multiple files, multiple members in same file, or vendor name collision
    if (memberFiles.size < 2 && members.length < 2 && !vendorCollision) continue;

    // Multiple old names → same target: suffix each with its file number.
    // Track used suffixes to handle within-file collisions (multiple old names
    // in the same file mapping to the same target would get the same _NNNN suffix).
    const usedSuffixes = new Set();
    for (const { oldName, files } of members) {
      const file = files[0] || varToFile.get(oldName);
      if (!file) continue;
      const num = extractFileNumber(file);
      if (num) {
        let suffix = `${targetName}_${num}`;
        if (usedSuffixes.has(suffix)) {
          // Within-file collision: append incrementing counter
          let counter = 2;
          while (usedSuffixes.has(`${targetName}_${num}_${counter}`)) counter++;
          suffix = `${targetName}_${num}_${counter}`;
        }
        usedSuffixes.add(suffix);
        renames[oldName] = suffix;
        collisionsSuffixed++;
      }
    }
  }

  if (collisionsSuffixed > 0 || collisionsSkipped > 0) {
    console.log(`  Collision resolution: ${collisionsSuffixed} suffixed, ${collisionsSkipped} skipped`);
  }

  return {
    renames,
    collisionsSuffixed,
    collisionsSkipped,
  };
}

function main() {
  const opts = parseArgs();
  const dir = path.resolve(opts.dir);

  if (!fs.existsSync(dir)) {
    console.error(`Directory not found: ${dir}`);
    process.exit(1);
  }

  const manifestPath = opts.manifest ? path.resolve(opts.manifest) : null;
  const manifestData = loadManifest(manifestPath);

  // When manifest is provided, scan recursively (including vendor/ subdirs)
  // so interface renames can propagate into vendor references when linkage is known.
  const allFiles = manifestData
    ? findAllJsFiles(dir)
    : fs.readdirSync(dir).filter((f) => f.endsWith(".js")).sort();

  const { flatRenames, interfaceRenames: explicitInterface, localRenames: explicitLocal } =
    loadRenameInputs(opts);

  const { moduleNames, interfaceLinkMap, vendorFiles } = buildManifestIndices(manifestData, allFiles, dir);
  const hasVendorClassification =
    vendorFiles.size > 0 || allFiles.some((file) => file.startsWith("vendor/"));
  const moduleCount = isPlainObject(manifestData?.modules)
    ? Object.keys(manifestData.modules).length
    : allFiles.length;
  const likelyBundledCodebase = moduleCount > 200;

  let interfaceRenames = {};
  let localRenames = {};
  let singleRenames = {};
  const skippedReserved = [];

  if (opts.smart) {
    let classifiedInterface = {};
    let classifiedLocal = {};

    if (Object.keys(flatRenames).length > 0) {
      if (moduleNames.size > 0) {
        const split = splitSmartRenames(flatRenames, moduleNames);
        classifiedInterface = split.interfaceRenames;
        classifiedLocal = split.localRenames;
      } else {
        // Without manifest module metadata, safest fallback is to treat flat map as interface.
        console.warn(
          "Warning: smart mode without manifest module data; treating flat --batch entries as interface renames"
        );
        classifiedInterface = { ...flatRenames };
      }
    }

    interfaceRenames = { ...classifiedInterface, ...explicitInterface };
    localRenames = { ...classifiedLocal, ...explicitLocal };

    const duplicates = [];
    for (const oldName of Object.keys(interfaceRenames)) {
      if (!(oldName in localRenames)) continue;
      duplicates.push(oldName);
      delete localRenames[oldName];
    }
    if (duplicates.length > 0) {
      console.warn(
        `Warning: ${duplicates.length} rename(s) existed in both interface/local maps; keeping interface mapping`
      );
    }

    const interfaceFiltered = filterReservedAndBuiltins(interfaceRenames);
    interfaceRenames = interfaceFiltered.filtered;
    skippedReserved.push(...interfaceFiltered.skipped.map((s) => `[interface] ${s}`));
    dropDuplicateTargetRenames(interfaceRenames, "interface");

    const interfaceTargets = new Set(Object.values(interfaceRenames));
    dropDuplicateTargetRenames(localRenames, "local", interfaceTargets);

    const crossBoundaryLocal = findCrossBoundaryLocalNames(localRenames, allFiles, dir, vendorFiles);
    if (crossBoundaryLocal.length > 0) {
      for (const oldName of crossBoundaryLocal) {
        delete localRenames[oldName];
      }
      console.warn(
        `Safety: skipped ${crossBoundaryLocal.length} local rename(s) crossing app globals and vendor usage`
      );
      if (process.env.RENAME_DEBUG) {
        console.warn(`  [DEBUG] cross-boundary local skips: ${crossBoundaryLocal.join(", ")}`);
      }
    }

    const localFiltered = filterReservedAndBuiltins(localRenames);
    localRenames = localFiltered.filtered;
    skippedReserved.push(...localFiltered.skipped.map((s) => `[local] ${s}`));

    const requestedLocalScope = opts.scope || "app";
    const allowUnclassifiedLocal = process.env.RENAME_ALLOW_UNCLASSIFIED_LOCAL === "1";
    if (
      requestedLocalScope === "app" &&
      Object.keys(localRenames).length > 0 &&
      !hasVendorClassification &&
      likelyBundledCodebase &&
      !allowUnclassifiedLocal
    ) {
      console.warn(
        `Safety: skipped ${Object.keys(localRenames).length} local rename(s) because vendor classification is missing`
      );
      console.warn(
        "  Tip: classify resplit modules first (e.g. match-vendors --classify), or set RENAME_ALLOW_UNCLASSIFIED_LOCAL=1 to force"
      );
      localRenames = {};
    }
  } else {
    singleRenames = { ...flatRenames, ...explicitInterface, ...explicitLocal };
    const singleFiltered = filterReservedAndBuiltins(singleRenames);
    singleRenames = singleFiltered.filtered;
    skippedReserved.push(...singleFiltered.skipped.map((s) => `[single] ${s}`));
  }

  if (skippedReserved.length > 0) {
    console.warn(
      `Skipped ${skippedReserved.length} rename(s) to/from reserved or global builtin names`
    );
  }

  const passes = [];

  if (opts.smart) {
    const interfaceScope = "all";
    const localScope = opts.scope || "app";
    const interfaceFiles = filterFilesByScope(allFiles, interfaceScope, vendorFiles);
    const localFiles = filterFilesByScope(allFiles, localScope, vendorFiles);

    console.log(
      `${opts.dryRun ? "[DRY RUN] " : ""}Smart rename in ${dir}: ` +
      `${Object.keys(interfaceRenames).length} interface + ${Object.keys(localRenames).length} local rename(s)`
    );

    let interfaceCollision = { collisionsSuffixed: 0, collisionsSkipped: 0 };
    if (manifestData && Object.keys(interfaceRenames).length > 0) {
      console.log(`Using manifest for interface collision resolution: ${manifestPath}`);
      interfaceCollision = resolveCollisions(interfaceRenames, manifestPath, dir);
    }
    const interfacePass = runRenamePass({
      className: "interface",
      scope: interfaceScope,
      renames: interfaceRenames,
      files: interfaceFiles,
      dir,
      dryRun: opts.dryRun,
      linkMap: interfaceLinkMap,
      vendorFiles,
    });
    interfacePass.suffixed = interfaceCollision.collisionsSuffixed;
    interfacePass.skipped = interfaceCollision.collisionsSkipped;
    passes.push(interfacePass);

    let localCollision = { collisionsSuffixed: 0, collisionsSkipped: 0 };
    if (manifestData && Object.keys(localRenames).length > 0) {
      console.log(`Using manifest for local collision resolution: ${manifestPath}`);
      localCollision = resolveCollisions(localRenames, manifestPath, dir);
    }
    const localPass = runRenamePass({
      className: "local",
      scope: localScope,
      renames: localRenames,
      files: localFiles,
      dir,
      dryRun: opts.dryRun,
      vendorFiles,
    });
    localPass.suffixed = localCollision.collisionsSuffixed;
    localPass.skipped = localCollision.collisionsSkipped;
    passes.push(localPass);
  } else {
    const scope = opts.scope || "all";
    const files = filterFilesByScope(allFiles, scope, vendorFiles);
    console.log(
      `${opts.dryRun ? "[DRY RUN] " : ""}Renaming ${Object.keys(singleRenames).length} identifier(s) ` +
      `across ${files.length} file(s) in ${dir} (scope: ${scope})`
    );

    let collision = { collisionsSuffixed: 0, collisionsSkipped: 0 };
    if (manifestData && Object.keys(singleRenames).length > 0) {
      console.log(`Using manifest for collision resolution: ${manifestPath}`);
      collision = resolveCollisions(singleRenames, manifestPath, dir);
    }

    const pass = runRenamePass({
      className: "single",
      scope,
      renames: singleRenames,
      files,
      dir,
      dryRun: opts.dryRun,
      vendorFiles,
    });
    pass.suffixed = collision.collisionsSuffixed;
    pass.skipped = collision.collisionsSkipped;
    passes.push(pass);
  }

  const totals = {
    loaded: 0,
    applied: 0,
    suffixed: 0,
    skipped: 0,
    not_found: 0,
    files_modified: 0,
    replacements: 0,
    app: { files_modified: 0, replacements: 0 },
    vendor: { files_modified: 0, replacements: 0 },
  };

  for (const pass of passes) {
    totals.loaded += pass.loaded || 0;
    totals.applied += pass.applied || 0;
    totals.suffixed += pass.suffixed || 0;
    totals.skipped += pass.skipped || 0;
    totals.not_found += pass.not_found || 0;
    totals.files_modified += pass.files_modified || 0;
    totals.replacements += pass.replacements || 0;
    totals.app.files_modified += pass.app?.files_modified || 0;
    totals.app.replacements += pass.app?.replacements || 0;
    totals.vendor.files_modified += pass.vendor?.files_modified || 0;
    totals.vendor.replacements += pass.vendor?.replacements || 0;
  }

  const summary = {
    mode: opts.smart ? "smart" : "single",
    dir,
    dryRun: opts.dryRun,
    skipped_reserved: skippedReserved.length,
    passes: passes.map((pass) => ({
      class: pass.class,
      scope: pass.scope,
      loaded: pass.loaded,
      applied: pass.applied,
      suffixed: pass.suffixed || 0,
      skipped: pass.skipped || 0,
      not_found: pass.not_found,
      files_modified: pass.files_modified,
      replacements: pass.replacements,
      app: pass.app,
      vendor: pass.vendor,
    })),
    totals,
  };

  console.log(`\n${opts.dryRun ? "[DRY RUN] " : ""}Summary:`);
  for (const pass of summary.passes) {
    console.log(
      `  ${pass.class}[${pass.scope}] loaded=${pass.loaded} applied=${pass.applied} ` +
      `suffixed=${pass.suffixed} skipped=${pass.skipped} not_found=${pass.not_found}`
    );
  }
  console.log(
    `  totals loaded=${totals.loaded} applied=${totals.applied} suffixed=${totals.suffixed} ` +
    `skipped=${totals.skipped} not_found=${totals.not_found}`
  );
  console.log(`\nStructured stats:\n${JSON.stringify(summary, null, 2)}`);
}

main();
