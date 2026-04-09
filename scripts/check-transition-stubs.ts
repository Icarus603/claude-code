#!/usr/bin/env bun

import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC_ROOT = join(ROOT, "src");
const TYPE_ANY_PATTERN = /export type [A-Za-z0-9_$]+ = any;?/m;

function walkDirectories(root: string, results: string[]) {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
		const fullPath = join(root, entry.name);
		results.push(fullPath);
		walkDirectories(fullPath, results);
	}
}

function collectNestedSrcStubDirs(): string[] {
	const directories: string[] = [];
	walkDirectories(SRC_ROOT, directories);
	return directories
		.filter((dir) => dir.endsWith(`${sep}src`))
		.map((dir) => relative(ROOT, dir).replaceAll(sep, "/"))
		.sort();
}

function collectTypeAnyStubFiles(scanRoot: string): string[] {
	const directories: string[] = [];
	walkDirectories(scanRoot, directories);
	const suspectFiles: string[] = [];

	for (const directory of directories) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
			const fullPath = join(directory, entry.name);
			const content = readFileSync(fullPath, "utf8");
			if (TYPE_ANY_PATTERN.test(content)) {
				suspectFiles.push(relative(ROOT, fullPath).replaceAll(sep, "/"));
			}
		}
	}

	return suspectFiles.sort();
}

const discoveredStubDirs = collectNestedSrcStubDirs();
const typeAnyStubFiles = collectTypeAnyStubFiles(ROOT);

console.log("Transition stub directories:", discoveredStubDirs.length);
console.log("Type-any transition stubs:", typeAnyStubFiles.length);

if (discoveredStubDirs.length > 0 || typeAnyStubFiles.length > 0) {
	if (discoveredStubDirs.length > 0) {
		console.error("\nRemaining transition src/*/src directories:");
		for (const dir of discoveredStubDirs) {
			console.error(`  - ${dir}`);
		}
	}
	if (typeAnyStubFiles.length > 0) {
		console.error("\nRemaining type-any transition stubs:");
		for (const file of typeAnyStubFiles) {
			console.error(`  - ${file}`);
		}
	}
	process.exit(1);
}

console.log("Transition stub check passed: 0 directories, 0 type-any stubs.");
