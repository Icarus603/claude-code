import { feature } from "bun:bundle";
import type React from "react";

export type FocusedInputDialog =
	| "message-selector"
	| "sandbox-permission"
	| "tool-permission"
	| "prompt"
	| "worker-sandbox-permission"
	| "elicitation"
	| "cost"
	| "idle-return"
	| "init-onboarding"
	| "ide-onboarding"
	| "model-switch"
	| "undercover-callout"
	| "effort-callout"
	| "remote-callout"
	| "lsp-recommendation"
	| "plugin-hint"
	| "desktop-upsell"
	| "ultraplan-choice"
	| "ultraplan-launch"
	| undefined;

export function getFocusedInputDialog(params: {
	isExiting: boolean;
	exitFlow: React.ReactNode;
	isMessageSelectorVisible: boolean;
	isPromptInputActive: boolean;
	hasSandboxPermissionRequest: boolean;
	allowDialogsWithAnimation: boolean;
	hasToolUseConfirm: boolean;
	hasPromptQueue: boolean;
	hasWorkerSandboxPermission: boolean;
	hasElicitation: boolean;
	showingCostDialog: boolean;
	idleReturnPending: boolean;
	isLoading: boolean;
	ultraplanPendingChoice: unknown;
	ultraplanLaunchPending: unknown;
	showIdeOnboarding: boolean;
	showModelSwitchCallout: boolean;
	showUndercoverCallout: boolean;
	showEffortCallout: boolean;
	showRemoteCallout: boolean;
	lspRecommendation: unknown;
	hintRecommendation: unknown;
	showDesktopUpsellStartup: boolean;
}): FocusedInputDialog {
	if (params.isExiting || params.exitFlow) return undefined;
	if (params.isMessageSelectorVisible) return "message-selector";
	if (params.isPromptInputActive) return undefined;
	if (params.hasSandboxPermissionRequest) return "sandbox-permission";
	if (params.allowDialogsWithAnimation && params.hasToolUseConfirm) return "tool-permission";
	if (params.allowDialogsWithAnimation && params.hasPromptQueue) return "prompt";
	if (params.allowDialogsWithAnimation && params.hasWorkerSandboxPermission)
		return "worker-sandbox-permission";
	if (params.allowDialogsWithAnimation && params.hasElicitation) return "elicitation";
	if (params.allowDialogsWithAnimation && params.showingCostDialog) return "cost";
	if (params.allowDialogsWithAnimation && params.idleReturnPending) return "idle-return";
	if (
		feature("ULTRAPLAN") &&
		params.allowDialogsWithAnimation &&
		!params.isLoading &&
		params.ultraplanPendingChoice
	) {
		return "ultraplan-choice";
	}
	if (
		feature("ULTRAPLAN") &&
		params.allowDialogsWithAnimation &&
		!params.isLoading &&
		params.ultraplanLaunchPending
	) {
		return "ultraplan-launch";
	}
	if (params.allowDialogsWithAnimation && params.showIdeOnboarding) return "ide-onboarding";
	if (
		process.env.USER_TYPE === "ant" &&
		params.allowDialogsWithAnimation &&
		params.showModelSwitchCallout
	) {
		return "model-switch";
	}
	if (
		process.env.USER_TYPE === "ant" &&
		params.allowDialogsWithAnimation &&
		params.showUndercoverCallout
	) {
		return "undercover-callout";
	}
	if (params.allowDialogsWithAnimation && params.showEffortCallout) return "effort-callout";
	if (params.allowDialogsWithAnimation && params.showRemoteCallout) return "remote-callout";
	if (params.allowDialogsWithAnimation && params.lspRecommendation) return "lsp-recommendation";
	if (params.allowDialogsWithAnimation && params.hintRecommendation) return "plugin-hint";
	if (params.allowDialogsWithAnimation && params.showDesktopUpsellStartup) return "desktop-upsell";
	return undefined;
}
