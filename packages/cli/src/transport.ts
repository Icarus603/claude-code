import { getCliHostBindings } from './host.js'
import type { StructuredIOOptions } from './contracts.js'

export type { StructuredIOOptions }

/**
 * Returns a StructuredIO or RemoteIO for a headless session. The concrete
 * implementation lives in the root (src/cli/structuredIOHelper.ts) and is
 * installed via installCliHostBindings. The return type is opaque at the
 * package boundary — call-sites that need StructuredIO typing cast at the
 * import site. See V7 §8.19 / §8.25 landing map.
 */
export function getStructuredIO(
  inputPrompt: string | AsyncIterable<string>,
  options: StructuredIOOptions,
): unknown {
  const bindings = getCliHostBindings()
  if (!bindings.getStructuredIO) {
    throw new Error(
      'CLI getStructuredIO binding not installed. Install root CLI host bindings before using @claude-code/cli transport APIs.',
    )
  }
  return bindings.getStructuredIO(inputPrompt, options)
}
