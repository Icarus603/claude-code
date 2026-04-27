// Canonical owner is @claude-code/command-runtime/commands/model.
// Moved 2026-04-27 to break the provider→repl back-edge in the 151-file
// SCC: model.tsx imports repl/components/ModelPicker for UI, putting
// provider above repl in the dep graph (wrong direction).
import command from '@claude-code/command-runtime/commands/model/index.js'
export default command
