#!/usr/bin/env bun

import { readdirSync, readFileSync } from "fs";
import { join, relative, sep } from "path";

const ROOT = new URL("../", import.meta.url).pathname;
const SRC_ROOT = join(ROOT, "src");

const ALLOWED_SRC_STUB_DIRS = new Set([
	"src",
	"src/bootstrap/src",
	"src/bridge/src",
	"src/cli/src",
	"src/cli/transports/src",
	"src/commands/compact/src",
	"src/commands/ide/src",
	"src/commands/install-github-app/src",
	"src/commands/plugin/src",
	"src/commands/src",
	"src/commands/terminalSetup/src",
	"src/components/FeedbackSurvey/src",
	"src/components/HelpV2/src",
	"src/components/LogoV2/src",
	"src/components/PromptInput/src",
	"src/components/Settings/src",
	"src/components/StructuredDiff/src",
	"src/components/TrustDialog/src",
	"src/components/agents/new-agent-creation/wizard-steps/src",
	"src/components/agents/src",
	"src/components/grove/src",
	"src/components/hooks/src",
	"src/components/mcp/src",
	"src/components/messages/UserToolResultMessage/src",
	"src/components/messages/src",
	"src/components/permissions/ExitPlanModePermissionRequest/src",
	"src/components/permissions/FileEditPermissionRequest/src",
	"src/components/permissions/FilePermissionDialog/src",
	"src/components/permissions/SedEditPermissionRequest/src",
	"src/components/permissions/SkillPermissionRequest/src",
	"src/components/permissions/rules/src",
	"src/components/permissions/src",
	"src/components/src",
	"src/components/tasks/src",
	"src/constants/src",
	"src/context/src",
	"src/entrypoints/src",
	"src/hooks/notifs/src",
	"src/hooks/src",
	"src/hooks/toolPermission/handlers/src",
	"src/hooks/toolPermission/src",
	"src/keybindings/src",
	"src/migrations/src",
	"src/schemas/src",
	"src/screens/src",
	"src/services/analytics/src",
	"src/services/api/src",
	"src/services/compact/src",
	"src/services/mcp/src",
	"src/services/oauth/src",
	"src/services/src",
	"src/services/tips/src",
	"src/services/tools/src",
	"src/skills/bundled/src",
	"src/state/src",
	"src/tools/AgentTool/built-in/src",
	"src/tools/AgentTool/src",
	"src/tools/AskUserQuestionTool/src",
	"src/tools/BashTool/src",
	"src/tools/EnterPlanModeTool/src",
	"src/tools/ExitPlanModeTool/src",
	"src/tools/FileEditTool/src",
	"src/tools/FileReadTool/src",
	"src/tools/FileWriteTool/src",
	"src/tools/GlobTool/src",
	"src/tools/NotebookEditTool/src",
	"src/tools/PowerShellTool/src",
	"src/tools/SkillTool/src",
	"src/tools/WebSearchTool/src",
	"src/tools/src",
	"src/types/src",
	"src/utils/background/remote/src",
	"src/utils/bash/src",
	"src/utils/deepLink/src",
	"src/utils/hooks/src",
	"src/utils/messages/src",
	"src/utils/model/src",
	"src/utils/nativeInstaller/src",
	"src/utils/permissions/src",
	"src/utils/plugins/src",
	"src/utils/processUserInput/src",
	"src/utils/sandbox/src",
	"src/utils/secureStorage/src",
	"src/utils/settings/src",
	"src/utils/src",
	"src/utils/suggestions/src",
	"src/utils/telemetry/src",
	"src/utils/teleport/src",
]);

function walkDirectories(root: string, results: string[]) {
	for (const entry of readdirSync(root, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (entry.name === "node_modules" || entry.name === "dist" || entry.name === ".git") continue;
		const fullPath = join(root, entry.name);
		results.push(fullPath);
		walkDirectories(fullPath, results);
	}
}

function collectSrcStubDirs(): string[] {
	const directories: string[] = [];
	walkDirectories(SRC_ROOT, directories);
	return directories
		.filter((dir) => dir.endsWith(`${sep}src`))
		.map((dir) => relative(ROOT, dir).replaceAll(sep, "/"))
		.sort();
}

function collectTypeAnyStubFiles(): string[] {
	const directories: string[] = [];
	walkDirectories(SRC_ROOT, directories);
	const suspectFiles: string[] = [];

	for (const directory of directories) {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			if (!entry.isFile()) continue;
			if (!entry.name.endsWith(".ts") && !entry.name.endsWith(".tsx")) continue;
			const fullPath = join(directory, entry.name);
			const content = readFileSync(fullPath, "utf8");
			if (/export type [A-Za-z0-9_$]+ = any;?/m.test(content)) {
				suspectFiles.push(relative(ROOT, fullPath).replaceAll(sep, "/"));
			}
		}
	}

	return suspectFiles.sort();
}

const discoveredStubDirs = collectSrcStubDirs();
const newStubDirs = discoveredStubDirs.filter((dir) => !ALLOWED_SRC_STUB_DIRS.has(dir));
const typeAnyStubFiles = collectTypeAnyStubFiles();

console.log("Transition stub directories:", discoveredStubDirs.length);
console.log("Type-any transition stubs:", typeAnyStubFiles.length);

if (newStubDirs.length > 0) {
	console.error("\nUnexpected src/*/src directories detected:");
	for (const dir of newStubDirs) {
		console.error(`  - ${dir}`);
	}
	process.exit(1);
}

console.log("No new src/*/src directories detected.");
console.log("Current type-any transition stubs are inventory only; avoid adding more in Phase 0.");
