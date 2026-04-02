import { mock, describe, expect, test } from "bun:test";

// ─── Comprehensive mocks for agentToolUtils.ts dependencies ───
// These must cover ALL named exports used by the module's transitive imports.

const noop = () => {};
const emptySet = () => new Set<string>();

// Utility: create a mock module factory that returns an object with arbitrary named exports
function stubModule(exportNames: string[]) {
  const obj: Record<string, any> = {};
  for (const name of exportNames) {
    obj[name] = noop;
  }
  return () => obj;
}

mock.module("bun:bundle", () => ({ feature: () => false }));

mock.module("zod/v4", () => ({
  z: {
    object: () => ({ extend: () => ({ parse: noop }) }),
    strictObject: () => ({ extend: noop }),
    string: () => ({ optional: () => ({ describe: noop }) }),
    number: () => ({ optional: noop }),
    boolean: () => ({ describe: noop }),
    enum: () => ({ optional: noop }),
    array: noop,
    union: noop,
    optional: noop,
    preprocess: noop,
    nullable: noop,
    record: noop,
    any: noop,
    unknown: noop,
    default: noop,
  },
}));

mock.module("src/bootstrap/state.js", () => ({
  clearInvokedSkillsForAgent: noop,
}));

mock.module("src/constants/tools.js", () => ({
  ALL_AGENT_DISALLOWED_TOOLS: new Set(),
  ASYNC_AGENT_ALLOWED_TOOLS: new Set(),
  CUSTOM_AGENT_DISALLOWED_TOOLS: new Set(),
  IN_PROCESS_TEAMMATE_ALLOWED_TOOLS: new Set(),
}));

mock.module("src/services/AgentSummary/agentSummary.js", () => ({
  startAgentSummarization: noop,
}));

mock.module("src/services/analytics/index.js", () => ({
  logEvent: noop,
  AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS: undefined,
}));

mock.module("src/services/api/dumpPrompts.js", () => ({
  clearDumpState: noop,
}));

mock.module("src/Tool.js", () => ({
  toolMatchesName: () => false,
  findToolByName: noop,
  toolMatchesName: () => false,
}));

// messages.ts is complex - provide stubs for all named exports
mock.module("src/utils/messages.ts", () => ({
  extractTextContent: (content: any[]) =>
    content?.filter?.((b: any) => b.type === "text")?.map?.((b: any) => b.text)?.join("") ?? "",
  getLastAssistantMessage: () => null,
  SYNTHETIC_MESSAGES: new Set(),
  INTERRUPT_MESSAGE: "",
  INTERRUPT_MESSAGE_FOR_TOOL_USE: "",
  CANCEL_MESSAGE: "",
  REJECT_MESSAGE: "",
  REJECT_MESSAGE_WITH_REASON_PREFIX: "",
  SUBAGENT_REJECT_MESSAGE: "",
  SUBAGENT_REJECT_MESSAGE_WITH_REASON_PREFIX: "",
  PLAN_REJECTION_PREFIX: "",
  DENIAL_WORKAROUND_GUIDANCE: "",
  NO_RESPONSE_REQUESTED: "",
  SYNTHETIC_TOOL_RESULT_PLACEHOLDER: "",
  SYNTHETIC_MODEL: "",
  AUTO_REJECT_MESSAGE: noop,
  DONT_ASK_REJECT_MESSAGE: noop,
  withMemoryCorrectionHint: (s: string) => s,
  deriveShortMessageId: () => "",
  isClassifierDenial: () => false,
  buildYoloRejectionMessage: () => "",
  buildClassifierUnavailableMessage: () => "",
  isEmptyMessageText: () => true,
  createAssistantMessage: noop,
  createAssistantAPIErrorMessage: noop,
  createUserMessage: noop,
  prepareUserContent: noop,
  createUserInterruptionMessage: noop,
  createSyntheticUserCaveatMessage: noop,
  formatCommandInputTags: noop,
}));

mock.module("src/tasks/LocalAgentTask/LocalAgentTask.js", () => ({
  completeAgentTask: noop,
  createActivityDescriptionResolver: () => ({}),
  createProgressTracker: () => ({}),
  enqueueAgentNotification: noop,
  failAgentTask: noop,
  getProgressUpdate: () => ({ tokenCount: 0, toolUseCount: 0 }),
  getTokenCountFromTracker: () => 0,
  isLocalAgentTask: () => false,
  killAsyncAgent: noop,
  updateAgentProgress: noop,
  updateProgressFromMessage: noop,
}));

mock.module("src/utils/agentSwarmsEnabled.js", () => ({
  isAgentSwarmsEnabled: () => false,
}));

mock.module("src/utils/debug.js", () => ({
  logForDebugging: noop,
}));

mock.module("src/utils/envUtils.js", () => ({
  isInProtectedNamespace: () => false,
}));

mock.module("src/utils/errors.js", () => ({
  AbortError: class extends Error {},
  errorMessage: (e: any) => String(e),
}));

mock.module("src/utils/forkedAgent.js", () => ({}));

mock.module("src/utils/lazySchema.js", () => ({
  lazySchema: (fn: () => any) => fn,
}));

mock.module("src/utils/permissions/PermissionMode.js", () => ({}));

// Provide working permissionRuleValueFromString to avoid polluting other test files
const LEGACY_ALIASES: Record<string, string> = {
  Task: "Agent",
  KillShell: "TaskStop",
  AgentOutputTool: "TaskOutput",
  BashOutputTool: "TaskOutput",
};

function normalizeLegacyToolName(name: string): string {
  return LEGACY_ALIASES[name] ?? name;
}

function escapeRuleContent(content: string): string {
  return content.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function unescapeRuleContent(content: string): string {
  return content.replace(/\\\(/g, "(").replace(/\\\)/g, ")").replace(/\\\\/g, "\\");
}

mock.module("src/utils/permissions/permissionRuleParser.js", () => ({
  permissionRuleValueFromString: (ruleString: string) => {
    const openIdx = ruleString.indexOf("(");
    if (openIdx === -1) return { toolName: normalizeLegacyToolName(ruleString) };
    const closeIdx = ruleString.lastIndexOf(")");
    if (closeIdx === -1 || closeIdx <= openIdx) return { toolName: normalizeLegacyToolName(ruleString) };
    if (closeIdx !== ruleString.length - 1) return { toolName: normalizeLegacyToolName(ruleString) };
    const toolName = ruleString.substring(0, openIdx);
    const rawContent = ruleString.substring(openIdx + 1, closeIdx);
    if (!toolName) return { toolName: normalizeLegacyToolName(ruleString) };
    if (rawContent === "" || rawContent === "*") return { toolName: normalizeLegacyToolName(toolName) };
    return { toolName: normalizeLegacyToolName(toolName), ruleContent: unescapeRuleContent(rawContent) };
  },
  permissionRuleValueToString: (v: any) => {
    if (!v.ruleContent) return v.toolName;
    return `${v.toolName}(${escapeRuleContent(v.ruleContent)})`;
  },
  normalizeLegacyToolName,
}));

mock.module("src/utils/permissions/yoloClassifier.js", () => ({
  buildTranscriptForClassifier: () => "",
  classifyYoloAction: () => null,
}));

mock.module("src/utils/task/sdkProgress.js", () => ({
  emitTaskProgress: noop,
}));

mock.module("src/utils/teammateContext.js", () => ({
  isInProcessTeammate: () => false,
}));

mock.module("src/utils/tokens.js", () => ({
  getTokenCountFromUsage: () => 0,
}));

mock.module("src/tools/ExitPlanModeTool/constants.js", () => ({
  EXIT_PLAN_MODE_V2_TOOL_NAME: "exit_plan_mode",
}));

mock.module("src/tools/AgentTool/constants.js", () => ({
  AGENT_TOOL_NAME: "agent",
  LEGACY_AGENT_TOOL_NAME: "task",
}));

mock.module("src/tools/AgentTool/loadAgentsDir.js", () => ({}));

mock.module("src/state/AppState.js", () => ({}));

mock.module("src/types/ids.js", () => ({
  asAgentId: (id: string) => id,
}));

// Break circular dep
mock.module("src/tools/AgentTool/AgentTool.tsx", () => ({
  AgentTool: {},
  inputSchema: {},
  outputSchema: {},
  default: {},
}));

const {
  countToolUses,
  getLastToolUseName,
} = await import("../agentToolUtils");

function makeAssistantMessage(content: any[]): any {
  return { type: "assistant", message: { content } };
}

function makeUserMessage(text: string): any {
  return { type: "user", message: { content: text } };
}

describe("countToolUses", () => {
  test("counts tool_use blocks in messages", () => {
    const messages = [
      makeAssistantMessage([
        { type: "tool_use", name: "Read" },
        { type: "text", text: "hello" },
      ]),
    ];
    expect(countToolUses(messages)).toBe(1);
  });

  test("returns 0 for messages without tool_use", () => {
    const messages = [
      makeAssistantMessage([{ type: "text", text: "hello" }]),
    ];
    expect(countToolUses(messages)).toBe(0);
  });

  test("returns 0 for empty array", () => {
    expect(countToolUses([])).toBe(0);
  });

  test("counts multiple tool_use blocks across messages", () => {
    const messages = [
      makeAssistantMessage([{ type: "tool_use", name: "Read" }]),
      makeUserMessage("ok"),
      makeAssistantMessage([{ type: "tool_use", name: "Write" }]),
    ];
    expect(countToolUses(messages)).toBe(2);
  });

  test("counts tool_use in single message with multiple blocks", () => {
    const messages = [
      makeAssistantMessage([
        { type: "tool_use", name: "Read" },
        { type: "tool_use", name: "Grep" },
        { type: "tool_use", name: "Write" },
      ]),
    ];
    expect(countToolUses(messages)).toBe(3);
  });
});

describe("getLastToolUseName", () => {
  test("returns last tool name from assistant message", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", name: "Read" },
      { type: "tool_use", name: "Write" },
    ]);
    expect(getLastToolUseName(msg)).toBe("Write");
  });

  test("returns undefined for message without tool_use", () => {
    const msg = makeAssistantMessage([{ type: "text", text: "hello" }]);
    expect(getLastToolUseName(msg)).toBeUndefined();
  });

  test("returns the last tool when multiple tool_uses present", () => {
    const msg = makeAssistantMessage([
      { type: "tool_use", name: "Read" },
      { type: "tool_use", name: "Grep" },
      { type: "tool_use", name: "Edit" },
    ]);
    expect(getLastToolUseName(msg)).toBe("Edit");
  });

  test("returns undefined for non-assistant message", () => {
    const msg = makeUserMessage("hello");
    expect(getLastToolUseName(msg)).toBeUndefined();
  });

  test("handles message with null content", () => {
    const msg = { type: "assistant", message: { content: null } };
    expect(getLastToolUseName(msg)).toBeUndefined();
  });
});
