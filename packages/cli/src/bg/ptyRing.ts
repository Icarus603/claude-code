/**
 * Bounded ring buffer for the PTY host's reattach-replay log.
 *
 * 1:1 port of ant 4702.js wXK (lines 168-195). The ring stores the
 * most recent `cap` bytes of PTY output; on `attach`, the host
 * replays these chunks to the new client so they catch up from
 * (approximately) where the most recent output started.
 *
 * UTF-8 safety: when the head chunk overflows the cap, we don't
 * blindly drop it — we trim leading continuation bytes (0b10xxxxxx)
 * up to 3 of them so the surviving chunk still starts on a code-point
 * boundary. ant's loop bounds `A < 3 && $ < z.length` mirror UTF-8's
 * max 3 trailing continuations after a 4-byte lead.
 *
 * @dynamicRequire
 */

export interface PtyRing {
  /** Returns the current chunk list (compacts internal state). */
  readonly chunks: Buffer[]
  /** Append a new chunk; evicts oldest until under `cap`. */
  push(chunk: Buffer): void
}

/**
 * Create a ring buffer with the given byte cap. Default 256 KiB
 * matches ant's `hX_ = 262144`.
 */
export function createRing(cap: number): PtyRing {
  const list: Buffer[] = []
  // `head` is the in-list compaction cursor; we lazy-shift to avoid
  // allocating a new array per eviction. `compact()` drops the
  // dead prefix once it gets to be half the list.
  let head = 0
  let totalBytes = 0

  function compact(): void {
    if (head > 0) {
      list.splice(0, head)
      head = 0
    }
  }

  return {
    get chunks(): Buffer[] {
      compact()
      return list
    },
    push(chunk: Buffer): void {
      list.push(chunk)
      totalBytes += chunk.length
      while (totalBytes > cap && list.length - head > 1) {
        // Drop oldest chunk completely.
        totalBytes -= list[head]!.length
        head++
        // After a hard drop, the new head may start mid-codepoint
        // (PTY output isn't guaranteed to align). Strip up to 3
        // continuation bytes from its start so consumers see clean
        // UTF-8 from the first byte. ant's bound: trim continues
        // either when we've stripped 3 bytes, or when this chunk is
        // exhausted (then move to next chunk).
        let stripped = 0
        while (stripped < 3) {
          const next = list[head]
          if (!next) break
          let n = 0
          while (
            stripped + n < 3 &&
            n < next.length &&
            (next[n]! & 0xc0) === 0x80
          ) {
            n++
          }
          if (n > 0) {
            list[head] = next.subarray(n)
            totalBytes -= n
            stripped += n
          }
          if (list[head]!.length > 0 || list.length - head === 1) break
          head++
        }
      }
      // Compact when the dead prefix is at least half the list, to
      // bound amortised array work.
      if (head >= list.length - head) compact()
    },
  }
}
