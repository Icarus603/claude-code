import type { FetchLike } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
	checkAndRefreshOAuthTokenIfNeeded,
	getClaudeAIOAuthTokens,
	handleOAuth401Error,
} from "../../../utils/auth.js";
import { logMCPDebug } from "../../../utils/log.js";
import { getLoggingSafeMcpBaseUrl } from "../utils.js";
import type { MCPServerConnection, ScopedMcpServerConfig } from "../types.js";
import {
	logEvent,
	type AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
} from "../../eventLogger.js";
import { setMcpAuthCacheEntry } from "./authCache.js";

export function mcpBaseUrlAnalytics(serverRef: ScopedMcpServerConfig): {
	mcpServerBaseUrl?: AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS;
} {
	const url = getLoggingSafeMcpBaseUrl(serverRef);
	return url
		? {
				mcpServerBaseUrl:
					url as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
			}
		: {};
}

export function handleRemoteAuthFailure(
	name: string,
	serverRef: ScopedMcpServerConfig,
	transportType: "sse" | "http" | "claudeai-proxy",
): MCPServerConnection {
	logEvent("tengu_mcp_server_needs_auth", {
		transportType:
			transportType as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
		...mcpBaseUrlAnalytics(serverRef),
	});
	const label: Record<typeof transportType, string> = {
		sse: "SSE",
		http: "HTTP",
		"claudeai-proxy": "claude.ai proxy",
	};
	logMCPDebug(name, `Authentication required for ${label[transportType]} server`);
	setMcpAuthCacheEntry(name);
	return { name, type: "needs-auth", config: serverRef };
}

export function createClaudeAiProxyFetch(innerFetch: FetchLike): FetchLike {
	return async (url, init) => {
		const doRequest = async () => {
			await checkAndRefreshOAuthTokenIfNeeded();
			const currentTokens = getClaudeAIOAuthTokens();
			if (!currentTokens) {
				throw new Error("No claude.ai OAuth token available");
			}
			const headers = new Headers(init?.headers);
			headers.set("Authorization", `Bearer ${currentTokens.accessToken}`);
			const response = await innerFetch(url, { ...init, headers });
			return { response, sentToken: currentTokens.accessToken };
		};

		const { response, sentToken } = await doRequest();
		if (response.status !== 401) return response;

		const tokenChanged = await handleOAuth401Error(sentToken).catch(() => false);
		logEvent("tengu_mcp_claudeai_proxy_401", {
			tokenChanged:
				tokenChanged as AnalyticsMetadata_I_VERIFIED_THIS_IS_NOT_CODE_OR_FILEPATHS,
		});
		if (!tokenChanged) {
			const now = getClaudeAIOAuthTokens()?.accessToken;
			if (!now || now === sentToken) {
				return response;
			}
		}

		try {
			return (await doRequest()).response;
		} catch {
			return response;
		}
	};
}
