// Forward shim — moved to @claude-code/config/yaml to support the
// frontmatterParser move that breaks the agent → config → agent cycle.
// New code should import from '@claude-code/config/yaml'.
export { parseYaml } from '@claude-code/config/yaml.js'
