import { readdir, readFile, writeFile } from "fs/promises";
import { join } from "path";
import { getMacroDefines } from "./scripts/defines.ts";

const outdir = "dist";

// Step 1: Clean output directory
const { rmSync } = await import("fs");
rmSync(outdir, { recursive: true, force: true });

// Collect FEATURE_* env vars → Bun.build features
const features = Object.keys(process.env)
    .filter(k => k.startsWith("FEATURE_"))
    .map(k => k.replace("FEATURE_", ""));

// Step 2: Bundle with splitting
const result = await Bun.build({
    entrypoints: ["src/entrypoints/cli.tsx"],
    outdir,
    target: "bun",
    splitting: true,
    define: getMacroDefines(),
    features,
});

if (!result.success) {
    console.error("Build failed:");
    for (const log of result.logs) {
        console.error(log);
    }
    process.exit(1);
}

// Step 3: Post-process — replace Bun-only `import.meta.require` with Node.js compatible version
const files = await readdir(outdir);
const IMPORT_META_REQUIRE = "var __require = import.meta.require;";
const COMPAT_REQUIRE = `var __require = typeof import.meta.require === "function" ? import.meta.require : (await import("module")).createRequire(import.meta.url);`;

let patched = 0;
for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const filePath = join(outdir, file);
    const content = await readFile(filePath, "utf-8");
    if (content.includes(IMPORT_META_REQUIRE)) {
        await writeFile(
            filePath,
            content.replace(IMPORT_META_REQUIRE, COMPAT_REQUIRE),
        );
        patched++;
    }
}

console.log(
    `Bundled ${result.outputs.length} files to ${outdir}/ (patched ${patched} for Node.js compat)`,
);

// Step 4: Bundle download-ripgrep script as standalone JS for postinstall
const rgScript = await Bun.build({
    entrypoints: ["scripts/download-ripgrep.ts"],
    outdir,
    target: "node",
});
if (!rgScript.success) {
    console.error("Failed to bundle download-ripgrep script:");
    for (const log of rgScript.logs) {
        console.error(log);
    }
    // Non-fatal — postinstall fallback to bun run scripts/download-ripgrep.ts
} else {
    console.log(`Bundled download-ripgrep script to ${outdir}/`);
}
