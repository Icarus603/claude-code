# @claude-code/mcp-runtime

Model Context Protocol client/server runtime: connection pool, lifecycle,
OAuth (simplified), tool aggregation.

V7 §8.14 — owns all MCP wire protocol logic. Tool consumers see MCP
tools as ordinary tools through tool-registry's adapter.
