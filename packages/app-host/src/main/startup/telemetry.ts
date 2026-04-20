import { SandboxManager } from "src/utils/sandbox/sandbox-adapter.js";
import { parseUserSpecifiedModel, getDefaultMainLoopModel } from "src/utils/model/model.js";
import { getContextWindowForModel } from "src/utils/context.js";
import { getInitialMainLoopModel, getSdkBetas } from "../../bootstrap/state.js";
import { logSkillsLoaded } from "src/utils/telemetry/skillLoadedEvent.js";
import { getCwd } from "@claude-code/app-host/bootstrap/cwd.js";
import { loadAllPluginsCacheOnly } from "src/utils/plugins/pluginLoader.js";
import { getManagedPluginNames } from "src/utils/plugins/managedPlugins.js";
import { getPluginSeedDirs } from "src/utils/plugins/pluginDirectories.js";
import {
	logPluginLoadErrors,
	logPluginsEnabledForSession,
} from "src/utils/telemetry/pluginTelemetry.js";
import { logError } from "src/utils/log.js";
import { hasNodeOption } from "@claude-code/config/env/utils";
import { getIsGit, getWorktreeCount } from "src/utils/git.js";
import { getInitialSettings } from "src/utils/settings/settings.js";
import { getGhAuthStatus } from "src/utils/github/ghAuthStatus.js";
import { isAutoUpdaterDisabled } from "@claude-code/config";
import { isAnalyticsDisabled } from "src/services/privacyConfig.js";
import { logEvent } from "@claude-code/local-observability";
import type { AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS } from "@claude-code/local-observability/compat";

export function logSessionTelemetry(): void {
	const model = parseUserSpecifiedModel(
		getInitialMainLoopModel() ?? getDefaultMainLoopModel(),
	);
	void logSkillsLoaded(
		getCwd(),
		getContextWindowForModel(model, getSdkBetas()),
	);
	void loadAllPluginsCacheOnly()
		.then(({ enabled, errors }) => {
			const managedNames = getManagedPluginNames();
			logPluginsEnabledForSession(enabled, managedNames, getPluginSeedDirs());
			logPluginLoadErrors(errors, managedNames);
		})
		.catch((err) => logError(err));
}

function getCertEnvVarTelemetry(): Record<string, boolean> {
	const result: Record<string, boolean> = {};
	if (process.env.NODE_EXTRA_CA_CERTS) {
		result.has_node_extra_ca_certs = true;
	}
	if (process.env.CLAUDE_CODE_CLIENT_CERT) {
		result.has_client_cert = true;
	}
	if (hasNodeOption("--use-system-ca")) {
		result.has_use_system_ca = true;
	}
	if (hasNodeOption("--use-openssl-ca")) {
		result.has_use_openssl_ca = true;
	}
	return result;
}

export async function logStartupTelemetry(): Promise<void> {
	if (isAnalyticsDisabled()) return;
	const [isGit, worktreeCount, ghAuthStatus] = await Promise.all([
		getIsGit(),
		getWorktreeCount(),
		getGhAuthStatus(),
	]);

	logEvent("tengu_startup_telemetry", {
		is_git: isGit,
		worktree_count: worktreeCount,
		gh_auth_status:
			ghAuthStatus as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
		sandbox_enabled: SandboxManager.isSandboxingEnabled(),
		are_unsandboxed_commands_allowed:
			SandboxManager.areUnsandboxedCommandsAllowed(),
		is_auto_bash_allowed_if_sandbox_enabled:
			SandboxManager.isAutoAllowBashIfSandboxedEnabled(),
		auto_updater_disabled: isAutoUpdaterDisabled(),
		prefers_reduced_motion:
			getInitialSettings().prefersReducedMotion ?? false,
		...getCertEnvVarTelemetry(),
	});
}
