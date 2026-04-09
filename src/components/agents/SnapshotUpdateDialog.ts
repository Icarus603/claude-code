// Auto-generated stub — replace with real implementation
import type React from 'react';
import type { AgentMemoryScope } from '@claude-code/memory/agentMemory';

export {};
export const SnapshotUpdateDialog: React.FC<{
  agentType: string;
  scope: AgentMemoryScope;
  snapshotTimestamp: string;
  onComplete: (choice: 'merge' | 'keep' | 'replace') => void;
  onCancel: () => void;
}> = (() => null);
export const buildMergePrompt: (agentType: string, scope: AgentMemoryScope) => string = (() => '');
