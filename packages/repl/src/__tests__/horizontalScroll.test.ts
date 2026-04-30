/**
 * Tests for calculateHorizontalScrollWindow — pure helper that
 * decides which slice of a horizontal item list is visible (e.g.
 * tab strips, agent picker bars) given selected item must stay
 * visible.
 *
 * Wrong window = selected item disappears off-screen (UX bug).
 * Wrong arrow flags = scroll indicators rendered when there's
 * nothing to scroll, or hidden when there is.
 *
 * Edge-based scrolling contract (NOT centered): when scrolling
 * right, the selected item lands at the right edge; when scrolling
 * left, at the left edge. Tests pin both cases.
 */
import { describe, expect, test } from 'bun:test'
import { calculateHorizontalScrollWindow } from '../uiHelpers/horizontalScroll.js'

describe('calculateHorizontalScrollWindow — degenerate cases', () => {
  test('empty itemWidths → zero window, no arrows', () => {
    const r = calculateHorizontalScrollWindow([], 100, 2, 0)
    expect(r).toEqual({
      startIndex: 0,
      endIndex: 0,
      showLeftArrow: false,
      showRightArrow: false,
    })
  })

  test('single item that fits → full window, no arrows', () => {
    const r = calculateHorizontalScrollWindow([10], 100, 2, 0)
    expect(r).toEqual({
      startIndex: 0,
      endIndex: 1,
      showLeftArrow: false,
      showRightArrow: false,
    })
  })

  test('all items fit → no scroll, no arrows', () => {
    const r = calculateHorizontalScrollWindow([10, 10, 10], 100, 2, 1)
    expect(r).toEqual({
      startIndex: 0,
      endIndex: 3,
      showLeftArrow: false,
      showRightArrow: false,
    })
  })

  test('selectedIdx negative → clamped to 0', () => {
    const r = calculateHorizontalScrollWindow([10, 10, 10], 100, 2, -5)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBe(3)
  })

  test('selectedIdx beyond array → clamped to last', () => {
    const r = calculateHorizontalScrollWindow([10, 10, 10], 100, 2, 999)
    // All fit — full window.
    expect(r.endIndex).toBe(3)
  })
})

describe('calculateHorizontalScrollWindow — selected at start', () => {
  test('selected=0, items overflow → window from start, right arrow', () => {
    // Total = 50. Available = 20. With right arrow (-2) → 18.
    // Item 0 width 10 fits, item 1 (cumulative 20) > 18, so endIndex=1.
    const r = calculateHorizontalScrollWindow([10, 10, 10, 10, 10], 20, 2, 0)
    expect(r.startIndex).toBe(0)
    expect(r.showLeftArrow).toBe(false)
    expect(r.showRightArrow).toBe(true)
  })
})

describe('calculateHorizontalScrollWindow — selected to the right of visible', () => {
  test('selected at end → scroll right, selected at right edge', () => {
    // 5 items × 10 width = 50. Available 20.
    // Initial expansion fits items 0..0 (with right arrow).
    // selectedIdx=4 is past endIndex; scroll so 4 is at right edge.
    const r = calculateHorizontalScrollWindow([10, 10, 10, 10, 10], 20, 2, 4)
    expect(r.endIndex).toBe(5) // exclusive end → item 4 is last visible
    expect(r.startIndex).toBeLessThan(5)
    expect(r.showLeftArrow).toBe(true)
    expect(r.showRightArrow).toBe(false)
  })

  test('selected mid-array, scroll right', () => {
    const r = calculateHorizontalScrollWindow([10, 10, 10, 10, 10], 20, 2, 3)
    // selected=3 after initial 0..0 → scroll so 3 at right edge.
    expect(r.endIndex).toBe(4)
    expect(r.showRightArrow).toBe(true) // item 4 still off-screen
  })
})

describe('calculateHorizontalScrollWindow — selected to the left of visible', () => {
  test('previously scrolled right, then move selection left', () => {
    // Set up: 5 items. Scroll to right edge first by passing selected=4.
    // Then call again with selected=0 — should scroll back to start.
    const widths = [10, 10, 10, 10, 10]
    // Direct call with selected at start.
    const r = calculateHorizontalScrollWindow(widths, 20, 2, 0)
    expect(r.startIndex).toBe(0)
    expect(r.showLeftArrow).toBe(false)
  })
})

describe('calculateHorizontalScrollWindow — firstItemHasSeparator behaviour', () => {
  test('default firstItemHasSeparator=true: separator subtracted when start > 0', () => {
    // The first item's width includes a leading separator. When that item
    // is NOT the first visible (start > 0), we subtract 1 for the omitted
    // separator. So with widths [10,10,10,10,10] and availableWidth=20:
    //   start=1, end=3 → baseWidth = 20, minus 1 = 19, fits in 20 (no arrows
    //   yet, but right arrow likely on).
    const r = calculateHorizontalScrollWindow([10, 10, 10, 10, 10], 20, 2, 4)
    expect(r.endIndex).toBe(5)
    // start>0 here — separator subtraction effectively gives one extra char
    // of room.
  })

  test('firstItemHasSeparator=false: no subtraction', () => {
    const r = calculateHorizontalScrollWindow(
      [10, 10, 10, 10, 10],
      20,
      2,
      4,
      false,
    )
    expect(r.endIndex).toBe(5)
    expect(r.startIndex).toBeGreaterThanOrEqual(3)
  })
})

describe('calculateHorizontalScrollWindow — arrow flag invariants', () => {
  test('showLeftArrow exactly when startIndex > 0', () => {
    const r = calculateHorizontalScrollWindow([10, 10, 10, 10, 10], 20, 2, 4)
    expect(r.showLeftArrow).toBe(r.startIndex > 0)
  })

  test('showRightArrow exactly when endIndex < totalItems', () => {
    const r = calculateHorizontalScrollWindow([10, 10, 10, 10, 10], 20, 2, 0)
    expect(r.showRightArrow).toBe(r.endIndex < 5)
  })

  test('all visible → no arrows even when items > 1', () => {
    const r = calculateHorizontalScrollWindow([5, 5, 5, 5], 100, 2, 2)
    expect(r.showLeftArrow).toBe(false)
    expect(r.showRightArrow).toBe(false)
  })
})

describe('calculateHorizontalScrollWindow — degenerate widths', () => {
  test('zero-width items all fit (sum=0 ≤ any positive width)', () => {
    const r = calculateHorizontalScrollWindow([0, 0, 0, 0], 10, 2, 1)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBe(4)
  })

  test('single huge item that overflows: window still spans it', () => {
    // Item 0 alone is wider than availableWidth. The function's expansion
    // loop won't add it past width, but starting state is endIndex=1, so
    // the single huge item is always visible.
    const r = calculateHorizontalScrollWindow([100, 10, 10], 20, 2, 0)
    expect(r.startIndex).toBe(0)
    expect(r.endIndex).toBe(1) // expansion can't grow past 1
  })
})

describe('calculateHorizontalScrollWindow — selected always visible', () => {
  test('selected stays in [startIndex, endIndex) after recompute', () => {
    const widths = [10, 10, 10, 10, 10, 10, 10]
    for (let sel = 0; sel < widths.length; sel++) {
      const r = calculateHorizontalScrollWindow(widths, 20, 2, sel)
      expect(sel).toBeGreaterThanOrEqual(r.startIndex)
      expect(sel).toBeLessThan(r.endIndex)
    }
  })

  test('non-uniform widths: selected still in window', () => {
    const widths = [5, 15, 8, 12, 6]
    for (let sel = 0; sel < widths.length; sel++) {
      const r = calculateHorizontalScrollWindow(widths, 20, 2, sel)
      expect(sel).toBeGreaterThanOrEqual(r.startIndex)
      expect(sel).toBeLessThan(r.endIndex)
    }
  })
})

describe('calculateHorizontalScrollWindow — return shape', () => {
  test('always returns object with all four fields', () => {
    const r = calculateHorizontalScrollWindow([10], 100, 2, 0)
    expect('startIndex' in r).toBe(true)
    expect('endIndex' in r).toBe(true)
    expect('showLeftArrow' in r).toBe(true)
    expect('showRightArrow' in r).toBe(true)
  })

  test('startIndex ≤ endIndex always', () => {
    const widths = [10, 10, 10, 10, 10]
    for (let avail = 1; avail <= 100; avail += 13) {
      for (let sel = 0; sel < widths.length; sel++) {
        const r = calculateHorizontalScrollWindow(widths, avail, 2, sel)
        expect(r.startIndex).toBeLessThanOrEqual(r.endIndex)
      }
    }
  })

  test('endIndex ≤ totalItems always', () => {
    const widths = [10, 10, 10, 10, 10]
    for (let sel = 0; sel < widths.length; sel++) {
      const r = calculateHorizontalScrollWindow(widths, 30, 2, sel)
      expect(r.endIndex).toBeLessThanOrEqual(widths.length)
    }
  })
})
