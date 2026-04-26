# @claude-code/cli

Commander.js command tree, argument parsing, headless SDK runner, and
every `claude <subcommand>` entry point body.

V7 §8.1 — the CLI surface. `src/main.tsx` registers commands here;
`src/entrypoints/cli.tsx` routes to this package after fast-path
exits.
