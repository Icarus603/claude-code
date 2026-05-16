/**
 * Flatten a worker's `detail` (or any free-form activity blob) to a
 * single-line label fit for the row's middle column.
 *
 * Source: ant lr (5092.js:563-568) + udK (5092.js:560-562) + QO (sanitizer).
 *
 *   QO(text)  → strip <[system-reminder]> / <[task-notification]> blocks
 *   udK       → same regex, exported for callers that want the raw form
 *   lr        → udK → strip remaining tags → collapse whitespace → trim
 */

/**
 * Strip system-reminder / task-notification blocks. Source: ant udK.
 *
 * Keeps the content outside the tagged blocks. Used in two places:
 *   1. As input to `flattenDetail` (which adds further tag stripping)
 *   2. By the activity-summary extractor `summarizeEvent` for user msgs
 */
export function stripSystemBlocks(text: string): string {
  return text.replace(/<(system-reminder|task-notification)>[\s\S]*?(<\/\1>|$)/g, ' ')
}

/**
 * Sanitize any embedded text for safe single-line display. Strips
 * angle-bracketed tags / collapses whitespace / trims.
 *
 * Source: ant lr (with ant's QO acting as a pre-sanitizer that we fold
 * into stripSystemBlocks — ccb's tool output doesn't need the additional
 * @ant-internal escape handling).
 */
export function flattenDetail(text: string): string {
  return stripSystemBlocks(text)
    .replace(/<\/?[\w-]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}
