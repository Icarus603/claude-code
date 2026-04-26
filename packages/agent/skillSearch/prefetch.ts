// Auto-generated stub — replace with real implementation
import type { Attachment } from '@claude-code/agent/attachments.js'
import type { Message } from '@claude-code/repl/replTypes/message.js'
import type { ToolUseContext } from '@claude-code/tool-registry/Tool.js'

export const startSkillDiscoveryPrefetch: (
  input: string | null,
  messages: Message[],
  toolUseContext: ToolUseContext,
) => Promise<Attachment[]> = (async () => []);
export const collectSkillDiscoveryPrefetch: (
  pending: Promise<Attachment[]>,
) => Promise<Attachment[]> = (async (pending) => pending);
export const getTurnZeroSkillDiscovery: (
  input: string,
  messages: Message[],
  context: ToolUseContext,
) => Promise<Attachment | null> = (async () => null);
