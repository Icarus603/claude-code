import type { ToolUseSummaryMessage } from "../types/message.js";
import type { Message } from "../types/message.js";
import type { ToolUseContext } from "../Tool.js";
import type { AutoCompactTrackingState } from "../services/compact/autoCompact.js";
import type { Continue } from "./transitions.js";

export type QueryLoopState = {
	messages: Message[];
	toolUseContext: ToolUseContext;
	autoCompactTracking: AutoCompactTrackingState | undefined;
	maxOutputTokensRecoveryCount: number;
	hasAttemptedReactiveCompact: boolean;
	maxOutputTokensOverride: number | undefined;
	pendingToolUseSummary: Promise<ToolUseSummaryMessage | null> | undefined;
	stopHookActive: boolean | undefined;
	turnCount: number;
	transition: Continue | undefined;
};

export function createInitialQueryState(params: {
	messages: Message[];
	toolUseContext: ToolUseContext;
	maxOutputTokensOverride: number | undefined;
}): QueryLoopState {
	return {
		messages: params.messages,
		toolUseContext: params.toolUseContext,
		maxOutputTokensOverride: params.maxOutputTokensOverride,
		autoCompactTracking: undefined,
		stopHookActive: undefined,
		maxOutputTokensRecoveryCount: 0,
		hasAttemptedReactiveCompact: false,
		turnCount: 1,
		pendingToolUseSummary: undefined,
		transition: undefined,
	};
}
