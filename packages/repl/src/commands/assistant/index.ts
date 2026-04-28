/**
 * Assistant command — KAIROS feature-gated stub.
 *
 * The real implementation lives upstream; this stub keeps the import
 * path resolvable so feature() gates compile cleanly. The default
 * export is `null` so when KAIROS is enabled and this require fires,
 * the spread `...(assistantCommand ? [assistantCommand] : [])` skips
 * the entry instead of throwing.
 */
export default null
export * from './assistant.js'
