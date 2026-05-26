// Workflow meta parser — port of ant 2.1.150 `uR`.
//
// A workflow script must begin with a `export const meta = { ... }` declaration
// whose initializer is a PURE OBJECT LITERAL (no variables, no function calls,
// no spreads, no template interpolation). Everything after the declaration is
// the script body, which runs in the vm sandbox (sandbox.ts / runtime.ts).
//
// We split the script into (meta, scriptBody) and validate the meta. ant's `uR`
// uses a JS tokenizer to find the literal's bounds; we mirror the same contract
// — the meta must be statically evaluable with no host access — by extracting
// the `export const meta = <literal>` prefix, rejecting any non-literal syntax,
// and evaluating ONLY that literal in a throwaway frozen vm context. The body
// is never evaluated here (that's the engine's job).

import vm from 'node:vm'

export type WorkflowPhaseMeta = {
  title: string
  detail?: string
  model?: string
}

export type WorkflowMeta = {
  name: string
  description: string
  whenToUse?: string
  phases?: WorkflowPhaseMeta[]
}

export type ParseResult =
  | { meta: WorkflowMeta; scriptBody: string }
  | { error: string }

// Syntax that is forbidden inside the meta literal because it would make the
// meta non-static (variables / calls / spreads / template interpolation).
// Matches ant's "must be a PURE LITERAL" rule from the tool description.
const NON_LITERAL_PATTERNS: Array<{ re: RegExp; what: string }> = [
  { re: /\$\{/, what: 'template interpolation (${…})' },
  { re: /\.\.\./, what: 'spread (...)' },
  { re: /=>/, what: 'arrow function' },
  { re: /\bfunction\b/, what: 'function expression' },
]

/**
 * Find the index just past the matching close-brace for the object literal that
 * starts at `openBraceIndex`. Brace-aware over strings, template literals, and
 * line/block comments so braces inside those don't miscount. Returns -1 if no
 * matching brace is found.
 */
function findLiteralEnd(src: string, openBraceIndex: number): number {
  let depth = 0
  let i = openBraceIndex
  type Mode = 'code' | 'sq' | 'dq' | 'tpl' | 'line' | 'block'
  let mode: Mode = 'code'
  for (; i < src.length; i++) {
    const c = src[i]!
    const next = src[i + 1]
    switch (mode) {
      case 'code':
        if (c === '{') depth++
        else if (c === '}') {
          depth--
          if (depth === 0) return i + 1
        } else if (c === "'") mode = 'sq'
        else if (c === '"') mode = 'dq'
        else if (c === '`') mode = 'tpl'
        else if (c === '/' && next === '/') {
          mode = 'line'
          i++
        } else if (c === '/' && next === '*') {
          mode = 'block'
          i++
        }
        break
      case 'sq':
        if (c === '\\') i++
        else if (c === "'") mode = 'code'
        break
      case 'dq':
        if (c === '\\') i++
        else if (c === '"') mode = 'code'
        break
      case 'tpl':
        if (c === '\\') i++
        else if (c === '`') mode = 'code'
        break
      case 'line':
        if (c === '\n') mode = 'code'
        break
      case 'block':
        if (c === '*' && next === '/') {
          mode = 'code'
          i++
        }
        break
    }
  }
  return -1
}

function isValidPhases(v: unknown): v is WorkflowPhaseMeta[] {
  if (!Array.isArray(v)) return false
  return v.every(
    p =>
      p != null &&
      typeof p === 'object' &&
      typeof (p as WorkflowPhaseMeta).title === 'string',
  )
}

/**
 * ant `uR` — parse a workflow script into its meta object and body.
 */
export function parseWorkflowScript(script: string): ParseResult {
  const declMatch = script.match(/export\s+const\s+meta\s*=\s*\{/)
  if (!declMatch || declMatch.index === undefined) {
    return {
      error:
        'Script must begin with `export const meta = { name, description, phases }` (pure literal).',
    }
  }

  const openBrace = script.indexOf('{', declMatch.index)
  const literalEnd = findLiteralEnd(script, openBrace)
  if (literalEnd === -1) {
    return { error: 'meta object literal is not closed (unbalanced braces).' }
  }

  const literalText = script.slice(openBrace, literalEnd)
  for (const { re, what } of NON_LITERAL_PATTERNS) {
    if (re.test(literalText)) {
      return {
        error: `meta must be a pure literal — found ${what}. Use only string/number/boolean/array/object literals.`,
      }
    }
  }

  let metaValue: unknown
  try {
    // Evaluate ONLY the literal in a throwaway frozen context. With the
    // non-literal patterns rejected above this is a constant expression; the
    // frozen sandbox is defence-in-depth (no host globals reachable).
    const ctx = vm.createContext(Object.freeze(Object.create(null)))
    metaValue = vm.runInContext(`(${literalText})`, ctx, { timeout: 1000 })
  } catch (e) {
    return {
      error: `meta literal failed to evaluate: ${e instanceof Error ? e.message : String(e)}`,
    }
  }

  if (metaValue == null || typeof metaValue !== 'object') {
    return { error: 'meta must be an object literal.' }
  }
  const m = metaValue as Record<string, unknown>
  if (typeof m.name !== 'string' || m.name.length === 0) {
    return { error: 'meta.name is required and must be a non-empty string.' }
  }
  if (typeof m.description !== 'string' || m.description.length === 0) {
    return {
      error: 'meta.description is required and must be a non-empty string.',
    }
  }
  if (m.whenToUse !== undefined && typeof m.whenToUse !== 'string') {
    return { error: 'meta.whenToUse must be a string when present.' }
  }
  if (m.phases !== undefined && !isValidPhases(m.phases)) {
    return {
      error:
        'meta.phases must be an array of { title, detail?, model? } objects.',
    }
  }

  const meta: WorkflowMeta = {
    name: m.name,
    description: m.description,
    ...(typeof m.whenToUse === 'string' ? { whenToUse: m.whenToUse } : {}),
    ...(m.phases !== undefined
      ? { phases: m.phases as WorkflowPhaseMeta[] }
      : {}),
  }
  const scriptBody = script.slice(literalEnd)
  return { meta, scriptBody }
}
