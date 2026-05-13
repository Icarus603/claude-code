import { SandboxManager } from "@claude-code/shell/sandbox/sandbox-adapter.js";
import {
	parseUserSpecifiedModel,
	getDefaultMainLoopModel,
} from "@claude-code/provider/model.js";
import { getContextWindowForModel } from "@claude-code/agent/context.js";
import { getInitialMainLoopModel, getSdkBetas } from "../../bootstrap/state.js";
import { logSkillsLoaded } from "../../startup/skillLoadedEvent.js";
import { getCwd } from "../../bootstrap/cwd.js";
import { loadAllPluginsCacheOnly } from "@claude-code/config/plugin/pluginLoader";
import { getManagedPluginNames } from "@claude-code/config/plugin/managedPlugins";
import { getPluginSeedDirs } from "@claude-code/config/plugin/pluginDirectories";
import { parsePluginIdentifier } from "@claude-code/config/plugin/pluginIdentifier";
import {
	logHooksRegistered,
	logPluginLoadErrors,
	logPluginsEnabledForSession,
} from "@claude-code/tool-registry/telemetry/pluginTelemetry.js";
import { logError } from "@claude-code/local-observability/logging";
import { hasNodeOption } from "@claude-code/config/env/utils";
import { getIsGit, getWorktreeCount } from "@claude-code/storage/git.js";
import { getInitialSettings, getSettingsForSource } from "@claude-code/config/settings";
import { getGhAuthStatus } from "../../startup/ghAuthStatus.js";
import { isAutoUpdaterDisabled } from "@claude-code/config";
import { isAnalyticsDisabled } from "@claude-code/config/env/privacy";
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
			// ant v2.1.139 5249.js:69 — emit hook_registered alongside the
			// plugin-loaded pipeline so settings hooks + plugin hooks both
			// surface in OTel exactly once per session start. Iterates the
			// five settings sources in priority order (ant 0659.js JG enum)
			// plus every enabled plugin's hooksConfig.
			logHooksRegistered(
				{
					userSettings: getSettingsForSource("userSettings")?.hooks,
					projectSettings: getSettingsForSource("projectSettings")?.hooks,
					localSettings: getSettingsForSource("localSettings")?.hooks,
					flagSettings: getSettingsForSource("flagSettings")?.hooks,
					policySettings: getSettingsForSource("policySettings")?.hooks,
				},
				enabled.map((p) => ({
					name: p.name,
					marketplace: parsePluginIdentifier(p.repository).marketplace,
					hooksConfig: p.hooksConfig,
				})),
				managedNames,
			);
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
