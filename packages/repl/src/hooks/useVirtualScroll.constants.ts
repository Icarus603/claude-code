/**
 * Tuning constants for useVirtualScroll. Extracted from the hook file
 * for the file-size budget; numbers + their rationale travel together.
 */

/**
 * Estimated height (rows) for items not yet measured. Intentionally LOW:
 * overestimating causes blank space (we stop mounting too early and the
 * viewport bottom shows empty spacer), while underestimating just mounts
 * a few extra items into overscan. The asymmetry means we'd rather err low.
 */
export const DEFAULT_ESTIMATE = 3
/**
 * Extra rows rendered above and below the viewport. Generous because real
 * heights can be 10x the estimate for long tool results.
 */
export const OVERSCAN_ROWS = 80
/** Items rendered before the ScrollBox has laid out (viewportHeight=0). */
export const COLD_START_COUNT = 30
/**
 * scrollTop quantization for the useSyncExternalStore snapshot. Without
 * this, every wheel tick (3-5 per notch) triggers a full React commit +
 * Yoga calculateLayout() + Ink diff cycle — the CPU spike. Visual scroll
 * stays smooth regardless: ScrollBox.forceRender fires on every scrollBy
 * and Ink reads the REAL scrollTop from the DOM node, independent of what
 * React thinks. React only needs to re-render when the mounted range must
 * shift; half of OVERSCAN_ROWS is the tightest safe bin (guarantees ≥40
 * rows of overscan remain before the new range is needed).
 */
export const SCROLL_QUANTUM = OVERSCAN_ROWS >> 1
/**
 * Worst-case height assumed for unmeasured items when computing coverage.
 * A MessageRow can be as small as 1 row (single-line tool call). Using 1
 * here guarantees the mounted span physically reaches the viewport bottom
 * regardless of how small items actually are — at the cost of over-mounting
 * when items are larger (which is fine, overscan absorbs it).
 */
export const PESSIMISTIC_HEIGHT = 1
/** Cap on mounted items to bound fiber allocation even in degenerate cases. */
export const MAX_MOUNTED_ITEMS = 300
/**
 * Max NEW items to mount in a single commit. Scrolling into a fresh range
 * with PESSIMISTIC_HEIGHT=1 would mount 194 items at once (OVERSCAN_ROWS*2+
 * viewportH = 194); each fresh MessageRow render costs ~1.5ms (marked lexer
 * + formatToken + ~11 createInstance) = ~290ms sync block. Sliding the range
 * toward the target over multiple commits keeps per-commit mount cost
 * bounded. The render-time clamp (scrollClampMin/Max) holds the viewport at
 * the edge of mounted content so there's no blank during catch-up.
 */
export const SLIDE_STEP = 25

export const NOOP_UNSUB = (): void => {}
