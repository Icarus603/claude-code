// Re-export from canonical owner. Consumers under src/ may keep using this
// path; packages/* must import from @claude-code/tool-registry/utils/lazySchema.js.
export { lazySchema } from '@claude-code/tool-registry/utils/lazySchema.js'
