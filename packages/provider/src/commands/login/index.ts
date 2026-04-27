// Canonical owner is @claude-code/command-runtime/commands/login.
// Moved 2026-04-27 to break the provider→repl back-edge in the 151-file
// SCC: provider was importing repl components (ConsoleOAuthFlow,
// useMainLoopModel, ConfigurableShortcutHint) for this command's UI,
// putting provider above repl in the dep graph (wrong direction).
export { default } from '@claude-code/command-runtime/commands/login/index.js'
