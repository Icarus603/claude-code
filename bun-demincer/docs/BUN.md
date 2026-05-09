# Bun Bundler Internals

How Bun's bundler works internally, and what can be exploited for deobfuscation of Bun-compiled standalone binaries.

---

## 1. Standalone Binary Format

Bun standalone executables (`bun build --compile`) embed all JavaScript in a platform-specific section:

| Platform | Location | Notes |
|----------|----------|-------|
| macOS | `__BUN` Mach-O segment | Code signature after trailer (~1.7MB padding) |
| Linux | Appended to ELF binary | Trailer at very end |
| Windows | `.bun` PE section | No 8-byte size header |

The section contains a `StandaloneModuleGraph`:

```
[8-byte size header (u64 LE)]
[data buffer: source code, bytecode, native addons, wasm modules...]
[module table: array of CompiledModuleGraphFile structs (52 bytes each)]
[Offsets struct (32 bytes)]
[\n---- Bun! ----\n]
[zero padding + code signature]
```

Even with `--bytecode` compilation, the **full JavaScript source is always stored alongside** the bytecode — JSC requires it. The `--bytecode` flag is a startup optimization, not obfuscation.

Source maps are **not included** in standalone binaries by default (`sourcemapSize: 0` for all modules). The `--sourcemap` flag has no effect with `--compile`.

---

## 2. Bundling Pipeline

```
Parse → Link → Wrap → Name → Minify → Output
```

1. **Parse** — Each source file parsed, imports/exports tracked
2. **Link** — Module graph resolved, chunks determined
3. **Wrap** — CJS modules wrapped with `__commonJS`, ESM with `__esm`
4. **Name** — Wrapper vars named `require_<filename>` or `init_<filename>` (derived from file path)
5. **Minify** — `MinifyRenamer` sorts all symbols by frequency, assigns base-54/64 names
6. **Output** — Single chunk with all modules as lazy factories

### Module wrapping rules

A module gets wrapped when (from `scanImportsAndExports.zig`):
- It's a CJS module (`ExportsKind.cjs`) → wrapped in `__commonJS`
- It has circular ESM dependencies → wrapped in `__esm`
- It's imported by both ESM and CJS consumers → needs wrapper for compatibility
- Entry point modules → **not** wrapped (emitted directly at top level)

### Module ordering in output

From `findAllImportedPartsInJSOrder.zig`:
1. Runtime parts come first (before all other code)
2. Dependencies before dependents (recursive traversal)
3. Files at equal distance sorted by stable source index (deterministic)
4. Within a file: namespace export part first, then other parts in declaration order

---

## 3. Minification

### Three renaming strategies

| Strategy | Usage | Behavior |
|----------|-------|----------|
| `NoOpRenamer` | No minification | Preserves all names |
| `NumberRenamer` | Collision avoidance | Preserves names, appends numbers (`foo`, `foo2`, `foo3`) |
| `MinifyRenamer` | Production builds | Frequency-based short names |

### Name generation (`NameMinifier` in `ast.zig`)

Uses **base-54 first char** + **base-64 tail chars**:
- First char: `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$` (54 chars)
- Tail chars: `abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_$` (64 chars)

Sequence: `a, b, c, ..., Z, _, $, aa, ab, ..., a9, a_, a$, ba, ...`

### Character frequency optimization (`CharFreq.zig`)

Before assigning names, Bun reorders the alphabet based on character frequency in the source:

1. Scan all source code, count character frequencies (`delta = +1`)
2. Subtract comments (`delta = -1`)
3. Subtract import path strings (`delta = -1`)
4. Subtract renameable symbol names, weighted by `use_count_estimate` (`delta = -use_count`)

Goal: count chars in the **non-renameable** parts (strings, keywords, properties) so minified names use the most prevalent chars for better gzip compression.

The 64 chars are sorted by descending frequency (ties broken by index). This becomes the shuffled alphabet — which is why the most common wrapper names aren't just `a` and `b`.

### Symbol slot allocation

- **Top-level symbols** share a global namespace across the entire chunk
- **Nested/scoped symbols** get per-scope slots, allowing name reuse across sibling scopes
- Most-used symbols get the shortest names (sorted by frequency)

### Reserved name gaps

The naming sequence has gaps for:
- All JS keywords (`break`, `case`, `class`, `const`, etc.)
- Strict mode reserved words (`implements`, `interface`, `let`, etc.)
- `Promise`, `Require`, and in CJS mode `exports`/`module`
- All unbound/global symbols used in the code (`console`, `window`, `process`, etc.)
- JSX components need capital first letter, so lowercase names are skipped for those slots

Gaps are deterministic if you know the reserved set.

### Wrapper variable naming (before minification)

From `ast/P.zig`: all wrapper refs start as `require_<filename>`.
From `scanImportsAndExports.zig`: ESM wrappers are renamed to `init_<filename>`.

The `fmtIdentifier` chain:
- For `index.js` files → uses **parent directory name** (e.g., `react/index.js` → `react`)
- Otherwise → file basename without extension (e.g., `utils.js` → `utils`)
- Non-identifier chars replaced with `_` (e.g., `my-module.min` → `my_module_min`)

**When minification is active, these are completely replaced with short names.**

---

## 4. What Survives Minification

### Always preserved (readable in output)
- **Property names** (`.foo`, `.bar`) — not identifier symbols
- **String literals** — not renamed
- **Export alias strings** in `MR()` calls — string keys in the `__export` mapping
- **Unbound globals** (`console`, `Math`, `process`) — `must_not_be_renamed`
- **Object keys** — string context

### Always mangled (lost without source maps)
- **Local variable names** — frequency-based short names
- **`require_xxx` / `init_xxx` wrappers** — fully mangled in production
- **Function parameter names** — minified
- **Internal cross-module import bindings** — minified

### Symbols exempt from minification

Only these survive:
1. **Unbound symbols** (globals: `console`, `Math`, `process`, etc.)
2. **`must_not_be_renamed`** symbols (`arguments`, `with` statement refs)
3. **Reserved names**: JS keywords, strict mode words, `Promise`, `Require`, and in CJS mode `exports`/`module`

What sets `must_not_be_renamed`:
1. Inside a `with` scope (dynamic property lookup)
2. The `arguments` variable
3. TS constructor parameter properties (`constructor(public x)`)
4. `module`, `exports`, `require` CJS builtins
5. All named exports (public API)
6. Inherited through symbol merging
7. `contains_direct_eval` on a scope (prevents renaming all accessible symbols)
8. `unbound` kind (treated as `must_not_be_renamed` by `slotNamespace()`)
9. Bundler-generated runtime glue symbols

---

## 5. Module System in Bundled Output

### Three types of module output

1. **CJS-wrapped** (`WrapKind.cjs`): `var X = y((exports, module) => { ... })` — one wrapper = one source file
2. **ESM-wrapped** (`WrapKind.esm`): `var X = h(() => { ... })` — one wrapper = one source file
3. **Unwrapped** (`WrapKind.none`): code emitted directly at top level, no visible boundary

### Module boundary detection

For wrapped modules, `resplit.mjs` detects the `y()` and `h()` wrapper patterns.

For **unwrapped modules**, the pattern `var X = {}; MR(X, {...})` marks the start of each ESM module's namespace export part (Part 0). This two-statement pattern can detect modules with `WrapKind.none`.

### Inter-wrapper code

Code between `var A = h(...)` and `var B = h(...)` belongs to module A. Bun emits per module:
1. Hoisted `var` declarations for exports (outside the wrapper, accessible before init)
2. The wrapper call itself: `var A = h(() => { ... })`
3. Functions/classes defined at module top-level scope
4. The `MR(A_exports, {...})` namespace export call

### Module boundary comments

When **not** minifying whitespace, Bun emits `// path/to/file.js` before each source file's output. Controlled by `show_comments = mode == .bundle and !minify_whitespace`. Production builds with `--minify` strip these.

### Dependency graph extraction

Bun's bundled modules reference each other by calling the wrapper variable as a function:

**ESM modules (`h()` wrappers)** — dependencies appear as init calls at the start:
```js
var zkT = h(() => {
  cqA();    // init dependency 1
  mqA();    // init dependency 2
  // ... module body follows
});
```

**CJS modules (`y()` wrappers)** — dependencies called inline where needed:
```js
var u5R = y((exports, module) => {
  var { x } = e5_();      // require dependency (destructured)
  var val = R2_();         // require dependency (direct)
  var wrapped = v(_2_(), 1); // require + __toESM wrapper
});
```

Detection algorithm:
1. Collect all wrapper variable names into a Set
2. For each module, find all `IDENTIFIER()` calls where IDENTIFIER is in the module set
3. Exclude self-references and property accesses (`obj.IDENTIFIER()`)

### Import erasure

Bun does **not** preserve import statements between bundled modules:
1. `matchImportWithExport()` traces each import through re-export chains
2. The import symbol's `Ref` is linked to the export symbol's `Ref`
3. Both get the **same renamed identifier** in output
4. The `import` statement is **stripped entirely**

So `import { foo } from './bar'` disappears — all uses of `foo` directly reference `bar`'s definition.

### Circular dependency handling

- **ESM:** Wrapped in `__esm(() => { ... })` (lazy init, runs once). Variables hoisted outside wrapper as `var`.
- **CJS:** Wrapped in `__commonJS((exports, module) => { ... })` (memoized thunk). Second call returns partially-initialized `module.exports`.
- **Import resolution:** `matchImportWithExport` uses a cycle detector stack, returns `.cycle` on detection.

### `export *` compilation

- **Static (internal ESM):** Resolved at build time. All named exports copied to importer's `resolved_exports` map. The `export *` statement is removed entirely.
- **Dynamic (CJS/external):** Becomes `__reExport(exports, require_otherModule())` at runtime.

---

## 6. Runtime Helpers

These get embedded in every bundle and minified. The minified names vary per build (determined by character frequency optimization), but the patterns are stable.

| Original | Purpose |
|----------|---------|
| `__commonJS` | CJS module factory — `(cb, mod?) => () => exports` (lazy thunk) |
| `__esm` | ESM module lazy initializer — `(fn, res?) => () => res` |
| `__toESM` | CJS→ESM wrapper — `(mod, isNodeMode, target?) => obj` |
| `__toCommonJS` | ESM→CJS wrapper — `(from) => obj` |
| `__export` | Define named ESM exports with getters — `(target, all) => void` |
| `__reExport` | `export * from` implementation — `(target, mod, secondTarget?) => void` |
| `__defProp` | Alias for `Object.defineProperty` |
| `__getOwnPropNames` | Alias for `Object.getOwnPropertyNames` |
| `__getOwnPropDesc` | Alias for `Object.getOwnPropertyDescriptor` |
| `__hasOwnProp` | Alias for `Object.prototype.hasOwnProperty` |
| `__create` | Alias for `Object.create` |
| `__getProtoOf` | Alias for `Object.getPrototypeOf` |
| `__accessProp` | `function(key) { return this[key] }` (shared getter, used with `.bind`) |
| `__returnValue` | Identity function `(v) => v` |
| `__exportSetter` | Internal setter for `__export` reassignment |
| `__using` | TC39 `using` declaration — `(stack, value, async?) => value` |
| `__callDispose` | Resource disposal — `(stack, error, hasError) => void` |

Three internal WeakMap caches for `__toESM` and `__toCommonJS`.

Tree-shakeable helpers (only included when used): `__name`, `__exportValue`, `__exportDefault`, `__merge`, all decorator helpers, `$$typeof`, `__jsonParse`, `__promiseAll`.

---

## 7. Name Recovery Patterns

### `__export()` / `MR()` — the goldmine

The `MR(target, { exportName: () => minifiedVar, ... })` pattern explicitly maps original export names to minified variables. This is the **single biggest source** of automatic name recovery.

Without minification: `calculateTotal: () => calculateTotal` (key === var)
With minification: `calculateTotal: () => a` (key preserved, var mangled)

### `__toCommonJS()` / `OW()` destructuring

At import sites: `{exportName: localVar} = (initModule(), OW(moduleExports))` reveals that the module exports `exportName` and the local binding is `localVar`. Different from `MR()` — these appear at import sites, not export sites.

### `__reExport()` / `R9()` calls

Indicate `export * from` relationships between modules.

### `this.name = "X"` in constructors

Classes (especially Error subclasses) with `this.name = "X"` in their constructor reveal the original class name:
```js
class TK extends Error { constructor() { this.name = "SocketConnectionError" } }
// → TK = SocketConnectionError
```

### `displayName = "X"` assignments

React component/context display names:
```js
J4A.displayName = "TerminalFocusContext"
// → J4A = TerminalFocusContext
```

### `userFacingName()` methods

Classes with `userFacingName()` returning string literals reveal tool/feature names:
```js
userFacingName() { return "TaskUpdate" }
```

### String-based patterns

Many other strings leak original names:
- **Error messages** often contain function/class names
- **`process.env.*` references** — environment variable names are string literals
- **`require()` calls** — external module names preserved as strings
- **`name:` property assignments** — tool registration, span names
- **`key:` property assignments** — keybinding/config keys
- **`.describe()` on Zod schemas** — human-readable descriptions
- **`Symbol.for("...")` calls** — globally registered symbol names
- **Feature flag names** — string literals
- **`class ... extends` patterns** — may reveal parent class names
- **`prototype.*` methods** — readable method names

---

## 8. Deobfuscation Strategies

### Tier 1: Automated (implemented in bun-demincer)

1. **`MR()` export mining** — `extract-exports.mjs` harvests `exportName → minifiedVar` renames
2. **Name-leaking patterns** — `extract-names.mjs` harvests `this.name` and `displayName` renames
3. **Tool/error names** — `extract-tools.mjs` and `extract-errors.mjs` harvest additional patterns
4. **Runtime helper identification** — 20+ Bun runtime functions mapped to their minified names
5. **Structural deobfuscation** — wakaru (`!0→true`) + lebab (ES5→ES6) + prettier
6. **AI-assisted renaming** — `ai-rename.mjs` and `ai-rename-scoped.mjs` use LLMs to infer semantic names from context

### Tier 2: Feasible with more tooling

7. **Cross-module reference tracing** — Follow wrapper call chains to build a module dependency graph. Trace which modules consume which exports.
8. **String-based heuristics** — Propagate names from error messages, class names in strings, env var references.
9. **Reverse slot numbering** — Given the char frequency alphabet, invert `numberToMinifiedName` to get slot ranks. Compare symbol frequency ranks between versions.

### Tier 3: Requires Bun source modification

10. **Patched Bun with symbol table output** — Add ~10 lines to `assignNamesByFrequency` in `renamer.zig` to emit `original_name → minified_name` for each slot. Fully deterministic.
11. **`BUN_FEATURE_FLAG_DUMP_CODE`** — Use a canary/debug Bun build to dump individual modules from any `--compile`d binary.
12. **`BUN_DUMP_SYMBOLS`** — Debug build dumps the symbol table (but only for `NumberRenamer`/non-minified path).
13. **`--metafile` on source build** — If you have access to the build system, the metafile output gives the complete module graph.

### Tier 4: Research

14. **Frequency-rank matching across versions** — Since minification is deterministic, comparing symbol frequency ranks between versions could identify renamed symbols.
15. **Build a dummy project with same deps** — Bundle with `bun build --no-minify`, compare module structure to identify vendor code boundaries and recover all original vendor names.

---

## 9. CLI Flags Reference

### Minification flags

| Flag | Effect |
|------|--------|
| `--minify` | Enable all minification (syntax + whitespace + identifiers) |
| `--minify-syntax` | Syntax only (`true`→`!0`, `void 0`, etc.) |
| `--minify-whitespace` | Whitespace only (also disables module boundary comments) |
| `--minify-identifiers` | Mangle identifiers only |
| `--keep-names` | Preserve function/class names even when mangling identifiers |
| `--production` | Implies `--minify` + sets `NODE_ENV=production` |

**Key insight:** These are separate flags. `--minify-syntax --minify-whitespace` without `--minify-identifiers` preserves **all** variable names.

### Source maps

| Flag | Effect |
|------|--------|
| `--sourcemap=linked` | Generate `.map` file + add `//# sourceMappingURL` comment |
| `--sourcemap=inline` | Embed sourcemap as base64 in output |
| `--sourcemap=external` | Generate `.map` file only (no comment) |
| `--sourcemap=none` | No sourcemap (default for `--compile`) |

### Metafile (module graph output)

| Flag | Effect |
|------|--------|
| `--metafile <path>` | Write JSON with module graph, sizes, import chains (esbuild-compatible) |
| `--metafile-md <path>` | Write markdown module graph visualization |

### `--compile` specific

| Flag | Effect |
|------|--------|
| `--compile` | Generate standalone Bun executable (implies `--production`) |
| `--bytecode` | Pre-compile to JSC bytecode cache |
| `--compile-exec-argv <STR>` | Prepend args to standalone's `execArgv` |

### Debug environment variables

| Variable | Effect | Availability |
|----------|--------|-------------|
| `BUN_FEATURE_FLAG_DUMP_CODE=<dir>` | Dumps all bundled output files | Canary/debug builds only |
| `BUN_DUMP_SYMBOLS` | Dumps symbol table during renaming | Debug builds only |
| `BUN_DEBUG=<path>` | General debug log output | Any build |
| `BUN_DEBUG_ALL=1` | Enable all debug logging scopes | Any build |

### Other useful flags

| Flag | Effect |
|------|--------|
| `--no-bundle` | Transpile only, keep modules separate |
| `--splitting` | Code splitting (multiple output chunks) |
| `--define K:V` | Substitute values at parse time |
| `--drop <name>` | Remove function calls (e.g., `--drop=console`) |
| `--ignore-dce-annotations` | Ignore `@__PURE__` tree-shaking hints |
| `--banner/--footer <STR>` | Add text to output |

---

## 10. Minification Reversal

### Can we reverse a minified name to a slot number?

**Yes.** The `numberToMinifiedName` encoding is bijective:

```
numberToMinifiedName(i):
  name[0] = head[i % 54]
  i = i / 54
  while i > 0:
    i -= 1
    name[next] = tail[i % 64]
    i = i / 64
```

Given the head/tail alphabets, we can invert this to get the slot number. The alphabets can be approximately reconstructed by counting char frequencies in the non-identifier parts of the bundle.

### From slot number to original name: much harder

**Top-level symbols:** Unique slots, deterministic sort order `(count desc, stable_source_index asc, innerIndex asc)`. If we can reproduce the same sort order, we can match them.

**Nested scope symbols:** Many-to-one mapping. The same slot is reused across sibling scopes. Cannot distinguish without scope context.

---

## 11. Printer / Code Generator

Source: `src/js_printer.zig`

### Syntax preservation

Bun's printer preserves modern JS syntax — it does **not** desugar:
- Classes stay as `class Foo extends Bar { ... }` (not prototypes)
- Arrow functions, async/await, destructuring, template literals, optional chaining (`?.`), nullish coalescing (`??`) — all preserved

### `--minify-syntax` transformations (what wakaru reverses)

- `true` → `!0`, `false` → `!1`
- `undefined` → `void 0`
- Template literals → string concatenation
- Computed property keys may be converted to identifiers
- Some expressions simplified

### `--minify-whitespace` effects

- Removes all non-essential whitespace/newlines
- Disables module boundary comments (`// path/to/file.js`)
- Disables `@__PURE__` annotation emission

### `--minify-identifiers` effects

- Replaces all renameable identifiers with short names via `MinifyRenamer`
- Does **not** affect property names, string literals, or unbound globals

---

## 12. Bun Source Reference

### Key source files (in `bun/src/`)

| File | Purpose |
|------|---------|
| `runtime.js` | Runtime helper functions embedded in every bundle |
| `bundler/bundle_v2.zig` | Main bundler orchestration |
| `bundler/LinkerContext.zig` | Linking and chunk generation |
| `bundler/linker_context/generateCodeForFileInChunkJS.zig` | Module wrapper code generation |
| `bundler/linker_context/scanImportsAndExports.zig` | Import/export analysis, wrapper naming |
| `renamer.zig` | Symbol minification engine (3 strategies) |
| `ast.zig` | `NameMinifier`: base-54/64 name generation |
| `ast/CharFreq.zig` | Character frequency analysis |
| `StandaloneModuleGraph.zig` | Standalone binary module graph format |
| `ast/P.zig` | Parser — creates `wrapper_ref` with filename-based names |
| `ast/Symbol.zig` | Symbol kinds, slot namespaces, rename exemptions |
| `logger.zig` / `fs.zig` | `fmtIdentifier` — filename-to-identifier conversion |

### Key data structures

| Structure | Location | Purpose |
|-----------|----------|---------|
| `LinkerGraph` | `LinkerGraph.zig` | Central graph: files, symbols, ASTs, metadata |
| `ImportRecord` | per-file AST | Tracks what each file imports (source_index, kind) |
| `imports_to_bind` | per-file meta | Maps local import Ref → {source_index, import_ref} |
| `resolved_exports` | per-file meta | Maps export name → {source_index, import_ref} |
| `Dependency` | `ast.zig` | Cross-file part dependency: {source_index, part_index} |
| `PartRange` | `bundle_v2.zig` | Contiguous range of parts from one file in a chunk |
| `ExportsKind` | per-file | `.cjs`, `.esm`, `.esm_with_dynamic_fallback`, `.none` |
| `WrapKind` | per-file flags | `.none`, `.cjs`, `.esm` — determines wrapper pattern |

### Symbol kinds

| Kind | Meaning | Slot Namespace |
|------|---------|---------------|
| `unbound` | Not declared (e.g. `window`, `console`) | `must_not_be_renamed` |
| `hoisted` | `var` declarations, function arguments | `default` |
| `hoisted_function` | Function statements | `default` |
| `catch_identifier` | `catch (e)` variable | `default` |
| `generator_or_async_function` | Not hoisted, can overwrite same-name fns | `default` |
| `arguments` | The special `arguments` variable | `default` (but `must_not_be_renamed=true`) |
| `class` | Classes (can merge with TS namespaces) | `default` |
| `private_field/method/get/set` | `#foo` members | `private_name` |
| `label` | Label identifiers | `label` |
| `ts_enum` / `ts_namespace` | TypeScript constructs | `default` |
| `import` | ES6 imports | `default` |
| `constant` | `const` declarations | `default` |
| `other` | Everything else | `default` |

Three independent naming namespaces: `default`, `label`, `private_name`. Symbols in different namespaces can share the same short name.

### The part system (tree-shaking granularity)

Each file is divided into **Parts** — groups of related top-level statements:

```zig
Part = struct {
    stmts: []Stmt,
    declared_symbols: DeclaredSymbol.List,
    symbol_uses: SymbolUseMap,         // {Ref -> use_count}
    dependencies: Dependency.List,     // cross-file part deps
    can_be_removed_if_unused: bool,
    is_live: bool,                     // set by tree shaking
}
```

Part index 0 is always the **namespace export part** (contains the `MR(exports, {...})` call).

### Scope system

```
Scope.Kind = {
    block,              // { }
    with,               // "with" statement
    label,              // label scope
    class_name,         // class name binding
    class_body,         // class body
    catch_binding,      // catch (e) binding
    // --- hoisted vars stop propagating below ---
    entry,              // module / TS enum / TS namespace
    function_args,      // function parameter scope
    function_body,      // function body scope
    class_static_init   // static initializer block
}
```

Key scope fields: `members` (string→Ref map of all bindings), `children` (nested scopes), `contains_direct_eval` (disables all renaming).

---

## Minification Mode Comparison

Tested with actual `bun build`:

| Mode | Identifiers | Whitespace | Syntax | Module Comments |
|------|------------|------------|--------|-----------------|
| No flags | Original | Formatted | Original | Preserved |
| `--minify-syntax --minify-whitespace` | **Original** | Stripped | `!0`, `void 0` | Stripped |
| `--minify-identifiers` | Mangled | Formatted | Original | Preserved |
| `--minify` (all three) | Mangled | Stripped | `!0`, `void 0` | Stripped |

Wrapper naming without mangling: `exports_lib_esm`, `require_consumer_cjs`
Wrapper naming with mangling: `M`, `I`, `q`
