#!/usr/bin/env bun
/**
 * Code health check script.
 *
 * Aggregates project metrics and prints a health report for:
 * - Code size (file count, line count)
 * - Lint issues (Biome)
 * - Test results (Bun test)
 * - Dead code (Knip)
 * - Build status
 */

import { $ } from "bun";

const DIVIDER = "─".repeat(60);

interface Metric {
	label: string;
	value: string | number;
	status: "ok" | "warn" | "error" | "info";
}

const metrics: Metric[] = [];

function add(label: string, value: string | number, status: Metric["status"] = "info") {
	metrics.push({ label, value, status });
}

function icon(status: Metric["status"]): string {
	switch (status) {
		case "ok":
			return "[OK]";
		case "warn":
			return "[!!]";
		case "error":
			return "[XX]";
		case "info":
			return "[--]";
	}
}

// ---------------------------------------------------------------------------
// 1. Code size
// ---------------------------------------------------------------------------
async function checkCodeSize() {
	const tsFiles = await $`find src -name '*.ts' -o -name '*.tsx' | grep -v node_modules`.text();
	const fileCount = tsFiles.trim().split("\n").filter(Boolean).length;
	add("TypeScript files", fileCount, "info");

	const loc = await $`find src -name '*.ts' -o -name '*.tsx' | grep -v node_modules | xargs wc -l | tail -1`.text();
	const totalLines = loc.trim().split(/\s+/)[0] ?? "?";
	add("Total LOC (src/)", totalLines, "info");
}

// ---------------------------------------------------------------------------
// 2. Lint check
// ---------------------------------------------------------------------------
async function checkLint() {
	try {
		const result = await $`bunx biome check src/ 2>&1`.quiet().nothrow().text();
		const errorMatch = result.match(/Found (\d+) errors?/);
		const warnMatch = result.match(/Found (\d+) warnings?/);
		const errors = errorMatch ? Number.parseInt(errorMatch[1]) : 0;
		const warnings = warnMatch ? Number.parseInt(warnMatch[1]) : 0;
		add("Lint errors", errors, errors === 0 ? "ok" : errors < 100 ? "warn" : "info");
		add("Lint warnings", warnings, warnings === 0 ? "ok" : "info");
	} catch {
		add("Lint check", "failed", "error");
	}
}

// ---------------------------------------------------------------------------
// 3. Tests
// ---------------------------------------------------------------------------
async function checkTests() {
	try {
		const result = await $`bun test 2>&1`.quiet().nothrow().text();
		const passMatch = result.match(/(\d+) pass/);
		const failMatch = result.match(/(\d+) fail/);
		const pass = passMatch ? Number.parseInt(passMatch[1]) : 0;
		const fail = failMatch ? Number.parseInt(failMatch[1]) : 0;
		add("Tests passed", pass, pass > 0 ? "ok" : "warn");
		add("Tests failed", fail, fail === 0 ? "ok" : "error");
	} catch {
		add("Tests", "failed", "error");
	}
}

// ---------------------------------------------------------------------------
// 4. Dead code
// ---------------------------------------------------------------------------
async function checkUnused() {
	try {
		const result = await $`bunx knip-bun 2>&1`.quiet().nothrow().text();
		const unusedFiles = result.match(/Unused files \((\d+)\)/);
		const unusedExports = result.match(/Unused exports \((\d+)\)/);
		const unusedDeps = result.match(/Unused dependencies \((\d+)\)/);
		add("Unused files", unusedFiles?.[1] ?? "0", "info");
		add("Unused exports", unusedExports?.[1] ?? "0", "info");
		add("Unused dependencies", unusedDeps?.[1] ?? "0", unusedDeps && Number(unusedDeps[1]) > 0 ? "warn" : "ok");
	} catch {
		add("Dead code check", "failed", "error");
	}
}

// ---------------------------------------------------------------------------
// 5. Build
// ---------------------------------------------------------------------------
async function checkBuild() {
	try {
		const result = await $`bun run build 2>&1`.quiet().nothrow();
		if (result.exitCode === 0) {
			// Get artifact size
			const stat = Bun.file("dist/cli.js");
			const mb = (stat.size / 1024 / 1024).toFixed(1);
			const size = `${mb} MB`;
			add("Build status", "success", "ok");
			add("Artifact size (dist/cli.js)", size, "info");
		} else {
			add("Build status", "failed", "error");
		}
	} catch {
		add("Build", "failed", "error");
	}
}

// ---------------------------------------------------------------------------
// 6. Transition stub guard
// ---------------------------------------------------------------------------
async function checkTransitionStubGuard() {
	try {
		const result = await $`bun run scripts/check-transition-stubs.ts 2>&1`.quiet().nothrow();
		add("Transition stub guard", result.exitCode === 0 ? "pass" : "failed", result.exitCode === 0 ? "ok" : "error");
	} catch {
		add("Transition stub guard", "failed", "error");
	}
}

// ---------------------------------------------------------------------------
// 7. Runtime skeleton guard
// ---------------------------------------------------------------------------
async function checkRuntimeSkeletonGuards() {
  const checks = [
    'scripts/verify-runtime-boundaries.ts',
    'scripts/verify-app-host-composition.ts',
    'scripts/verify-agent-owner.ts',
    'scripts/verify-provider-owner.ts',
    'scripts/verify-app-state-boundaries.ts',
    'scripts/verify-entry-thin-host.ts',
    'scripts/verify-repl-owner.ts',
    'scripts/verify-headless-host.ts',
    'scripts/verify-command-runtime.ts',
    'scripts/verify-mcp-runtime.ts',
    'scripts/verify-session-format-compat.ts',
    'scripts/verify-optional-integration-slots.ts',
    'scripts/verify-output-targets.ts',
    'scripts/verify-storage-contracts.ts',
  ]

  for (const script of checks) {
    try {
      const result = await $`bun run ${script} 2>&1`.quiet().nothrow()
      add(
        script.replace('scripts/', ''),
        result.exitCode === 0 ? 'pass' : 'failed',
        result.exitCode === 0 ? 'ok' : 'error',
      )
    } catch {
      add(script.replace('scripts/', ''), 'failed', 'error')
    }
  }
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log("");
console.log(DIVIDER);
console.log("  Code Health Report");
console.log(`  ${new Date().toLocaleString("en-US")}`);
console.log(DIVIDER);

await checkCodeSize();
await checkLint();
await checkTests();
await checkUnused();
await checkBuild();
await checkTransitionStubGuard();
await checkRuntimeSkeletonGuards();

console.log("");
for (const m of metrics) {
	const tag = icon(m.status);
	console.log(`  ${tag}  ${m.label.padEnd(20)} ${m.value}`);
}

const errorCount = metrics.filter((m) => m.status === "error").length;
const warnCount = metrics.filter((m) => m.status === "warn").length;

console.log("");
console.log(DIVIDER);
if (errorCount > 0) {
	console.log(`  Result: ${errorCount} errors, ${warnCount} warnings`);
} else if (warnCount > 0) {
	console.log(`  Result: no errors, ${warnCount} warnings`);
} else {
	console.log("  Result: all checks passed");
}
console.log(DIVIDER);
console.log("");

process.exit(errorCount > 0 ? 1 : 0);
