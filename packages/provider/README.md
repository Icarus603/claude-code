# @claude-code/provider

Claude API client + adapters for Anthropic, AWS Bedrock, Google Vertex,
Azure, OpenAI-compatible endpoints, and Gemini.

V7 §8.3 — single boundary between the agent loop and any LLM provider.
Stream events are normalized to `BetaRawMessageStreamEvent` so downstream
code stays provider-agnostic.
