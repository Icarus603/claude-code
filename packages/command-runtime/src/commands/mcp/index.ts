import type { Command } from '@claude-code/command-runtime/runtime'

const mcp = {
  type: 'local-jsx',
  name: 'mcp',
  description: 'Manage MCP servers',
  immediate: true,
  argumentHint: '[enable|disable [server-name]]',
  load: () => import('@claude-code/command-runtime/commands/mcp/mcp.js'),
} satisfies Command

export default mcp
