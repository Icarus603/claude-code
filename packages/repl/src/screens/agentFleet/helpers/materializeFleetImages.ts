/**
 * materializeFleetImages — port of ant `jnK` (5092.js cluster, 4952.js:61).
 *
 * A fleet dispatch spawns a SEPARATE worker process. The worker receives
 * its prompt as a plain-text positional argument (the "directive"); it
 * cannot see the in-process `pastedContents` map that holds the image
 * base64. So before spawning, every `[Image #N]` placeholder in the intent
 * is rewritten to a real file PATH the worker can FileRead:
 *
 *   - If the pasted image already has a `sourcePath` (dragged a file onto
 *     the terminal), use that path verbatim.
 *   - Otherwise (Cmd+V clipboard image — base64 only, no path), write the
 *     base64 into the worker's job dir as `pasted-{id}.{ext}` and use that.
 *
 * ant source (4952.js:61) verbatim:
 *   async function jnK(H, _, q) {            // H=intent, _=pastedContents, q=short
 *     let K = LS(H).filter((z) => _[z.id]?.type === "image");
 *     if (K.length === 0) return H;
 *     let O = b4(q), T = H;                  // b4(short) = job dir
 *     for (let z = K.length - 1; z >= 0; z--) {
 *       let $ = K[z], A = _[$.id], Y = A.sourcePath;
 *       if (!Y) {
 *         await _E.mkdir(O, { recursive: true });
 *         let w = (A.mediaType ?? "image/png").split("/")[1] ?? "png";
 *         Y = FV_.join(O, `pasted-${$.id}.${w}`);
 *         await _E.writeFile(Y, A.content, { encoding: "base64" });
 *       }
 *       T = T.slice(0, $.index) + Y + T.slice($.index + $.match.length);
 *     }
 *     return T;
 *   }
 *
 * Iterating high-index → low keeps earlier match offsets valid after each
 * splice (same reason expandPastedTextRefs walks in reverse).
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

import { getJobDir } from '@claude-code/agent/background/fleet/fleetStore.js'
import type { PastedContent } from '@claude-code/config'

import { parseReferences } from '../../../history.js'

export async function materializeFleetImages(
  intent: string,
  pastedContents: Record<number, PastedContent>,
  short: string,
): Promise<string> {
  const imageRefs = parseReferences(intent).filter(
    ref => pastedContents[ref.id]?.type === 'image',
  )
  if (imageRefs.length === 0) {
    return intent
  }

  const jobDir = getJobDir(short)
  let result = intent

  for (let i = imageRefs.length - 1; i >= 0; i--) {
    const ref = imageRefs[i]!
    const content = pastedContents[ref.id]!
    let path = content.sourcePath
    if (!path) {
      await mkdir(jobDir, { recursive: true })
      const ext = (content.mediaType ?? 'image/png').split('/')[1] ?? 'png'
      path = join(jobDir, `pasted-${ref.id}.${ext}`)
      await writeFile(path, content.content, { encoding: 'base64' })
    }
    result =
      result.slice(0, ref.index) + path + result.slice(ref.index + ref.match.length)
  }

  return result
}
