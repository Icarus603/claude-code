# @claude-code/tool-registry

Built-in tool implementations + the registry that assembles them at boot.

V7 §8.5 — every Tool (Bash, FileEdit, Grep, Glob, Skill, Task, ...) has its
descriptor, schema, and renderer here. Consumers import tools via the
registry, never by reaching into individual tool files.
