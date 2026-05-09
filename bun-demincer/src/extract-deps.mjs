#!/usr/bin/env node

/**
 * extract-deps.mjs — Function-level dependency graph builder
 *
 * Parses decoded app modules, extracts function definitions and call expressions,
 * resolves cross-module references using manifest exports + deps, and builds a
 * bidirectional function-level dependency graph.
 */

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default || _traverse;

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function printUsage() {
  console.log(`
Usage: node extract-deps.mjs <resplit-dir> [options]

Arguments:
  <resplit-dir>          Directory with decoded-resplit output (must contain manifest.json)

Options:
  --out <path>           Output graph JSON (default: deps-graph.json)
  --query <name>         Look up a function: show callers + callees
  --module <file>        Limit to specific module (e.g. 0732.js)
  --stats                Show summary statistics
  --unresolved           Show unresolved calls (for debugging)
  --dot                  Output DOT format for Graphviz visualization
  --dry-run              Parse and report stats without writing output
  -h, --help
  `);
}

function parseArgs() {
  const args = process.argv.slice(2);
  const opts = {
    resplitDir: null,
    out: "deps-graph.json",
    query: null,
    module: null,
    stats: false,
    unresolved: false,
    dot: false,
    dryRun: false,
  };

  let i = 0;
  while (i < args.length) {
    switch (args[i]) {
      case "--out":
        opts.out = args[++i];
        i++;
        break;
      case "--query":
        opts.query = args[++i];
        i++;
        break;
      case "--module":
        opts.module = args[++i];
        i++;
        break;
      case "--stats":
        opts.stats = true;
        i++;
        break;
      case "--unresolved":
        opts.unresolved = true;
        i++;
        break;
      case "--dot":
        opts.dot = true;
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

// ---------------------------------------------------------------------------
// Constants — names to skip as call targets
// ---------------------------------------------------------------------------

const BUILTIN_OBJECTS = new Set([
  "Object",
  "Array",
  "String",
  "Number",
  "Math",
  "Date",
  "JSON",
  "Promise",
  "Set",
  "Map",
  "WeakMap",
  "WeakSet",
  "RegExp",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "Symbol",
  "Proxy",
  "Reflect",
  "Int8Array",
  "Uint8Array",
  "Float32Array",
  "Float64Array",
  "ArrayBuffer",
  "DataView",
  "TextEncoder",
  "TextDecoder",
  "URL",
  "URLSearchParams",
  "AbortController",
  "AbortSignal",
  "ReadableStream",
  "WritableStream",
  "TransformStream",
  "Blob",
  "FormData",
  "Headers",
  "Request",
  "Response",
]);

const BUILTIN_FUNCTIONS = new Set([
  "require",
  "setTimeout",
  "setInterval",
  "clearTimeout",
  "clearInterval",
  "setImmediate",
  "clearImmediate",
  "queueMicrotask",
  "fetch",
  "atob",
  "btoa",
  "parseInt",
  "parseFloat",
  "isNaN",
  "isFinite",
  "encodeURIComponent",
  "decodeURIComponent",
  "encodeURI",
  "decodeURI",
  "eval",
  "structuredClone",
  "String",
  "Number",
  "Boolean",
  "Array",
  "Object",
  "Error",
  "TypeError",
  "RangeError",
  "SyntaxError",
  "ReferenceError",
  "warn",
  "string",
  "array",
  "object",
  "literal",
  "exec",
]);

const RUNTIME_HELPERS = new Set([
  "markName",
  "exportRegexes",
  "v",
  "h",
  "y",
  "L",
]);

/**
 * Skip a callee name if it's a built-in, runtime helper, or too short to be meaningful.
 */
function shouldSkipCallee(name) {
  if (name.length <= 2) return true;
  if (BUILTIN_FUNCTIONS.has(name)) return true;
  if (RUNTIME_HELPERS.has(name)) return true;
  return false;
}

/**
 * Skip member expression calls on built-in objects (console.log, Object.keys, etc.)
 */
function isBuiltinMemberCall(objectName) {
  if (BUILTIN_OBJECTS.has(objectName)) return true;
  if (objectName === "console" || objectName === "process" || objectName === "Buffer") return true;
  return false;
}

// ---------------------------------------------------------------------------
// Phase 1: Build export→module index
// ---------------------------------------------------------------------------

function buildExportIndex(manifest) {
  // Map: exportName → [{ moduleName, file }]
  const exportIndex = {};
  // Map: moduleName → module manifest entry
  const moduleByName = {};
  // Map: file → moduleName
  const nameByFile = {};

  for (const [moduleName, mod] of Object.entries(manifest.modules)) {
    if (mod.vendor) continue;
    moduleByName[moduleName] = mod;
    nameByFile[mod.file] = moduleName;

    const names = new Set();
    if (mod.exports) {
      for (const e of mod.exports) names.add(e);
    }
    if (mod.primaryName) names.add(mod.primaryName);

    for (const name of names) {
      if (!exportIndex[name]) exportIndex[name] = [];
      exportIndex[name].push({ moduleName, file: mod.file });
    }
  }

  return { exportIndex, moduleByName, nameByFile };
}

// ---------------------------------------------------------------------------
// Phase 2: Parse modules, extract function defs and calls
// ---------------------------------------------------------------------------

function parseModule(code) {
  return parse(code, {
    sourceType: "unambiguous",
    allowReturnOutsideFunction: true,
    allowSuperOutsideMethod: true,
    errorRecovery: true,
    plugins: ["jsx"],
  });
}

/**
 * Extract function definitions and call expressions from a module's AST.
 * Returns { functions: Map<name, {line, calls}>, topLevelCalls: [] }
 */
function extractFunctionGraph(code, file) {
  let ast;
  try {
    ast = parseModule(code);
  } catch {
    // Fall back to regex extraction
    return extractFunctionGraphRegex(code, file);
  }

  // Track function definitions: name → { line, calls: [] }
  const functions = new Map();
  // Stack of enclosing function names for attributing calls
  const fnStack = ["<module-init>"];
  // All local definitions in this module (for internal vs external classification)
  const localDefs = new Set();

  // First pass: collect all top-level function/variable definitions
  try {
    traverse(ast, {
      FunctionDeclaration(path) {
        if (path.node.id) {
          localDefs.add(path.node.id.name);
        }
      },
      VariableDeclarator(path) {
        if (path.node.id?.type === "Identifier") {
          localDefs.add(path.node.id.name);
        }
      },
      ClassDeclaration(path) {
        if (path.node.id) {
          localDefs.add(path.node.id.name);
        }
      },
    });
  } catch {
    return extractFunctionGraphRegex(code, file);
  }

  // Ensure <module-init> exists
  functions.set("<module-init>", { line: 1, calls: [] });

  // Second pass: collect function bodies and their calls
  try {
    traverse(ast, {
      // Track entering function scopes
      FunctionDeclaration: {
        enter(path) {
          const name = path.node.id?.name || "<anonymous>";
          const line = path.node.loc?.start?.line || 0;
          if (name !== "<anonymous>") {
            if (!functions.has(name)) {
              functions.set(name, { line, calls: [] });
            }
            fnStack.push(name);
          }
        },
        exit(path) {
          const name = path.node.id?.name;
          if (name && fnStack[fnStack.length - 1] === name) {
            fnStack.pop();
          }
        },
      },

      // Named function expressions and arrow functions assigned to variables
      VariableDeclarator(path) {
        const init = path.node.init;
        if (
          init &&
          (init.type === "FunctionExpression" ||
            init.type === "ArrowFunctionExpression") &&
          path.node.id?.type === "Identifier"
        ) {
          const name = path.node.id.name;
          const line = path.node.loc?.start?.line || 0;
          if (!functions.has(name)) {
            functions.set(name, { line, calls: [] });
          }
        }
      },

      ClassDeclaration: {
        enter(path) {
          const name = path.node.id?.name || "<anonymous-class>";
          const line = path.node.loc?.start?.line || 0;
          if (name !== "<anonymous-class>") {
            if (!functions.has(name)) {
              functions.set(name, { line, calls: [] });
            }
            fnStack.push(name);
          }
        },
        exit(path) {
          const name = path.node.id?.name;
          if (name && fnStack[fnStack.length - 1] === name) {
            fnStack.pop();
          }
        },
      },

      // Arrow/function expressions need scope tracking too
      "FunctionExpression|ArrowFunctionExpression": {
        enter(path) {
          // Check if parent is a VariableDeclarator — already handled
          if (path.parent?.type === "VariableDeclarator" && path.parent.id?.type === "Identifier") {
            const name = path.parent.id.name;
            fnStack.push(name);
          }
          // Check if it's a named function expression
          else if (path.node.type === "FunctionExpression" && path.node.id) {
            const name = path.node.id.name;
            if (!functions.has(name)) {
              functions.set(name, { line: path.node.loc?.start?.line || 0, calls: [] });
            }
            fnStack.push(name);
          }
          // Method in object/class
          else if (path.parent?.type === "ObjectProperty" || path.parent?.type === "ClassMethod") {
            // Use parent key name
          }
        },
        exit(path) {
          if (path.parent?.type === "VariableDeclarator" && path.parent.id?.type === "Identifier") {
            const name = path.parent.id.name;
            if (fnStack[fnStack.length - 1] === name) {
              fnStack.pop();
            }
          } else if (path.node.type === "FunctionExpression" && path.node.id) {
            const name = path.node.id.name;
            if (fnStack[fnStack.length - 1] === name) {
              fnStack.pop();
            }
          }
        },
      },

      // Collect call expressions
      CallExpression(path) {
        const callee = path.node.callee;
        const line = path.node.loc?.start?.line || 0;
        const enclosingFn = fnStack[fnStack.length - 1];

        let calleeName = null;

        if (callee.type === "Identifier") {
          // Direct call: foo()
          calleeName = callee.name;
          if (shouldSkipCallee(calleeName)) return;
        } else if (callee.type === "MemberExpression" && !callee.computed) {
          // Property call: X.foo()
          if (callee.object.type === "Identifier") {
            if (isBuiltinMemberCall(callee.object.name)) return;
            // For member calls like moduleVar.method(), record the object as the call target
            // (since in Bun's hoisted scope, cross-module calls are direct, not member access)
            // Member access typically means: internal method call, React hook, etc.
            // We'll record it as "ObjectName.methodName" for clarity
            calleeName = callee.object.name + "." + callee.property.name;
            if (callee.object.name.length <= 2) return; // skip minified
          }
        }

        if (calleeName) {
          // Add to enclosing function's calls
          if (!functions.has(enclosingFn)) {
            functions.set(enclosingFn, { line: 0, calls: [] });
          }
          functions.get(enclosingFn).calls.push({ name: calleeName, line });
        }
      },

      // Also catch `new X()` as a call
      NewExpression(path) {
        const callee = path.node.callee;
        const line = path.node.loc?.start?.line || 0;
        const enclosingFn = fnStack[fnStack.length - 1];

        if (callee.type === "Identifier") {
          const name = callee.name;
          if (shouldSkipCallee(name)) return;
          if (BUILTIN_OBJECTS.has(name)) return;

          if (!functions.has(enclosingFn)) {
            functions.set(enclosingFn, { line: 0, calls: [] });
          }
          functions.get(enclosingFn).calls.push({ name, line });
        }
      },
    });
  } catch {
    return extractFunctionGraphRegex(code, file);
  }

  return { functions, localDefs };
}

/**
 * Regex fallback for unparseable modules.
 */
function extractFunctionGraphRegex(code, file) {
  const functions = new Map();
  const localDefs = new Set();

  // Extract function definitions
  const fnDefRe = /(?:^|\n)\s*(?:async\s+)?function\s+([a-zA-Z_$]\w*)\s*\(/g;
  let match;
  while ((match = fnDefRe.exec(code)) !== null) {
    const name = match[1];
    const line = code.substring(0, match.index).split("\n").length;
    functions.set(name, { line, calls: [] });
    localDefs.add(name);
  }

  // Extract const/let/var = function/arrow
  const varFnRe = /(?:^|\n)\s*(?:const|let|var)\s+([a-zA-Z_$]\w*)\s*=\s*(?:async\s+)?(?:function|\(|[a-zA-Z_$])/g;
  while ((match = varFnRe.exec(code)) !== null) {
    const name = match[1];
    const line = code.substring(0, match.index).split("\n").length;
    if (!functions.has(name)) {
      functions.set(name, { line, calls: [] });
    }
    localDefs.add(name);
  }

  // Extract call expressions — attribute all to <module-init> since we can't track scope
  const calls = [];
  const callRe = /(?:^|[^.\w$])([a-zA-Z_$]\w*)\s*\(/g;
  while ((match = callRe.exec(code)) !== null) {
    const name = match[1];
    if (!shouldSkipCallee(name)) {
      calls.push({ name, line: code.substring(0, match.index).split("\n").length });
    }
  }

  functions.set("<module-init>", { line: 1, calls });

  return { functions, localDefs };
}

// ---------------------------------------------------------------------------
// Phase 3: Resolve cross-module references
// ---------------------------------------------------------------------------

/**
 * Build a definition index from all parsed modules.
 * Maps function names to all modules where they're defined at the top level.
 * This supplements the export index (which only has MR() exports) with ALL
 * top-level definitions, since Bun hoists everything into shared scope.
 */
function buildDefinitionIndex(moduleGraphs) {
  const defIndex = Object.create(null); // functionName → [{ moduleName, file }]

  for (const [file, { moduleName, functions }] of moduleGraphs) {
    for (const [fnName] of functions) {
      if (fnName === "<module-init>") continue;
      if (!defIndex[fnName]) defIndex[fnName] = [];
      defIndex[fnName].push({ moduleName, file });
    }
  }

  return defIndex;
}

/**
 * Resolve a call target to a module using both export index and definition index.
 *
 * Resolution priority:
 * 1. Local definition → internal call
 * 2. Export index (manifest MR() exports) — most reliable
 * 3. Definition index (all top-level defs) — broader but may have collisions
 * 4. Unresolved
 */
function resolveCall(
  calleeName,
  callerFile,
  localDefs,
  callerModuleName,
  exportIndex,
  defIndex,
  moduleByName
) {
  // Member expression calls (X.foo) — skip for cross-module resolution
  if (calleeName.includes(".")) {
    return { file: null, type: "member-access" };
  }

  // Local definition → internal call
  if (localDefs.has(calleeName)) {
    return { file: callerFile, type: "internal" };
  }

  // Try export index first (most reliable — explicitly exported names)
  const exportSources = exportIndex[calleeName];
  if (exportSources && exportSources.length > 0) {
    if (exportSources.length === 1) {
      return { file: exportSources[0].file, type: "cross-module" };
    }
    // Colliding export — disambiguate with deps
    const resolved = disambiguateWithDeps(exportSources, callerModuleName, moduleByName);
    if (resolved) return resolved;
  }

  // Try definition index (all top-level function defs across modules)
  const defSources = defIndex[calleeName];
  if (defSources && defSources.length > 0) {
    // Filter out self-module (already handled as internal)
    const external = defSources.filter((s) => s.file !== callerFile);
    if (external.length === 0) {
      // Only defined in self — treat as internal even though not in localDefs
      // (might be defined in a nested scope that we didn't track)
      return { file: callerFile, type: "internal" };
    }
    if (external.length === 1) {
      return { file: external[0].file, type: "cross-module" };
    }
    // Multiple external defs — disambiguate with deps
    const resolved = disambiguateWithDeps(external, callerModuleName, moduleByName);
    if (resolved) return resolved;
    return { file: null, type: "ambiguous" };
  }

  return { file: null, type: "unresolved" };
}

/**
 * Disambiguate multiple candidate modules using the caller's dep list.
 */
function disambiguateWithDeps(candidates, callerModuleName, moduleByName) {
  const callerMod = moduleByName[callerModuleName];
  if (!callerMod || !callerMod.deps) return null;

  const callerDeps = new Set(callerMod.deps);
  const matches = candidates.filter((s) => callerDeps.has(s.moduleName));

  if (matches.length === 1) {
    return { file: matches[0].file, type: "cross-module" };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Phase 4 & 5: Build graph and output
// ---------------------------------------------------------------------------

function main() {
  const opts = parseArgs();
  const resplitDir = opts.resplitDir;

  // Load manifest
  const manifestPath = join(resplitDir, "manifest.json");
  if (!existsSync(manifestPath)) {
    console.error(`manifest.json not found in ${resplitDir}`);
    process.exit(1);
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

  console.log(`Loaded manifest: ${Object.keys(manifest.modules).length} modules`);

  // Phase 1: Build export index
  const { exportIndex, moduleByName, nameByFile } = buildExportIndex(manifest);
  const exportNames = Object.keys(exportIndex);
  const uniqueExports = exportNames.filter((n) => exportIndex[n].length === 1).length;
  console.log(
    `Export index: ${exportNames.length} names (${uniqueExports} unique, ${exportNames.length - uniqueExports} colliding)`
  );

  // Determine which modules to process
  let modulesToProcess = Object.entries(manifest.modules).filter(
    ([, mod]) => !mod.vendor
  );
  if (opts.module) {
    modulesToProcess = modulesToProcess.filter(
      ([, mod]) => mod.file === opts.module
    );
    if (modulesToProcess.length === 0) {
      console.error(`Module ${opts.module} not found`);
      process.exit(1);
    }
  }

  console.log(`Processing ${modulesToProcess.length} app modules...`);

  // Phase 2: Parse all modules
  const moduleGraphs = new Map(); // file → { moduleName, functions, localDefs }
  let parsedCount = 0;
  let regexFallbackCount = 0;
  let totalFunctions = 0;
  let totalCalls = 0;

  for (const [moduleName, mod] of modulesToProcess) {
    const filePath = join(resplitDir, mod.file);
    if (!existsSync(filePath)) continue;

    const code = readFileSync(filePath, "utf-8");
    const { functions, localDefs } = extractFunctionGraph(code, mod.file);

    // Check if regex fallback was used (heuristic: if only <module-init> has calls)
    if (
      functions.size === 1 &&
      functions.has("<module-init>") &&
      code.length > 200
    ) {
      regexFallbackCount++;
    }

    moduleGraphs.set(mod.file, { moduleName, functions, localDefs });
    parsedCount++;
    totalFunctions += functions.size;
    for (const [, fn] of functions) {
      totalCalls += fn.calls.length;
    }

    if (parsedCount % 500 === 0) {
      console.log(`  Parsed ${parsedCount}/${modulesToProcess.length} modules...`);
    }
  }

  console.log(
    `Parsed ${parsedCount} modules: ${totalFunctions} functions, ${totalCalls} call expressions`
  );
  if (regexFallbackCount > 0) {
    console.log(`  (${regexFallbackCount} used regex fallback)`);
  }

  // Phase 2.5: Build definition index (all top-level defs across modules)
  const defIndex = buildDefinitionIndex(moduleGraphs);
  const defNames = Object.keys(defIndex);
  const uniqueDefs = defNames.filter((n) => defIndex[n].length === 1).length;
  console.log(
    `Definition index: ${defNames.length} names (${uniqueDefs} unique, ${defNames.length - uniqueDefs} colliding)`
  );

  // Phase 3: Resolve all calls
  let resolvedCross = 0;
  let resolvedInternal = 0;
  let unresolvedCount = 0;
  let ambiguousCount = 0;
  let memberAccessCount = 0;
  const unresolvedNames = new Map(); // name → count

  // Build the output graph
  const graph = {};

  for (const [file, { moduleName, functions, localDefs }] of moduleGraphs) {
    graph[file] = {
      moduleName,
      functions: {},
    };

    for (const [fnName, fnData] of functions) {
      const resolvedCalls = [];

      for (const call of fnData.calls) {
        const resolution = resolveCall(
          call.name,
          file,
          localDefs,
          moduleName,
          exportIndex,
          defIndex,
          moduleByName
        );

        if (resolution.type === "cross-module") {
          resolvedCalls.push({
            name: call.name,
            file: resolution.file,
            type: "cross-module",
            line: call.line,
          });
          resolvedCross++;
        } else if (resolution.type === "internal") {
          resolvedCalls.push({
            name: call.name,
            file,
            type: "internal",
            line: call.line,
          });
          resolvedInternal++;
        } else if (resolution.type === "member-access") {
          memberAccessCount++;
          // Don't include member-access in the graph (mostly noise)
        } else if (resolution.type === "ambiguous") {
          ambiguousCount++;
          resolvedCalls.push({
            name: call.name,
            file: null,
            type: "ambiguous",
            line: call.line,
          });
        } else {
          unresolvedCount++;
          unresolvedNames.set(
            call.name,
            (unresolvedNames.get(call.name) || 0) + 1
          );
        }
      }

      // Deduplicate calls (same name+file, keep first occurrence)
      const seen = new Set();
      const dedupedCalls = [];
      for (const c of resolvedCalls) {
        const key = `${c.name}:${c.file}`;
        if (!seen.has(key)) {
          seen.add(key);
          dedupedCalls.push({ name: c.name, file: c.file, type: c.type });
        }
      }

      graph[file].functions[fnName] = {
        line: fnData.line,
        calls: dedupedCalls,
        calledBy: [], // populated in Phase 4
      };
    }
  }

  // Phase 4: Build calledBy (invert edges)
  let edgeCount = 0;
  for (const [callerFile, modData] of Object.entries(graph)) {
    for (const [callerFn, fnData] of Object.entries(modData.functions)) {
      for (const call of fnData.calls) {
        if (!call.file || call.type === "ambiguous") continue;

        const targetMod = graph[call.file];
        if (!targetMod) continue;

        const targetFn = targetMod.functions[call.name];
        if (!targetFn) continue;

        targetFn.calledBy.push({
          name: callerFn,
          file: callerFile,
          type: call.type,
        });
        edgeCount++;
      }
    }
  }

  // Count total unique edges
  const totalEdges = resolvedCross + resolvedInternal;

  console.log(`\nResolution results:`);
  console.log(`  Cross-module calls: ${resolvedCross}`);
  console.log(`  Internal calls:     ${resolvedInternal}`);
  console.log(`  Member-access:      ${memberAccessCount} (excluded)`);
  console.log(`  Ambiguous:          ${ambiguousCount}`);
  console.log(`  Unresolved:         ${unresolvedCount}`);
  console.log(`  Bidirectional edges: ${edgeCount}`);

  // --stats: Show detailed statistics
  if (opts.stats) {
    printStats(graph, exportIndex, unresolvedNames);
  }

  // --unresolved: Show unresolved call names
  if (opts.unresolved) {
    printUnresolved(unresolvedNames);
  }

  // --query: Look up a specific function
  if (opts.query) {
    printQuery(opts.query, graph, exportIndex);
    return;
  }

  // --dot: Output DOT format
  if (opts.dot) {
    printDot(graph, opts.out, opts.dryRun);
    return;
  }

  // Write output
  if (!opts.dryRun) {
    const output = {
      _meta: {
        generatedAt: new Date().toISOString(),
        modules: moduleGraphs.size,
        functions: totalFunctions,
        callExpressions: totalCalls,
        resolvedEdges: totalEdges,
        bidirectionalEdges: edgeCount,
        crossModule: resolvedCross,
        internal: resolvedInternal,
        ambiguous: ambiguousCount,
        unresolved: unresolvedCount,
      },
      exports: Object.fromEntries(
        Object.entries(exportIndex)
          .filter(([, v]) => v.length === 1)
          .map(([name, [{ moduleName, file }]]) => [
            name,
            { module: moduleName, file },
          ])
      ),
      modules: graph,
    };

    writeFileSync(opts.out, JSON.stringify(output, null, 2));
    console.log(`\nWrote ${opts.out} (${(readFileSync(opts.out).length / 1024 / 1024).toFixed(1)} MB)`);
  } else {
    console.log(`\n(dry run — no output written)`);
  }
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

function printStats(graph, exportIndex, unresolvedNames) {
  console.log(`\n--- Detailed Statistics ---`);

  // Most connected functions (by calledBy count)
  const allFunctions = [];
  for (const [file, modData] of Object.entries(graph)) {
    for (const [fnName, fnData] of Object.entries(modData.functions)) {
      if (fnName === "<module-init>") continue;
      allFunctions.push({
        name: fnName,
        file,
        callers: fnData.calledBy.length,
        callees: fnData.calls.length,
      });
    }
  }

  // Top callers (most callees)
  allFunctions.sort((a, b) => b.callees - a.callees);
  console.log(`\nTop 20 functions by callees (most calls out):`);
  for (const fn of allFunctions.slice(0, 20)) {
    console.log(`  ${fn.name} (${fn.file}): ${fn.callees} calls`);
  }

  // Top called (most callers)
  allFunctions.sort((a, b) => b.callers - a.callers);
  console.log(`\nTop 20 functions by callers (most called):`);
  for (const fn of allFunctions.slice(0, 20)) {
    console.log(`  ${fn.name} (${fn.file}): ${fn.callers} callers`);
  }

  // Module connectivity
  const moduleFnCounts = [];
  for (const [file, modData] of Object.entries(graph)) {
    const fns = Object.keys(modData.functions).filter((n) => n !== "<module-init>");
    const crossCalls = Object.values(modData.functions).reduce(
      (acc, fn) => acc + fn.calls.filter((c) => c.type === "cross-module").length,
      0
    );
    moduleFnCounts.push({ file, functions: fns.length, crossCalls });
  }
  moduleFnCounts.sort((a, b) => b.functions - a.functions);
  console.log(`\nTop 20 modules by function count:`);
  for (const m of moduleFnCounts.slice(0, 20)) {
    console.log(
      `  ${m.file}: ${m.functions} functions, ${m.crossCalls} cross-module calls`
    );
  }
}

function printUnresolved(unresolvedNames) {
  console.log(`\n--- Unresolved Call Names ---`);
  const sorted = [...unresolvedNames.entries()].sort((a, b) => b[1] - a[1]);
  console.log(`Total unique unresolved names: ${sorted.length}`);
  console.log(`\nTop 50 by frequency:`);
  for (const [name, count] of sorted.slice(0, 50)) {
    console.log(`  ${name}: ${count} occurrences`);
  }
}

function printQuery(queryName, graph, exportIndex) {
  console.log(`\n--- Query: ${queryName} ---`);

  // Find all definitions of this function
  const definitions = [];
  for (const [file, modData] of Object.entries(graph)) {
    if (modData.functions[queryName]) {
      definitions.push({ file, fn: modData.functions[queryName] });
    }
  }

  if (definitions.length === 0) {
    console.log(`Function "${queryName}" not found in any module.`);

    // Check if it's an export name
    if (exportIndex[queryName]) {
      console.log(`  (It's an export name in: ${exportIndex[queryName].map((s) => s.file).join(", ")})`);
    }
    return;
  }

  for (const { file, fn } of definitions) {
    console.log(`\n${queryName} (defined in ${file}, line ${fn.line})`);

    if (fn.calls.length > 0) {
      console.log(`  Calls:`);
      for (const call of fn.calls) {
        const suffix =
          call.type === "internal"
            ? " (internal)"
            : call.type === "ambiguous"
              ? " (ambiguous)"
              : "";
        const fileRef = call.file ? ` (${call.file})` : "";
        console.log(`    → ${call.name}${fileRef}${suffix}`);
      }
    } else {
      console.log(`  Calls: (none)`);
    }

    if (fn.calledBy.length > 0) {
      console.log(`  Called by:`);
      const shown = fn.calledBy.slice(0, 30);
      for (const caller of shown) {
        const suffix = caller.type === "internal" ? " (internal)" : "";
        console.log(`    ← ${caller.name} (${caller.file})${suffix}`);
      }
      if (fn.calledBy.length > 30) {
        console.log(`    ... (${fn.calledBy.length - 30} more callers)`);
      }
    } else {
      console.log(`  Called by: (none)`);
    }
  }
}

function printDot(graph, outPath, dryRun) {
  const lines = ["digraph deps {"];
  lines.push('  rankdir=LR;');
  lines.push('  node [shape=box, fontsize=10];');
  lines.push('  edge [fontsize=8];');
  lines.push("");

  // Create subgraph per module
  for (const [file, modData] of Object.entries(graph)) {
    const modLabel = file.replace(".js", "");
    lines.push(`  subgraph "cluster_${modLabel}" {`);
    lines.push(`    label="${modLabel}";`);
    lines.push(`    style=dashed;`);

    for (const fnName of Object.keys(modData.functions)) {
      if (fnName === "<module-init>") continue;
      const nodeId = `"${file}:${fnName}"`;
      lines.push(`    ${nodeId} [label="${fnName}"];`);
    }
    lines.push(`  }`);
    lines.push("");
  }

  // Add edges (cross-module only to keep it readable)
  for (const [callerFile, modData] of Object.entries(graph)) {
    for (const [callerFn, fnData] of Object.entries(modData.functions)) {
      if (callerFn === "<module-init>") continue;
      for (const call of fnData.calls) {
        if (call.type !== "cross-module" || !call.file) continue;
        const from = `"${callerFile}:${callerFn}"`;
        const to = `"${call.file}:${call.name}"`;
        lines.push(`  ${from} -> ${to};`);
      }
    }
  }

  lines.push("}");
  const dot = lines.join("\n");

  if (!dryRun) {
    const dotPath = outPath.replace(/\.json$/, ".dot");
    writeFileSync(dotPath, dot);
    console.log(`\nWrote ${dotPath} (${(dot.length / 1024).toFixed(1)} KB)`);
  } else {
    console.log(`\n(dry run — DOT output would be ${(dot.length / 1024).toFixed(1)} KB)`);
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

main();
