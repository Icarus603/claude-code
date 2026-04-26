# @claude-code/local-observability

Logging, telemetry, span tracing, error helpers, and slow-operation
detection — all writing locally (no external sinks in this fork).

V7 §8.10 — every `logForDebugging`, error-id, span, and stats aggregator
lives here. Consumers import named modules, not the index.
