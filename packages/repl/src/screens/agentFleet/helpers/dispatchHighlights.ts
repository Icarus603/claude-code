/**
 * Compute highlight ranges for the dispatch buffer.
 *
 * Source: ant 5092.js `ms3` + 5092.js highlight composition:
 *
 *   function ms3(H, _) {
 *     let q = [];
 *     for (let K of H.matchAll(/(?:^|\s)@(\S+)/g)) {
 *       if (!_.has(K[1].toLowerCase())) continue;
 *       let O = K.index + K[0].length;
 *       q.push([O - K[1].length - 1, O]);
 *     }
 *     return q;
 *   }
 *
 * ms3 returns inclusive-start exclusive-end character offset ranges
 * (each `[start, end)`) for every `@<name>` token whose name is in the
 * supplied known-names set. ant's caller composes the ranges with a
 * leading-word-match highlight if the dispatch buffer's first word
 * resolves to an active agent template.
 */

export type HighlightRange = [number, number]

/** Source: ant ms3. */
export function mentionHighlightRanges(
  buffer: string,
  knownNames: ReadonlySet<string>,
): HighlightRange[] {
  const out: HighlightRange[] = []
  const re = /(?:^|\s)@(\S+)/g
  let match: RegExpExecArray | null
  while ((match = re.exec(buffer)) !== null) {
    const name = match[1]
    if (name === undefined) continue
    if (!knownNames.has(name.toLowerCase())) continue
    const end = match.index + match[0].length
    out.push([end - name.length - 1, end])
  }
  return out
}

/**
 * Source: ant 5092.js zP composition:
 *
 *   zP = p4?.matched && jD === p4.template.name.toLowerCase()
 *        ? [[0, jD.length], ...HR]
 *        : C$ ? [[0, jD.length], ...HR]
 *        : [[...us3(bH), ...HR]]
 *
 * When the buffer's leading bare-word resolves to a matched agent
 * template, highlight the first word too.
 */
export function composeDispatchHighlights(
  buffer: string,
  knownNames: ReadonlySet<string>,
  leadingMatchLength: number | undefined,
): HighlightRange[] {
  const mentions = mentionHighlightRanges(buffer, knownNames)
  if (leadingMatchLength !== undefined && leadingMatchLength > 0) {
    return [[0, leadingMatchLength], ...mentions]
  }
  return mentions
}
