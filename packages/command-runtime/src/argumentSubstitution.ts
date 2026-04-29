// Forward shim — moved to @claude-code/config/utils/argumentSubstitution
// to break the config → command-runtime cycle that forced a lazy-require
// fallback in config/plugin/_deps.ts.
export {
  parseArguments,
  parseArgumentNames,
  generateProgressiveArgumentHint,
  substituteArguments,
} from '@claude-code/config/utils/argumentSubstitution.js'
