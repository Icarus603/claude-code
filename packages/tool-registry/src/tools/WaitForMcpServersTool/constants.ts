/**
 * WaitForMcpServers tool constants — ported from ant v2.1.132 RU
 * (2563.js) + Iz8 (3105.js).
 */
export const WAIT_FOR_MCP_SERVERS_TOOL_NAME = 'WaitForMcpServers'

/**
 * Max time (ms) the tool blocks for any one batch of MCP servers to
 * transition out of `pending` / `connecting`. ant uses 5s (w$5); matching
 * that keeps the agent loop responsive while giving slow stdio servers
 * a reasonable spawn budget.
 */
export const WAIT_FOR_MCP_SERVERS_MAX_BLOCK_MS = 5000

/**
 * Poll interval (ms). 50ms is short enough to feel responsive but cheap
 * enough that 5s of polling burns <100 wakeups. Matches ant's inline
 * `await a6(50, abortSignal)` call inside the while-loop.
 */
export const WAIT_FOR_MCP_SERVERS_POLL_MS = 50
