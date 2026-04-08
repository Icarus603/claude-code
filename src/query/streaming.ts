import type { ToolUseBlock } from "@anthropic-ai/sdk/resources/index.mjs";
import {
	createUserMessage,
	createAssistantAPIErrorMessage,
} from "../utils/messages.js";
import type {
	AssistantMessage,
	Message,
	StreamEvent,
	ToolUseSummaryMessage,
	TombstoneMessage,
	RequestStartEvent,
	UserMessage,
} from "../types/message.js";
import type { Terminal } from "./transitions.js";

export function* yieldMissingToolResultBlocks(
	assistantMessages: AssistantMessage[],
	errorMessage: string,
) {
	for (const assistantMessage of assistantMessages) {
		const toolUseBlocks = (
			Array.isArray(assistantMessage.message?.content)
				? assistantMessage.message.content
				: []
		).filter((content: { type: string }) => content.type === "tool_use") as ToolUseBlock[];

		for (const toolUse of toolUseBlocks) {
			yield createUserMessage({
				content: [
					{
						type: "tool_result",
						content: errorMessage,
						is_error: true,
						tool_use_id: toolUse.id,
					},
				],
				toolUseResult: errorMessage,
				sourceToolAssistantUUID: assistantMessage.uuid,
			});
		}
	}
}

export function isWithheldMaxOutputTokens(
	msg: Message | StreamEvent | undefined,
): msg is AssistantMessage {
	return msg?.type === "assistant" && msg.apiError === "max_output_tokens";
}
