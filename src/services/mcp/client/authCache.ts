import { mkdir, readFile, unlink, writeFile } from "fs/promises";
import { dirname } from "path";
import { jsonParse, jsonStringify } from "../../../utils/slowOperations.js";
import { getClaudeConfigHomeDir } from "../../../utils/envUtils.js";

const MCP_AUTH_CACHE_TTL_MS = 15 * 60 * 1000;

export type McpAuthCacheData = Record<string, { timestamp: number }>;

export function getMcpAuthCachePath(): string {
	return `${getClaudeConfigHomeDir()}/mcp-needs-auth-cache.json`;
}

let authCachePromise: Promise<McpAuthCacheData> | null = null;

export function getMcpAuthCache(): Promise<McpAuthCacheData> {
	if (!authCachePromise) {
		authCachePromise = readFile(getMcpAuthCachePath(), "utf-8")
			.then((data) => jsonParse(data) as McpAuthCacheData)
			.catch(() => ({}));
	}
	return authCachePromise;
}

export async function isMcpAuthCached(serverId: string): Promise<boolean> {
	const cache = await getMcpAuthCache();
	const entry = cache[serverId];
	if (!entry) return false;
	return Date.now() - entry.timestamp < MCP_AUTH_CACHE_TTL_MS;
}

let writeChain = Promise.resolve();

export function setMcpAuthCacheEntry(serverId: string): void {
	writeChain = writeChain
		.then(async () => {
			const cache = await getMcpAuthCache();
			cache[serverId] = { timestamp: Date.now() };
			const cachePath = getMcpAuthCachePath();
			await mkdir(dirname(cachePath), { recursive: true });
			await writeFile(cachePath, jsonStringify(cache));
			authCachePromise = null;
		})
		.catch(() => {});
}

export function clearMcpAuthCache(): void {
	authCachePromise = null;
	void unlink(getMcpAuthCachePath()).catch(() => {});
}
