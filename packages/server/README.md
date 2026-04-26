# @claude-code/server

HTTP/WebSocket server endpoints: directConnectManager, RemoteSessionManager,
SSH session bridge.

V7 §8.16 — when the CLI runs as a server (not REPL), this package owns
the request/response transport and per-session lifecycle.
