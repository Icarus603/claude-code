# @claude-code/config

Settings, env gates, platform detection, plugin loader, and lazy schema
validation.

V7 §8.4 — single source of truth for read-time configuration. Other
packages must go through this surface (`readEnv`, `getInitialSettings`,
`platform`) rather than touching process.env or fs directly.
