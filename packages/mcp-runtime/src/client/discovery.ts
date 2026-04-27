import { normalizeNameForMCP } from '../normalization.js';

export function supportsMcpResources(capabilities: { resources?: unknown } | undefined): boolean {
  return !!capabilities?.resources;
}

export function buildMcpPromptCommandName(serverName: string, promptName: string): string {
  return `mcp__${normalizeNameForMCP(serverName)}__${promptName}`;
}

export function addServerNameToResources<T extends object>(resources: T[], server: string) {
  return resources.map(resource => ({
    ...resource,
    server,
  }));
}
