import { feature } from "bun:bundle";
import { isEnvTruthy } from "../../utils/envUtils.js";
import { setUserMsgOptIn } from "../../bootstrap/state.js";
import {
	logEvent,
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from "../../services/analytics/index.js";

export function maybeActivateProactive(options: unknown): void {
	if (
		(feature("PROACTIVE") || feature("KAIROS")) &&
		((options as { proactive?: boolean }).proactive ||
			isEnvTruthy(process.env.CLAUDE_CODE_PROACTIVE))
	) {
		// eslint-disable-next-line @typescript-eslint/no-require-imports
		const proactiveModule = require("../../proactive/index.js");
		if (!proactiveModule.isProactiveActive()) {
			proactiveModule.activateProactive("command");
		}
	}
}

export function maybeActivateBrief(options: unknown): void {
	if (!(feature("KAIROS") || feature("KAIROS_BRIEF"))) return;
	const briefFlag = (options as { brief?: boolean }).brief;
	const briefEnv = isEnvTruthy(process.env.CLAUDE_CODE_BRIEF);
	if (!briefFlag && !briefEnv) return;
	/* eslint-disable @typescript-eslint/no-require-imports */
	const { isBriefEntitled } =
		require("../../tools/BriefTool/BriefTool.js") as typeof import("../../tools/BriefTool/BriefTool.js");
	/* eslint-enable @typescript-eslint/no-require-imports */
	const entitled = isBriefEntitled();
	if (entitled) {
		setUserMsgOptIn(true);
	}
	logEvent("tengu_brief_mode_enabled", {
		enabled: entitled,
		gated: !entitled,
		source: (briefEnv
			? "env"
			: "flag") as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
	});
}
