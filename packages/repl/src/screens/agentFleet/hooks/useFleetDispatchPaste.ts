/**
 * useFleetDispatchPaste — image/text paste handling for the FleetView
 * dispatch buffer. Source: ant 5277.js `fq`/`HK` refs (1691-1692) +
 * onPaste/onImagePaste handlers (3054-3080).
 *
 * Pasting an image into the dispatch box (drag a file onto the terminal,
 * or Cmd+V a clipboard image) stores the base64/path in `pastedContents`
 * keyed by a sequential id and shows a `[Image #N]` placeholder instead of
 * the raw path. The placeholder is materialized back to a file path at
 * dispatch time (see helpers/materializeFleetImages.ts = ant `jnK`) because
 * the spawned worker is a separate process that can't read this in-memory
 * map.
 *
 * The dispatch box uses a single FleetView `useInput` cascade rather than a
 * focused TextInput, so paste callbacks are wired through ccb's
 * usePasteHandler (= ant W86) at the FleetView call site, not here. This
 * hook owns only the state + the two callbacks + the placeholder-prune
 * effect.
 */

import { appendFileSync } from 'fs'
import { useCallback, useEffect, useRef } from 'react'

import type { PastedContent } from '@claude-code/config'
import {
  cacheImagePath,
  storeImage,
} from '@claude-code/tool-registry/imageStore.js'

import { formatImageRef, parseReferences } from '../../../history.js'
import { isValidImagePaste } from '../../../textInputTypes.js'

// TEMP PROBE (remove after root-cause): gated on CCB_PASTE_PROBE=1.
function fleetPasteProbe(msg: string): void {
  if (process.env.CCB_PASTE_PROBE !== '1') return
  try {
    appendFileSync('/tmp/ccb-paste-probe.log', `${new Date().toISOString()} [fleetPaste] ${msg}\n`)
  } catch {
    // best-effort
  }
}

export interface FleetDispatchPaste {
  /** Text paste → insert raw at cursor. ant onPaste (5277.js:3054). */
  onTextPaste: (rawText: string) => void
  /** Image paste → store + insert `[Image #N]`. ant onImagePaste (3068). */
  onImagePaste: (
    base64Image: string,
    mediaType?: string,
    filename?: string,
    dimensions?: PastedContent['dimensions'],
    sourcePath?: string,
  ) => void
  /**
   * Snapshot the image map and clear the live ref. Source: ant 5277.js
   * `let kY = fq.current` (3909) captured before `fq.current = {}` (3936).
   * Called once at submit: the async materialize + dispatch reads the
   * snapshot while a fast re-type starts a clean buffer. `hasImages`
   * mirrors ant's `$1 = !hasImages && ...` spare-fit gate.
   */
  snapshotAndClear: () => {
    pastedContents: Record<number, PastedContent>
    hasImages: boolean
  }
}

export function useFleetDispatchPaste(args: {
  dispatchBuf: string
  dispatchCursor: number
  setDispatchBuf: (updater: (prev: string) => string) => void
  setDispatchCursor: (next: number) => void
}): FleetDispatchPaste {
  const { dispatchBuf, dispatchCursor, setDispatchBuf, setDispatchCursor } =
    args

  const pastedContents = useRef<Record<number, PastedContent>>({})
  const nextPasteIdRef = useRef(1)

  // Cursor mirror, kept fresh every render. Source: the bug it fixes —
  // a multi-image drag fires onImagePaste in a synchronous loop (ant W86 /
  // ccb usePasteHandler iterate `validImages`), so several inserts land in
  // one React tick. Reading the captured `dispatchCursor` would give the
  // STALE pre-tick value on the 2nd..Nth call, splicing every image at the
  // same offset — only one placeholder survives. The ref advances
  // synchronously across the loop so each insert lands after the previous.
  const cursorRef = useRef(dispatchCursor)
  cursorRef.current = dispatchCursor

  // Insert text at the dispatch cursor. Source: ant 5277.js `a6(new dRH(t))`
  // — dRH wraps an atomic "insert at cursor" edit the buffer reducer
  // applies (buffer + cursor move together). ccb splits buffer/cursor into
  // two useState. The splice MUST clamp against the updater's `prev` (the
  // previous QUEUED value — React feeds each functional update the result
  // of the prior one in the same tick), NOT against the captured
  // `dispatchBuf` whose length is stale on the 2nd..Nth call. cursorRef
  // advances synchronously so the next call's insert position is correct
  // before React commits.
  const insertDispatchText = useCallback(
    (text: string): void => {
      if (text === '') return
      const insertAt = cursorRef.current
      setDispatchBuf(prev => {
        const at = Math.min(insertAt, prev.length)
        const next = prev.slice(0, at) + text + prev.slice(at)
        fleetPasteProbe(`insert text=${JSON.stringify(text)} insertAt=${insertAt} clampAt=${at} prev=${JSON.stringify(prev)} next=${JSON.stringify(next)}`)
        return next
      })
      cursorRef.current = insertAt + text.length
      setDispatchCursor(cursorRef.current)
    },
    [setDispatchBuf, setDispatchCursor],
  )

  // Text paste → insert raw. Source: ant 5277.js:3054-3066 onPaste. ant
  // folds long pastes into a `[Pasted text #N]` placeholder, but the
  // dispatch box expands + submits immediately and never persists the
  // buffer across turns, so for ccb the load-bearing behaviour is the
  // inline insert. (The text-placeholder round-trip would need the REPL's
  // expandPastedTextRefs path — out of scope for a single-shot dispatch.)
  const onTextPaste = useCallback(
    (rawText: string): void => {
      insertDispatchText(rawText.replace(/\r\n|\r/g, '\n'))
    },
    [insertDispatchText],
  )

  // Image paste → store in map + insert `[Image #N]`. Source: ant 5277.js
  // :3068-3080 onImagePaste verbatim:
  //   let x9 = HK.current++
  //   fq.current[x9] = { id, type:"image", content, mediaType, filename,
  //                      dimensions, sourcePath }
  //   a6(new dRH(A86(x9)))            // A86(n) = `[Image #n]`
  const onImagePaste = useCallback(
    (
      base64Image: string,
      mediaType?: string,
      filename?: string,
      dimensions?: PastedContent['dimensions'],
      sourcePath?: string,
    ): void => {
      const pasteId = nextPasteIdRef.current++
      fleetPasteProbe(`onImagePaste ENTER id=${pasteId} sourcePath=${JSON.stringify(sourcePath)} cursorRef=${cursorRef.current}`)
      const newContent: PastedContent = {
        id: pasteId,
        type: 'image',
        content: base64Image,
        mediaType: mediaType || 'image/png',
        filename: filename || 'Pasted image',
        dimensions,
        sourcePath,
      }
      // Cache the in-session path immediately (fast) + persist to disk in
      // the background, mirroring PromptInput.onImagePaste. The dispatch
      // path re-materializes into the worker's job dir at submit (ant jnK),
      // but caching keeps the id→path map warm.
      try {
        cacheImagePath(newContent)
        void storeImage(newContent)
      } catch (e) {
        fleetPasteProbe(`onImagePaste CACHE-THREW id=${pasteId} err=${e instanceof Error ? e.message : String(e)}`)
      }
      pastedContents.current[pasteId] = newContent
      fleetPasteProbe(`onImagePaste id=${pasteId} mapKeys=${JSON.stringify(Object.keys(pastedContents.current))}`)
      insertDispatchText(formatImageRef(pasteId))
    },
    [insertDispatchText],
  )

  // Prune images whose `[Image #N]` placeholder left the buffer (pill
  // backspace, Ctrl+U, char delete). ant reads fq lazily at dispatch; ccb
  // prunes eagerly so the map doesn't leak across edits.
  useEffect(() => {
    const referenced = new Set(parseReferences(dispatchBuf).map(r => r.id))
    const before = Object.keys(pastedContents.current)
    for (const idStr of Object.keys(pastedContents.current)) {
      const id = Number(idStr)
      const c = pastedContents.current[id]
      if (c?.type === 'image' && !referenced.has(id)) {
        delete pastedContents.current[id]
      }
    }
    fleetPasteProbe(`pruneEffect buf=${JSON.stringify(dispatchBuf)} referenced=${JSON.stringify([...referenced])} mapBefore=${JSON.stringify(before)} mapAfter=${JSON.stringify(Object.keys(pastedContents.current))}`)
  }, [dispatchBuf])

  const snapshotAndClear = useCallback((): {
    pastedContents: Record<number, PastedContent>
    hasImages: boolean
  } => {
    const snapshot = { ...pastedContents.current }
    pastedContents.current = {}
    const hasImages = Object.values(snapshot).some(isValidImagePaste)
    return { pastedContents: snapshot, hasImages }
  }, [])

  return { onTextPaste, onImagePaste, snapshotAndClear }
}
