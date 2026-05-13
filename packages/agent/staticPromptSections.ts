/**
 * Static (always-emitted) system-prompt sections extracted from prompts.ts
 * to keep that file under its grandfathered LOC budget.
 *
 * Each export here corresponds to one `systemPromptSection(name, () => ...)`
 * registration in prompts.ts and lines up with an ant counterpart.
 */

// ant v2.1.139 4769.js:summarize_tool_results section.
export const SUMMARIZE_TOOL_RESULTS_SECTION =
  `When working with tool results, write down any important information you might need later in your response, as the original tool result may be cleared later.`

// ant v2.1.139 4769.js:556 (VE3) — context_management. Always emitted; tells
// the model that auto-compaction will keep work going so it doesn't try to
// wrap up early when the conversation grows long.
export const CONTEXT_MANAGEMENT_SECTION =
  `# Context management\nWhen the conversation grows long, some or all of the current context is summarized; the summary, along with any remaining unsummarized context, is provided in the next context window so work can continue — you don't need to wrap up early or hand off mid-task.`
