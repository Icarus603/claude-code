import { SandboxManager } from "../../utils/sandbox/sandbox-adapter.js";
import { parseUserSpecifiedModel, getDefaultMainLoopModel } from "../../utils/model/model.js";
import { getContextWindowForModel } from "../../utils/context.js";
import { getInitialMainLoopModel, getSdkBetas } from "../../bootstrap/state.js";
import { logSkillsLoaded } from "../../utils/telemetry/skillLoadedEvent.js";
import { getCwd } from "../../utils/cwd.js";
import { loadAllPluginsCacheOnly } from "../../utils/plugins/pluginLoader.js";
import { getManagedPluginNames } from "../../utils/plugins/managedPlugins.js";
import { getPluginSeedDirs } from "../../utils/plugins/pluginDirectories.js";
import {
	logPluginLoadErrors,
	logPluginsEnabledForSession,
} from "../../utils/telemetry/pluginTelemetry.js";
import { logError } from "../../utils/log.js";
import { hasNodeOption } from "../../utils/envUtils.js";
import { getIsGit, getWorktreeCount } from "../../utils/git.js";
import { getInitialSettings } from "../../utils/settings/settings.js";
import { getGhAuthStatus } from "../../utils/github/ghAuthStatus.js";
import { isAutoUpdaterDisabled } from "../../utils/config.js";
import { isAnalyticsDisabled } from "../../services/analytics/config.js";
import {
	logEvent,
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from "../../services/analytics/index.js";

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
