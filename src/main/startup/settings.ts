import { feature } from "bun:bundle";
import chalk from "chalk";
import { readFileSync } from "fs";
import { safeParseJSON } from "../../utils/json.js";
import { writeFileSync_DEPRECATED } from "../../utils/slowOperations.js";
import { generateTempFilePath } from "../../utils/tempfile.js";
import { getFsImplementation, safeResolvePath } from "../../utils/fsOperations.js";
import { errorMessage, isENOENT } from "../../utils/errors.js";
import { resetSettingsCache } from "../../utils/settings/settingsCache.js";
import { eagerParseCliFlag } from "../../utils/cliArgs.js";
import { parseSettingSourcesFlag } from "../../utils/settings/constants.js";
import {
	setAllowedSettingSources,
	setFlagSettingsPath,
} from "../../bootstrap/state.js";
import {
	migrateBypassPermissionsAcceptedToSettings,
} from "../../migrations/migrateBypassPermissionsAcceptedToSettings.js";
import { migrateEnableAllProjectMcpServersToSettings } from "../../migrations/migrateEnableAllProjectMcpServersToSettings.js";
import { resetProToOpusDefault } from "../../migrations/resetProToOpusDefault.js";
import { migrateSonnet1mToSonnet45 } from "../../migrations/migrateSonnet1mToSonnet45.js";
import { migrateLegacyOpusToCurrent } from "../../migrations/migrateLegacyOpusToCurrent.js";
import { migrateSonnet45ToSonnet46 } from "../../migrations/migrateSonnet45ToSonnet46.js";
import { migrateOpusToOpus1m } from "../../migrations/migrateOpusToOpus1m.js";
import { migrateReplBridgeEnabledToRemoteControlAtStartup } from "../../migrations/migrateReplBridgeEnabledToRemoteControlAtStartup.js";
import { resetAutoModeOptInForDefaultOffer } from "../../migrations/resetAutoModeOptInForDefaultOffer.js";
import { migrateFennecToOpus } from "../../migrations/migrateFennecToOpus.js";
import { migrateChangelogFromConfig } from "../../utils/releaseNotes.js";
import { getGlobalConfig, saveGlobalConfig } from "@claude-code/config";
import { profileCheckpoint } from "../../utils/startupProfiler.js";
import { isEnvTruthy } from "../../utils/envUtils.js";

const CURRENT_MIGRATION_VERSION = 11;

export function runMigrations(): void {
	if (getGlobalConfig().migrationVersion !== CURRENT_MIGRATION_VERSION) {
		migrateBypassPermissionsAcceptedToSettings();
		migrateEnableAllProjectMcpServersToSettings();
		resetProToOpusDefault();
		migrateSonnet1mToSonnet45();
		migrateLegacyOpusToCurrent();
		migrateSonnet45ToSonnet46();
		migrateOpusToOpus1m();
		migrateReplBridgeEnabledToRemoteControlAtStartup();
		if (feature("TRANSCRIPT_CLASSIFIER")) {
			resetAutoModeOptInForDefaultOffer();
		}
		if (process.env.USER_TYPE === "ant") {
			migrateFennecToOpus();
		}
		saveGlobalConfig((prev) =>
			prev.migrationVersion === CURRENT_MIGRATION_VERSION
				? prev
				: { ...prev, migrationVersion: CURRENT_MIGRATION_VERSION },
		);
	}
	void migrateChangelogFromConfig().catch(() => {});
}

export function loadSettingsFromFlag(settingsFile: string): void {
	try {
		const trimmedSettings = settingsFile.trim();
		const looksLikeJson =
			trimmedSettings.startsWith("{") && trimmedSettings.endsWith("}");

		let settingsPath: string;
		if (looksLikeJson) {
			const parsedJson = safeParseJSON(trimmedSettings);
			if (!parsedJson) {
				process.stderr.write(chalk.red("Error: Invalid JSON provided to --settings\n"));
				process.exit(1);
			}
			settingsPath = generateTempFilePath("claude-settings", ".json", {
				contentHash: trimmedSettings,
			});
			writeFileSync_DEPRECATED(settingsPath, trimmedSettings, "utf8");
		} else {
			const { resolvedPath: resolvedSettingsPath } = safeResolvePath(
				getFsImplementation(),
				settingsFile,
			);
			try {
				readFileSync(resolvedSettingsPath, "utf8");
			} catch (e) {
				if (isENOENT(e)) {
					process.stderr.write(
						chalk.red(`Error: Settings file not found: ${resolvedSettingsPath}\n`),
					);
					process.exit(1);
				}
				throw e;
			}
			settingsPath = resolvedSettingsPath;
		}

		setFlagSettingsPath(settingsPath);
		resetSettingsCache();
	} catch (error) {
		process.stderr.write(chalk.red(`Error processing settings: ${errorMessage(error)}\n`));
		process.exit(1);
	}
}

export function loadSettingSourcesFromFlag(settingSourcesArg: string): void {
	try {
		const sources = parseSettingSourcesFlag(settingSourcesArg);
		setAllowedSettingSources(sources);
		resetSettingsCache();
	} catch (error) {
		process.stderr.write(
			chalk.red(`Error processing --setting-sources: ${errorMessage(error)}\n`),
		);
		process.exit(1);
	}
}

export function eagerLoadSettings(): void {
	profileCheckpoint("eagerLoadSettings_start");
	const settingsFile = eagerParseCliFlag("--settings");
	if (settingsFile) {
		loadSettingsFromFlag(settingsFile);
	}
	const settingSourcesArg = eagerParseCliFlag("--setting-sources");
	if (settingSourcesArg !== undefined) {
		loadSettingSourcesFromFlag(settingSourcesArg);
	}
	profileCheckpoint("eagerLoadSettings_end");
}

export function initializeEntrypoint(isNonInteractive: boolean): void {
	if (process.env.CLAUDE_CODE_ENTRYPOINT) {
		return;
	}
	const cliArgs = process.argv.slice(2);
	const mcpIndex = cliArgs.indexOf("mcp");
	if (mcpIndex !== -1 && cliArgs[mcpIndex + 1] === "serve") {
		process.env.CLAUDE_CODE_ENTRYPOINT = "mcp";
		return;
	}
	if (isEnvTruthy(process.env.CLAUDE_CODE_ACTION)) {
		process.env.CLAUDE_CODE_ENTRYPOINT = "claude-code-github-action";
		return;
	}
	process.env.CLAUDE_CODE_ENTRYPOINT = isNonInteractive ? "sdk-cli" : "cli";
}
