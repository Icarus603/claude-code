#!/usr/bin/env bun
/**
 * Dev entrypoint — launches cli.tsx with MACRO.* defines injected
 * via Bun's -d flag (bunfig.toml [define] doesn't propagate to
 * dynamically imported modules at runtime).
 */
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { getMacroDefines } from "./defines.ts";
import { getEnabledFeatures } from "./default-features.ts";

// Resolve project root from this script's location
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const projectRoot = join(__dirname, "..");
const cliPath = join(projectRoot, "packages/cli/src/entry/cli.tsx");

const defines = getMacroDefines();

const defineArgs = Object.entries(defines).flatMap(([k, v]) => [
    "-d",
    `${k}:${v}`,
]);

// Bun --feature flags: enable feature() gates at runtime.
// Default features come from scripts/default-features.ts (shared with
// build.ts). Add per-run flags via FEATURE_<NAME>=1 env vars,
// e.g. FEATURE_PROACTIVE=1 bun run dev
const featureArgs = getEnabledFeatures().flatMap((name) => ["--feature", name]);

// If BUN_INSPECT is set, pass --inspect-wait to the child process
const inspectArgs = process.env.BUN_INSPECT
    ? ["--inspect-wait=" + process.env.BUN_INSPECT]
    : [];

const result = Bun.spawnSync(
    ["bun", ...inspectArgs, "run", ...defineArgs, ...featureArgs, cliPath, ...process.argv.slice(2)],
    { stdio: ["inherit", "inherit", "inherit"], cwd: projectRoot },
);

process.exit(result.exitCode ?? 0);
