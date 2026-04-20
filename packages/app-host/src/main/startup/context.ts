import { feature } from "bun:bundle";
import { getSystemContext, getUserContext } from "@claude-code/provider/context.js";
import { checkHasTrustDialogAccepted } from "@claude-code/config";
import { getIsNonInteractiveSession } from "../../bootstrap/state.js";
import { logForDiagnosticsNoPII } from "src/utils/diagLogs.js";
import { initUser } from "src/utils/user.js";
import { getRelevantTips } from "src/services/tips/tipRegistry.js";
import {
	prefetchAwsCredentialsAndBedRockInfoIfSafe,
	prefetchGcpCredentialsIfSafe,
} from "src/utils/auth.js";
import { countFilesRoundedRg } from "src/utils/ripgrep.js";
import { getCwd } from "@claude-code/app-host/bootstrap/cwd.js";
import { prefetchOfficialMcpUrls } from '@claude-code/mcp-runtime/officialRegistry.js';
import { refreshModelCapabilities } from "src/utils/model/modelCapabilities.js";
import { settingsChangeDetector } from "src/utils/settings/changeDetector.js";
import { skillChangeDetector } from "src/utils/skills/skillChangeDetector.js";
import { isEnvTruthy } from "src/utils/envUtils.js";
import { isBareMode } from "src/utils/envUtils.js";

export function prefetchSystemContextIfSafe(): void {
	const isNonInteractiveSession = getIsNonInteractiveSession();
	if (isNonInteractiveSession) {
		logForDiagnosticsNoPII("info", "prefetch_system_context_non_interactive");
		void getSystemContext();
		return;
	}

	if (checkHasTrustDialogAccepted()) {
		logForDiagnosticsNoPII("info", "prefetch_system_context_has_trust");
		void getSystemContext();
		return;
	}

	logForDiagnosticsNoPII("info", "prefetch_system_context_skipped_no_trust");
}

export function startDeferredPrefetches(): void {
	if (
		isEnvTruthy(process.env.CLAUDE_CODE_EXIT_AFTER_FIRST_RENDER) ||
		isBareMode()
	) {
		return;
	}

	void initUser();
	void getUserContext();
	prefetchSystemContextIfSafe();
	void getRelevantTips();
	if (
		isEnvTruthy(process.env.CLAUDE_CODE_USE_BEDROCK) &&
		!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_BEDROCK_AUTH)
	) {
		void prefetchAwsCredentialsAndBedRockInfoIfSafe();
	}
	if (
		isEnvTruthy(process.env.CLAUDE_CODE_USE_VERTEX) &&
		!isEnvTruthy(process.env.CLAUDE_CODE_SKIP_VERTEX_AUTH)
	) {
		void prefetchGcpCredentialsIfSafe();
	}
	void countFilesRoundedRg(getCwd(), AbortSignal.timeout(3000), []);
	void prefetchOfficialMcpUrls();
	void refreshModelCapabilities();
	void settingsChangeDetector.initialize();
	if (!isBareMode()) {
		void skillChangeDetector.initialize();
	}
	if (process.env.USER_TYPE === "ant") {
		void import("src/utils/eventLoopStallDetector.js").then((m) =>
			m.startEventLoopStallDetector(),
		);
	}
}
