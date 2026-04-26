import type { ToolUseSummaryMessage } from '@claude-code/repl/replTypes/message.js';
import type { Message } from '@claude-code/repl/replTypes/message.js';
import type { ToolUseContext } from "@claude-code/tool-registry/Tool.js";
import type { AutoCompactTrackingState } from "@claude-code/agent/compaction/autoCompact.js";
import type { Continue } from '@claude-code/agent/query/transitions.js';

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
